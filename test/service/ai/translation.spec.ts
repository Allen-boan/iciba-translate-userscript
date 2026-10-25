import { AiClientError } from '~/service/ai/errors'
import { AiCompletion, AiCredentials, AiRequest } from '~/service/ai/types'
import {
  AI_TRANSLATION_CACHE_LIMIT,
  AI_TRANSLATION_CACHE_TTL_MS,
  AI_TRANSLATION_DEBOUNCE_MS,
  createTranslationController,
} from '~/service/ai/translation'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((rs, rj) => { resolve = rs; reject = rj })
  return { promise, resolve, reject }
}

const makeKey = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('-')
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

const fixture = () => {
  const config: AiCredentials = { baseUrl: 'https://api.example.test/v1', model: 'reading-model', apiKey: makeKey() }
  const credentials = jest.fn(async () => ({ ...config }))
  const abort = jest.fn()
  const complete = jest.fn((_request: AiRequest) => ({
    promise: Promise.resolve({ text: '简短翻译', finishReason: 'stop' }),
    cancel: abort,
  }))
  let timestamp = 1000
  const controller = createTranslationController({ credentials, complete, now: () => timestamp })
  const settle = async (text: string) => {
    controller.select(text)
    jest.advanceTimersByTime(AI_TRANSLATION_DEBOUNCE_MS)
    await flush()
  }
  return { config, credentials, complete, abort, controller, settle, advanceClock: (delta: number) => { timestamp += delta } }
}

beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers() })

test('selection is debounced and only the final text reaches the basic prompt', async () => {
  const f = fixture()
  f.controller.select('first')
  jest.advanceTimersByTime(100)
  f.controller.select('final phrase')
  jest.advanceTimersByTime(AI_TRANSLATION_DEBOUNCE_MS - 1)
  expect(f.credentials).not.toHaveBeenCalled()
  jest.advanceTimersByTime(1)
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
  const request = f.complete.mock.calls[0][0]
  expect(JSON.parse(request.messages[1].content)).toMatchObject({ text: 'final phrase' })
  expect(request.messages[0].content).toContain('基础翻译')
  expect(request.messages[0].content).not.toContain('当前任务是用户主动请求的深入解析')
  expect(f.controller.state).toMatchObject({ text: 'final phrase', status: 'success', result: '简短翻译', cached: false })
})

test('duplicate events do not restart debounce or duplicate an active request', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValue({ promise: pending.promise, cancel: f.abort })
  f.controller.select('hello')
  jest.advanceTimersByTime(100)
  f.controller.select(' hello ')
  jest.advanceTimersByTime(AI_TRANSLATION_DEBOUNCE_MS - 100)
  await flush()
  f.controller.select('hello')
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.abort).not.toHaveBeenCalled()
  pending.resolve({ text: '你好', finishReason: 'stop' })
  await flush()
})

test('empty and excessive input never reaches credentials or the API', async () => {
  const f = fixture()
  await f.settle('   ')
  expect(f.controller.state.status).toBe('idle')
  await f.settle('😀'.repeat(2001))
  expect(f.controller.state.errorMessage).toContain('2000')
  expect(f.credentials).not.toHaveBeenCalled()
  expect(f.complete).not.toHaveBeenCalled()
  await f.settle('😀'.repeat(2000))
  expect(f.complete).toHaveBeenCalledTimes(1)
})

test('selecting new text cancels transport and ignores the old completion', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValueOnce({ promise: pending.promise, cancel: f.abort })
  await f.settle('old')
  f.controller.select('new')
  expect(f.abort).toHaveBeenCalledTimes(1)
  pending.resolve({ text: 'old result', finishReason: 'stop' })
  await flush()
  expect(f.controller.state.result).toBe('')
  expect(f.controller.state.text).toBe('new')
  jest.advanceTimersByTime(AI_TRANSLATION_DEBOUNCE_MS)
  await flush()
  expect(f.controller.state.result).toBe('简短翻译')
})

test('cancellation during asynchronous credential lookup prevents any request', async () => {
  const f = fixture()
  const pending = deferred<AiCredentials>()
  f.credentials.mockReturnValue(pending.promise)
  f.controller.select('hello')
  jest.advanceTimersByTime(AI_TRANSLATION_DEBOUNCE_MS)
  f.controller.cancel()
  pending.resolve(f.config)
  await flush()
  expect(f.complete).not.toHaveBeenCalled()
  expect(f.controller.state.status).toBe('cancelled')
})

test('close cancels a pending debounce and clears private reading state', async () => {
  const f = fixture()
  f.controller.select('private reading text')
  f.controller.close()
  jest.runAllTimers()
  await flush()
  expect(f.complete).not.toHaveBeenCalled()
  expect(f.controller.state).toEqual({ text: '', result: '', sourceLanguage: null, targetLanguage: 'zh-CN', status: 'idle', errorMessage: '', cached: false })
})

test('closing an in-flight request ignores late rejection without exposing remote text', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValueOnce({ promise: pending.promise, cancel: f.abort })
  await f.settle('hello')
  f.controller.close()
  pending.reject(new Error(f.config.apiKey))
  await flush()
  expect(f.abort).toHaveBeenCalledTimes(1)
  expect(f.controller.state.errorMessage).toBe('')
  expect(f.controller.state.status).toBe('idle')
})

test('cache hits still read current credentials and do not send another request', async () => {
  const f = fixture()
  await f.settle('hello')
  f.controller.close()
  await f.settle('hello')
  expect(f.credentials).toHaveBeenCalledTimes(2)
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.controller.state.cached).toBe(true)
  expect(JSON.stringify(f.controller.state)).not.toContain(f.config.apiKey)
})

test('expired cached entries require a new request', async () => {
  const f = fixture()
  await f.settle('hello')
  f.advanceClock(AI_TRANSLATION_CACHE_TTL_MS)
  await f.settle('hello')
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.controller.state.cached).toBe(false)
})

test.each(['baseUrl', 'model', 'apiKey'] as const)('changing %s invalidates cache partition', async (field) => {
  const f = fixture()
  await f.settle('hello')
  if (field === 'baseUrl') f.config.baseUrl = 'https://other.example.test/v1'
  if (field === 'model') f.config.model = 'another-model'
  if (field === 'apiKey') f.config.apiKey = makeKey()
  await f.settle('hello')
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.controller.state.cached).toBe(false)
})

test('cache is bounded and refreshes least-recently-used order', async () => {
  const f = fixture()
  for (let i = 0; i < AI_TRANSLATION_CACHE_LIMIT; i++) await f.settle(`word ${i}`)
  await f.settle('word 0')
  expect(f.controller.state.cached).toBe(true)
  await f.settle('new entry')
  const calls = f.complete.mock.calls.length
  await f.settle('word 0')
  expect(f.complete).toHaveBeenCalledTimes(calls)
  await f.settle('word 1')
  expect(f.complete).toHaveBeenCalledTimes(calls + 1)
})

test('failures are safe and never cached or automatically retried', async () => {
  const f = fixture()
  f.complete.mockReturnValueOnce({ promise: Promise.reject(new Error(f.config.apiKey)), cancel: f.abort })
  await f.settle('hello')
  expect(f.controller.state.status).toBe('error')
  expect(f.controller.state.errorMessage).not.toContain(f.config.apiKey)
  jest.runAllTimers()
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
  f.controller.retry()
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.controller.state.status).toBe('success')
})

test('missing configuration is a visible safe error without issuing a request', async () => {
  const f = fixture()
  f.credentials.mockRejectedValue(new AiClientError('MISSING_API_KEY'))
  await f.settle('hello')
  expect(f.controller.state.status).toBe('error')
  expect(f.controller.state.errorMessage).toContain('密钥')
  expect(f.complete).not.toHaveBeenCalled()
})

test('invalid mocked completions cannot become a successful cached result', async () => {
  const f = fixture()
  f.complete.mockReturnValueOnce({ promise: Promise.resolve({ text: 'partial', finishReason: 'length' }), cancel: f.abort })
  await f.settle('hello')
  expect(f.controller.state.status).toBe('error')
  await f.settle('hello')
  expect(f.complete).toHaveBeenCalledTimes(2)
})

test('explicit cache invalidation cancels work and never starts a new request itself', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValueOnce({ promise: pending.promise, cancel: f.abort })
  await f.settle('hello')
  f.controller.invalidateCache()
  pending.resolve({ text: 'stale answer', finishReason: 'stop' })
  await flush()
  expect(f.abort).toHaveBeenCalledTimes(1)
  expect(f.controller.state.result).toBe('')
  expect(f.controller.state.status).toBe('cancelled')
  expect(f.complete).toHaveBeenCalledTimes(1)
})

test('dispose prevents all subsequent selections and ignores late credential resolution', async () => {
  const f = fixture()
  const pending = deferred<AiCredentials>()
  f.credentials.mockReturnValue(pending.promise)
  f.controller.select('hello')
  jest.advanceTimersByTime(AI_TRANSLATION_DEBOUNCE_MS)
  f.controller.dispose()
  pending.resolve(f.config)
  await flush()
  f.controller.select('another')
  f.controller.retry()
  jest.runAllTimers()
  await flush()
  expect(f.complete).not.toHaveBeenCalled()
  expect(f.controller.state.status).toBe('idle')
})
