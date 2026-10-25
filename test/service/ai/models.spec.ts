import { fetchAiModels } from '~/service/ai/models'
import { AiGmGetRequestOptions } from '~/service/ai/transport'

const globals = globalThis as unknown as Record<string, unknown>
const original = Object.getOwnPropertyDescriptor(globalThis, 'GM')
const legacy = Object.getOwnPropertyDescriptor(globalThis, 'GM_xmlhttpRequest')
const key = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
let options: AiGmGetRequestOptions
let request: jest.Mock
let abort: jest.Mock

beforeEach(() => {
  jest.useFakeTimers()
  abort = jest.fn()
  request = jest.fn((value: AiGmGetRequestOptions) => { options = value; return { abort } })
  Object.defineProperty(globalThis, 'GM', { value: { xmlHttpRequest: request }, configurable: true, writable: true })
  delete globals.GM_xmlhttpRequest
})
afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  if (original) Object.defineProperty(globalThis, 'GM', original)
  else delete globals.GM
  if (legacy) Object.defineProperty(globalThis, 'GM_xmlhttpRequest', legacy)
  else delete globals.GM_xmlhttpRequest
})

test.each(['https://api.deepseek.com', 'https://api.openai.com/v1', 'https://gateway.example.test/my/provider/v1/'])('sends exactly one credentialed GET to the explicitly chosen base: %s', async (baseUrl) => {
  const apiKey = key()
  const task = fetchAiModels({ baseUrl, apiKey })
  expect(request).toHaveBeenCalledTimes(1)
  expect(options).toMatchObject({ method: 'GET', url: `${baseUrl.replace(/\/+$/, '')}/models`, anonymous: true, redirect: 'error' })
  expect(options.headers.Authorization).toBe(`Bearer ${apiKey}`)
  expect(options).not.toHaveProperty('data')
  expect(options.headers).not.toHaveProperty('Cookie')
  options.onload({ status: 200, responseText: JSON.stringify({ data: [{ id: 'new-chat-model' }, { id: 'unknown-model' }] }) })
  await expect(task.promise).resolves.toMatchObject({ models: [{ id: 'new-chat-model', kind: 'chat' }, { id: 'unknown-model', kind: 'unknown' }] })
  expect(request).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('deduplicates models, filters obvious non-chat entries, and preserves uncertainty', async () => {
  const apiKey = key()
  const task = fetchAiModels({ baseUrl: 'https://gateway.example.test/v1', apiKey })
  options.onload({ status: 200, response: { data: [
    { id: 'new-model' }, { id: 'new-model' }, { id: 'declared', capabilities: { chat: true } },
    { id: 'text-embedding-3-small' }, { id: 'whisper-1' }, { id: 'gpt-image-1' }, { id: 'custom', type: 'audio' },
    { id: 'gpt-realtime' }, { id: 'gpt-4o-mini-transcribe' },
    { id: '' }, { id: 'bad\nmodel' }, { id: 42 }, { id: apiKey },
  ] } })
  const result = await task.promise
  expect(result).toEqual({ models: [{ id: 'declared', kind: 'chat' }, { id: 'new-model', kind: 'unknown' }], excludedCount: 6 })
  expect(JSON.stringify(result)).not.toContain(apiKey)
})

test.each([404, 405, 501])('unsupported /models reports manual fallback without retry: %s', async (status) => {
  const task = fetchAiModels({ baseUrl: 'https://custom.example.test', apiKey: key() })
  options.onload({ status, responseText: 'private server error' })
  await expect(task.promise).rejects.toMatchObject({ code: 'MODELS_UNAVAILABLE', status })
  expect(request).toHaveBeenCalledTimes(1)
})

test.each([[401, 'AUTH'], [403, 'FORBIDDEN'], [429, 'RATE_LIMIT'], [500, 'SERVER'], [302, 'REDIRECT'], [0, 'NETWORK']])('reports safe HTTP errors: %s', async (status, code) => {
  const apiKey = key()
  const task = fetchAiModels({ baseUrl: 'https://api.openai.com/v1', apiKey })
  options.onload({ status: status as number, responseText: `server echoed ${apiKey}` })
  await expect(task.promise).rejects.toMatchObject({ code })
  await task.promise.catch((error) => { expect(String(error)).not.toContain(apiKey) })
  expect(request).toHaveBeenCalledTimes(1)
})

test('rejects redirect responses and never sends a second request', async () => {
  const task = fetchAiModels({ baseUrl: 'https://custom.example.test', apiKey: key() })
  options.onload({ status: 200, finalUrl: 'https://other.example.test/models', response: { data: [] } })
  await expect(task.promise).rejects.toMatchObject({ code: 'REDIRECT' })
  expect(request).toHaveBeenCalledTimes(1)
})

test.each(['not-json', JSON.stringify({ error: 'secret' }), 'x'.repeat(1000001), JSON.stringify({ data: Array(5001).fill({ id: 'chat' }) })])('rejects invalid or oversized lists safely %#', async (responseText) => {
  const task = fetchAiModels({ baseUrl: 'https://api.deepseek.com', apiKey: key() })
  options.onload({ status: 200, responseText })
  await expect(task.promise).rejects.toMatchObject({ code: 'MODELS_RESPONSE' })
})

test('supports a valid empty list without claiming a working translation model', async () => {
  const task = fetchAiModels({ baseUrl: 'https://api.deepseek.com', apiKey: key() })
  options.onload({ status: 200, response: { data: [] } })
  await expect(task.promise).resolves.toEqual({ models: [], excludedCount: 0 })
})

test('times out once, aborts the handle and ignores a late response', async () => {
  const task = fetchAiModels({ baseUrl: 'https://api.deepseek.com', apiKey: key() }, 50)
  const checked = expect(task.promise).rejects.toMatchObject({ code: 'TIMEOUT' })
  jest.advanceTimersByTime(50)
  await checked
  options.onload({ status: 200, response: { data: [{ id: 'late' }] } })
  expect(abort).toHaveBeenCalledTimes(1)
  expect(request).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('cancel is idempotent even when abort throws', async () => {
  const task = fetchAiModels({ baseUrl: 'https://api.deepseek.com', apiKey: key() })
  abort.mockImplementation(() => { throw Error('private') })
  task.cancel()
  task.cancel()
  await expect(task.promise).rejects.toMatchObject({ code: 'CANCELLED' })
  expect(abort).toHaveBeenCalledTimes(1)
})

test('works with legacy GM and a promise-based modern handle', async () => {
  delete globals.GM
  globals.GM_xmlhttpRequest = request
  const task = fetchAiModels({ baseUrl: 'https://api.deepseek.com', apiKey: key() })
  options.onerror({ secret: 'not displayed' })
  await expect(task.promise).rejects.toMatchObject({ code: 'NETWORK' })
  globals.GM = { xmlHttpRequest: jest.fn(() => Promise.resolve({ status: 200, response: { data: [{ id: 'future-chat' }] } })) }
  await expect(fetchAiModels({ baseUrl: 'https://api.deepseek.com', apiKey: key() }).promise).resolves.toMatchObject({ models: [{ id: 'future-chat' }] })
})

test.each(['http://example.test', 'https://user:password@example.test/v1', 'https://example.test/v1?token=private'])('invalid endpoints never receive a request: %s', async (baseUrl) => {
  await expect(fetchAiModels({ baseUrl, apiKey: key() }).promise).rejects.toMatchObject({ code: 'INVALID_BASE_URL' })
  expect(request).not.toHaveBeenCalled()
})
