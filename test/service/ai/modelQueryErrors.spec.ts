import { AiClientError } from '~/service/ai/errors'
import { formatModelQueryError, modelQueryError, ModelQueryPhase } from '~/service/ai/modelQueryErrors'

test.each([401, 403])('reliable HTTP %s takes precedence over names or permission messages', (status) => {
  const error = modelQueryError({ status, name: 'SecurityError', message: 'permission denied' }, 'onerror', 12)
  expect(error.code).toBe(status === 401 ? 'AUTH' : 'FORBIDDEN')
  expect(error.diagnostic).toEqual({ classification: 'HTTP', httpStatus: status, phase: 'onerror', elapsedMs: 12 })
})

test.each([
  { name: 'SecurityError' }, { name: 'NotAllowedError' }, { code: 'PERMISSION_DENIED' },
  { code: 'ERR_ACCESS_DENIED' }, 'permission denied: @connect', '未授权，拒绝访问',
])('only explicit permission evidence is classified as permission: %#', (value) => {
  expect(modelQueryError(value, 'invoke', 1)).toMatchObject({ code: 'PERMISSION', diagnostic: { classification: 'PERMISSION', httpStatus: null } })
})

test.each(['Failed to fetch', 'check @connect settings', { name: 'TypeError' }, { status: 0 }, { status: '403' }])('ambiguous errors stay network/unknown rather than guessing a permission failure: %#', (value) => {
  expect(modelQueryError(value, 'onerror', 5)).toMatchObject({ code: 'NETWORK', diagnostic: { classification: 'NETWORK', httpStatus: null } })
})

test.each([{ name: 'TimeoutError' }, { code: 'ETIMEDOUT' }])('a promise timeout preserves its classification: %#', (value) => {
  expect(modelQueryError(value, 'promise-rejection', 50)).toMatchObject({ code: 'TIMEOUT', diagnostic: { classification: 'TIMEOUT', phase: 'promise-rejection' } })
})

test('diagnostics contain exactly four allowed fields and never retain sensitive error data', () => {
  const secret = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
  const source = Object.assign(new Error(secret), {
    status: 403, headers: { Authorization: secret }, responseText: secret,
    config: { apiKey: secret }, cause: { token: secret }, stack: secret,
  })
  const error = modelQueryError(source, 'onerror', 17)
  expect(Object.keys(error.diagnostic).sort()).toEqual(['classification', 'elapsedMs', 'httpStatus', 'phase'])
  expect(Object.isFrozen(error.diagnostic)).toBe(true)
  expect(error).not.toHaveProperty('cause')
  expect(error).not.toHaveProperty('headers')
  for (const value of [formatModelQueryError(error), error.message, error.stack, JSON.stringify(error)]) {
    expect(value).not.toContain(secret)
  }
  expect(formatModelQueryError(error)).toBe('模型列表查询失败：分类=HTTP；HTTP=403；阶段=onerror；耗时=17ms。')
})

test('unsafe names, phases and mutated error messages are never rendered', () => {
  const secret = Math.random().toString(36).slice(2)
  const error = modelQueryError({ name: secret, message: secret }, secret as ModelQueryPhase, Infinity)
  error.message = secret
  expect(formatModelQueryError(error)).toBe('模型列表查询失败：分类=NETWORK；HTTP=无状态；阶段=invoke；耗时=0ms。')
  expect(JSON.stringify(error)).not.toContain(secret)
  expect(formatModelQueryError(new Error(secret))).not.toContain(secret)
})

test('throwing getters cannot crash classification or leak the source error', () => {
  const source = new Proxy({}, { get: () => { throw Error('private') } })
  expect(modelQueryError(source, 'invoke', -50).diagnostic).toEqual({ classification: 'NETWORK', httpStatus: null, phase: 'invoke', elapsedMs: 0 })
})

test('safe pre-request validation errors keep their existing guidance', () => {
  expect(formatModelQueryError(new AiClientError('MISSING_API_KEY'))).toContain('密钥')
})
