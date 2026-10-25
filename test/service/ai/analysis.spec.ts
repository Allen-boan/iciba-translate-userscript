import { AiClientError } from '~/service/ai/errors'
import { AiCompletion, AiCredentials, AiRequest } from '~/service/ai/types'
import { AI_ANALYSIS_CACHE_LIMIT, AI_ANALYSIS_CACHE_TTL_MS, createAnalysisController } from '~/service/ai/analysis'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((rs, rj) => { resolve = rs; reject = rj })
  return { promise, resolve, reject }
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const makeKey = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('-')

const fixture = () => {
  const config: AiCredentials = { baseUrl: 'https://api.example.test/v1', model: 'reading-model', apiKey: makeKey() }
  const credentials = jest.fn(async () => ({ ...config }))
  const cancel = jest.fn()
  const complete = jest.fn((_request: AiRequest) => ({
    promise: Promise.resolve({ text: '简洁解析', finishReason: 'stop' }),
    cancel,
  }))
  let timestamp = 1000
  const controller = createAnalysisController({ credentials, complete, now: () => timestamp })
  const settle = async (text: string) => {
    controller.prepare(text)
    controller.request()
    await flush()
  }
  return { controller, config, credentials, complete, cancel, settle, advanceClock: (delta: number) => { timestamp += delta } }
}

test('preparing and closing selections never prefetch or read credentials', async () => {
  const f = fixture()
  f.controller.prepare('word')
  await flush()
  expect(f.controller.state).toMatchObject({ text: 'word', status: 'idle', expanded: false })
  f.controller.close()
  expect(f.credentials).not.toHaveBeenCalled()
  expect(f.complete).not.toHaveBeenCalled()
})

test('the explicit action sends one detailed request containing only the selected material', async () => {
  const f = fixture()
  await f.settle('  break the ice  ')
  expect(f.complete).toHaveBeenCalledTimes(1)
  const request = f.complete.mock.calls[0][0]
  expect(request.messages.map(message => message.role)).toEqual(['system', 'user'])
  expect(request.messages[0].content).toContain('主动请求的深入解析')
  expect(JSON.parse(request.messages[1].content)).toEqual({ text: 'break the ice', kindHint: 'unknown' })
  expect(request.config).toEqual(f.config)
  expect(request.maxTokens).toBe(1536)
  expect(request.timeoutMs).toBe(45000)
  expect(f.controller.state).toMatchObject({ status: 'success', result: '简洁解析', expanded: true, cached: false })
  expect(JSON.stringify(f.controller.state)).not.toContain(f.config.apiKey)
})

test('duplicate actions while reading credentials do not create duplicate requests', async () => {
  const f = fixture()
  const lookup = deferred<AiCredentials>()
  f.credentials.mockReturnValue(lookup.promise)
  f.controller.prepare('hello')
  f.controller.request()
  f.controller.request()
  f.controller.toggle()
  expect(f.credentials).toHaveBeenCalledTimes(1)
  lookup.resolve({ ...f.config })
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
})

test('duplicate clicks in flight are ignored and successful output toggles without another lookup', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValue({ promise: pending.promise, cancel: f.cancel })
  f.controller.prepare('hello')
  f.controller.toggle()
  await flush()
  f.controller.toggle()
  f.controller.request()
  expect(f.complete).toHaveBeenCalledTimes(1)
  pending.resolve({ text: '解析', finishReason: 'stop' })
  await flush()
  f.controller.toggle()
  expect(f.controller.state.expanded).toBe(false)
  f.controller.toggle()
  expect(f.controller.state.expanded).toBe(true)
  f.controller.collapse()
  f.controller.request()
  expect(f.controller.state.expanded).toBe(true)
  expect(f.credentials).toHaveBeenCalledTimes(1)
  expect(f.complete).toHaveBeenCalledTimes(1)
})

test('changing selection during credential lookup prevents the old request', async () => {
  const f = fixture()
  const lookup = deferred<AiCredentials>()
  f.credentials.mockReturnValue(lookup.promise)
  f.controller.prepare('old')
  f.controller.request()
  f.controller.prepare('new')
  lookup.resolve({ ...f.config })
  await flush()
  expect(f.complete).not.toHaveBeenCalled()
  expect(f.controller.state).toMatchObject({ text: 'new', status: 'idle', result: '', expanded: false })
})

test('changing selection cancels the old request and ignores its late result', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValueOnce({ promise: pending.promise, cancel: f.cancel })
  f.controller.prepare('old')
  f.controller.request()
  await flush()
  f.controller.prepare('new')
  expect(f.cancel).toHaveBeenCalledTimes(1)
  pending.resolve({ text: 'old analysis', finishReason: 'stop' })
  await flush()
  expect(f.controller.state).toMatchObject({ text: 'new', status: 'idle', result: '' })
  await f.settle('old')
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.controller.state.result).toBe('简洁解析')
})

test('closing clears visible output and cancels an active request', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValue({ promise: pending.promise, cancel: f.cancel })
  f.controller.prepare('hello')
  f.controller.request()
  await flush()
  f.controller.close()
  pending.reject(new AiClientError('NETWORK'))
  await flush()
  expect(f.cancel).toHaveBeenCalledTimes(1)
  expect(f.controller.state).toEqual({ text: '', result: '', status: 'idle', errorMessage: '', expanded: false, cached: false })
})

test('cancel during credential lookup settles locally and permits only an explicit retry', async () => {
  const f = fixture()
  const lookup = deferred<AiCredentials>()
  f.credentials.mockReturnValueOnce(lookup.promise)
  f.controller.prepare('hello')
  f.controller.request()
  f.controller.cancel()
  lookup.resolve({ ...f.config })
  await flush()
  expect(f.complete).not.toHaveBeenCalled()
  expect(f.controller.state.status).toBe('cancelled')
  f.controller.request()
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.controller.state.status).toBe('success')
})

test('errors are safe, never cached and do not retry automatically', async () => {
  const f = fixture()
  f.complete.mockReturnValueOnce({ promise: Promise.reject(new Error(f.config.apiKey)), cancel: f.cancel })
  await f.settle('hello')
  expect(f.controller.state).toMatchObject({ status: 'error', result: '', expanded: true, cached: false })
  expect(f.controller.state.errorMessage).not.toContain(f.config.apiKey)
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
  f.controller.toggle()
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.controller.state.status).toBe('success')
})

test.each([
  { text: '', finishReason: 'stop' },
  { text: 'partial', finishReason: 'length' },
  { text: null, finishReason: 'stop' },
])('rejects incomplete or malformed analysis %#', async (completion) => {
  const f = fixture()
  f.complete.mockReturnValueOnce({ promise: Promise.resolve(completion as AiCompletion), cancel: f.cancel })
  await f.settle('hello')
  expect(f.controller.state).toMatchObject({ status: 'error', result: '', cached: false })
})

test('empty or excessive text does not read credentials or make a request', async () => {
  const f = fixture()
  await f.settle('  ')
  expect(f.controller.state.status).toBe('idle')
  await f.settle('😀'.repeat(2001))
  expect(f.controller.state.errorMessage).toContain('2000')
  expect(f.credentials).not.toHaveBeenCalled()
  expect(f.complete).not.toHaveBeenCalled()
  await f.settle('😀'.repeat(2000))
  expect(f.complete).toHaveBeenCalledTimes(1)
})

test('cross-selection cache hits remain behind the explicit action and read current credentials', async () => {
  const f = fixture()
  await f.settle('hello')
  f.controller.close()
  f.controller.prepare('hello')
  await flush()
  expect(f.controller.state.result).toBe('')
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.credentials).toHaveBeenCalledTimes(1)
  f.controller.request()
  await flush()
  expect(f.credentials).toHaveBeenCalledTimes(2)
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.controller.state).toMatchObject({ result: '简洁解析', cached: true, expanded: true })
})

test('expired cache entries cause a new request only after the user asks', async () => {
  const f = fixture()
  await f.settle('hello')
  f.advanceClock(AI_ANALYSIS_CACHE_TTL_MS + 1)
  f.controller.prepare('hello')
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
  f.controller.request()
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.controller.state.cached).toBe(false)
})

test.each(['baseUrl', 'model', 'apiKey'] as const)('isolates the cache when %s changes', async (field) => {
  const f = fixture()
  await f.settle('hello')
  f.config[field] = field === 'baseUrl' ? 'https://another.example.test/v1' : makeKey()
  await f.settle('hello')
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.controller.state.cached).toBe(false)
  expect(JSON.stringify(f.controller.state)).not.toContain(f.config.apiKey)
})

test('analysis cache is bounded and evicts the least recently used entry', async () => {
  const f = fixture()
  for (let i = 0; i < AI_ANALYSIS_CACHE_LIMIT; i++) await f.settle(`word-${i}`)
  await f.settle('word-0')
  expect(f.controller.state.cached).toBe(true)
  await f.settle('one-more')
  const count = f.complete.mock.calls.length
  await f.settle('word-1')
  expect(f.complete).toHaveBeenCalledTimes(count + 1)
})

test('invalidating the cache never starts a replacement request', async () => {
  const f = fixture()
  await f.settle('hello')
  f.controller.invalidateCache()
  await flush()
  expect(f.controller.state.status).toBe('idle')
  expect(f.complete).toHaveBeenCalledTimes(1)
  await f.settle('hello')
  expect(f.complete).toHaveBeenCalledTimes(2)
})

test('disposing cancels pending work and ignores future user actions', async () => {
  const f = fixture()
  const pending = deferred<AiCompletion>()
  f.complete.mockReturnValue({ promise: pending.promise, cancel: f.cancel })
  f.controller.prepare('hello')
  f.controller.request()
  await flush()
  f.controller.dispose()
  f.controller.dispose()
  pending.resolve({ text: 'late', finishReason: 'stop' })
  await flush()
  f.controller.prepare('new')
  f.controller.request()
  f.controller.toggle()
  expect(f.cancel).toHaveBeenCalledTimes(1)
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.controller.state).toMatchObject({ text: '', result: '', status: 'idle', expanded: false })
})
