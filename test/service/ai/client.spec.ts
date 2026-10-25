import { createChatCompletion, testAiConnection } from '~/service/ai/client'
import { AiClientError } from '~/service/ai/errors'
import { AiGmRequestOptions, AiGmResponse } from '~/service/ai/transport'
import { AiCredentials, AiMessage, AiRequest } from '~/service/ai/types'

const globals = globalThis as unknown as Record<string, unknown>
const originalModern = Object.getOwnPropertyDescriptor(globalThis, 'GM')
const originalLegacy = Object.getOwnPropertyDescriptor(globalThis, 'GM_xmlhttpRequest')

const credentials = (baseUrl = 'https://api.deepseek.com'): AiCredentials => ({
  baseUrl,
  model: 'configured-model',
  apiKey: `test-${Math.random().toString(36).slice(2)}`,
})
const messages = (): Array<AiMessage> => [{ role: 'user', content: 'hello' }]
const answer = (content: unknown = '你好', finishReason = 'stop') => ({
  choices: [{ message: { content }, finish_reason: finishReason }],
})
const response = (payload: unknown = answer(), status = 200): AiGmResponse => ({
  status,
  responseText: JSON.stringify(payload),
})

let options: AiGmRequestOptions
let abort: jest.Mock
let request: jest.Mock

beforeEach(() => {
  jest.useFakeTimers()
  abort = jest.fn()
  request = jest.fn((value: AiGmRequestOptions) => {
    options = value
    return { abort }
  })
  Object.defineProperty(globalThis, 'GM', { value: { xmlHttpRequest: request }, configurable: true, writable: true })
  delete globals.GM_xmlhttpRequest
})

afterEach(() => {
  jest.clearAllTimers()
  jest.useRealTimers()
  if (originalModern) Object.defineProperty(globalThis, 'GM', originalModern)
  else delete globals.GM
  if (originalLegacy) Object.defineProperty(globalThis, 'GM_xmlhttpRequest', originalLegacy)
  else delete globals.GM_xmlhttpRequest
})

test('sends one anonymous POST with an immutable request snapshot and no redirect following', async () => {
  const config = credentials('https://api.deepseek.com/v1/')
  const expectedKey = config.apiKey
  const selectedMessages = messages()
  const task = createChatCompletion({ config, messages: selectedMessages, maxTokens: 512 })
  config.model = 'changed'
  config.apiKey = 'changed after dispatch'
  selectedMessages[0].content = 'changed after dispatch'

  expect(request).toHaveBeenCalledTimes(1)
  expect(options.url).toBe('https://api.deepseek.com/v1/chat/completions')
  expect(options.method).toBe('POST')
  expect(options.anonymous).toBe(true)
  expect(options.redirect).toBe('error')
  expect(options.headers.Authorization).toBe(`Bearer ${expectedKey}`)
  expect(options.headers).not.toHaveProperty('Cookie')
  expect(options.headers).not.toHaveProperty('Referer')
  expect(JSON.parse(options.data)).toEqual({
    model: 'configured-model',
    messages: [{ role: 'user', content: 'hello' }],
    stream: false,
    max_tokens: 512,
    thinking: { type: 'disabled' },
  })
  options.onload(response())
  await expect(task.promise).resolves.toEqual({ text: '你好', finishReason: 'stop' })
  expect(jest.getTimerCount()).toBe(0)
})

test('uses the OpenAI output limit field without unsupported vendor options', async () => {
  const task = createChatCompletion({ config: credentials('https://api.openai.com/v1'), messages: messages() })
  const body = JSON.parse(options.data)
  expect(body.max_completion_tokens).toBe(768)
  expect(body).not.toHaveProperty('max_tokens')
  expect(body).not.toHaveProperty('thinking')
  expect(body).not.toHaveProperty('temperature')
  expect(body).not.toHaveProperty('response_format')
  options.onload(response())
  await task.promise
})

test('preserves gateway paths and never treats a similar hostname as an official vendor', async () => {
  const task = createChatCompletion({ config: credentials('https://api.openai.com.example.org/proxy/v1'), messages: messages() })
  expect(options.url).toBe('https://api.openai.com.example.org/proxy/v1/chat/completions')
  const body = JSON.parse(options.data)
  expect(body.max_tokens).toBe(768)
  expect(body).not.toHaveProperty('max_completion_tokens')
  expect(body).not.toHaveProperty('thinking')
  options.onload(response())
  await task.promise
})

test('binds the modern GM request method to its API object', async () => {
  const modern = {
    xmlHttpRequest: function send(value: AiGmRequestOptions) {
      expect(this).toBe(modern)
      value.onload(response())
      return { abort }
    },
  }
  globals.GM = modern
  await expect(createChatCompletion({ config: credentials(), messages: messages() }).promise).resolves.toHaveProperty('text', '你好')
  expect(jest.getTimerCount()).toBe(0)
})

test('supports a legacy-only environment without referencing an undeclared modern GM', async () => {
  delete globals.GM
  globals.GM_xmlhttpRequest = request
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response())
  await expect(task.promise).resolves.toHaveProperty('text', '你好')
})

test('falls back to legacy when a manager exposes a null modern GM object', async () => {
  globals.GM = null
  globals.GM_xmlhttpRequest = request
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response())
  await expect(task.promise).resolves.toHaveProperty('text', '你好')
})

test('fails safely when the manager request API is unavailable', async () => {
  delete globals.GM
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  await expect(task.promise).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  expect(jest.getTimerCount()).toBe(0)
})

test.each([0, -1, 1.5, NaN, 8193])('rejects invalid output limit %s before requesting', async (maxTokens) => {
  const task = createChatCompletion({ config: credentials(), messages: messages(), maxTokens })
  await expect(task.promise).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  expect(request).not.toHaveBeenCalled()
})

test.each([0, -1, 1.5, NaN, 120001])('rejects invalid timeout %s before requesting', async (timeoutMs) => {
  const task = createChatCompletion({ config: credentials(), messages: messages(), timeoutMs })
  await expect(task.promise).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  expect(request).not.toHaveBeenCalled()
})

test('rejects empty or malformed conversations before requesting', async () => {
  for (const conversation of [[], [{ role: 'user', content: '' }], [{ role: 'tool', content: 'hello' }]]) {
    const task = createChatCompletion({ config: credentials(), messages: conversation as Array<AiMessage> })
    await expect(task.promise).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  }
  expect(request).not.toHaveBeenCalled()
})

test('rejects a null request with a validation error before requesting', async () => {
  const task = createChatCompletion(null as unknown as AiRequest)
  await expect(task.promise).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  expect(request).not.toHaveBeenCalled()
})

const httpCases: Array<[number, string]> = [
  [301, 'REDIRECT'], [400, 'BAD_REQUEST'], [401, 'AUTH'], [402, 'QUOTA'],
  [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [408, 'TIMEOUT'], [429, 'RATE_LIMIT'],
  [500, 'SERVER'], [503, 'SERVER'], [418, 'HTTP'],
]
test.each(httpCases)('maps HTTP %s to a static safe error', async (status, code) => {
  const config = credentials()
  const task = createChatCompletion({ config, messages: messages() })
  options.onload(response({ error: { message: config.apiKey } }, status))
  const error = await task.promise.catch((value: AiClientError) => value)
  expect(error).toMatchObject({ code, status })
  expect(JSON.stringify(error)).not.toContain(config.apiKey)
  expect((error as AiClientError).message).not.toContain(config.apiKey)
  expect(request).toHaveBeenCalledTimes(1)
})

test('rejects changed final URLs defensively', async () => {
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload({ ...response(), finalUrl: 'https://other.example.org/chat/completions' })
  await expect(task.promise).rejects.toMatchObject({ code: 'REDIRECT' })
})

test('accepts an unchanged final URL', async () => {
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload({ ...response(), finalUrl: options.url })
  await expect(task.promise).resolves.toHaveProperty('text', '你好')
})

test.each([null, {}, { choices: [] }, { choices: [{}] }, answer(null), answer('  '), answer(3), answer('text', 'tool_calls')])(
  'rejects malformed or empty completions %#',
  async (payload) => {
    const task = createChatCompletion({ config: credentials(), messages: messages() })
    options.onload(response(payload))
    await expect(task.promise).rejects.toMatchObject({ code: 'RESPONSE' })
  },
)

test('rejects HTML or invalid outer JSON without exposing the response', async () => {
  const config = credentials()
  const task = createChatCompletion({ config, messages: messages() })
  options.onload({ status: 200, responseText: `<html>${config.apiKey}</html>` })
  const error = await task.promise.catch((value: AiClientError) => value)
  expect(error).toMatchObject({ code: 'RESPONSE' })
  expect((error as AiClientError).message).not.toContain(config.apiKey)
})

test('supports managers returning the parsed outer response object', async () => {
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload({ status: 200, response: answer('  你好  ') })
  await expect(task.promise).resolves.toEqual({ text: '你好', finishReason: 'stop' })
})

test('never substitutes reasoning content for the final answer', async () => {
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response({ choices: [{ finish_reason: 'stop', message: { content: null, reasoning_content: 'hidden' } }] }))
  await expect(task.promise).rejects.toMatchObject({ code: 'RESPONSE' })
})

test('reports truncation and refusal without treating them as successful results', async () => {
  const truncated = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response(answer('partial', 'length')))
  await expect(truncated.promise).rejects.toMatchObject({ code: 'TRUNCATED' })
  const filtered = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response(answer('text', 'content_filter')))
  await expect(filtered.promise).rejects.toMatchObject({ code: 'REFUSED' })
  const refused = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response({ choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'reason' } }] }))
  await expect(refused.promise).rejects.toMatchObject({ code: 'REFUSED' })
})

test('local timeout settles and aborts even when the manager never calls back', async () => {
  const task = createChatCompletion({ config: credentials(), messages: messages(), timeoutMs: 25 })
  const rejected = expect(task.promise).rejects.toMatchObject({ code: 'TIMEOUT' })
  jest.advanceTimersByTime(25)
  await rejected
  expect(abort).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
  options.onload(response())
  expect(abort).toHaveBeenCalledTimes(1)
})

test('cancel settles immediately and ignores all late manager callbacks', async () => {
  abort.mockImplementation(() => options.onabort())
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  const rejected = expect(task.promise).rejects.toMatchObject({ code: 'CANCELLED' })
  task.cancel()
  task.cancel()
  options.onload(response())
  options.onerror()
  await rejected
  expect(abort).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('does not abort a request that already completed', async () => {
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response())
  task.cancel()
  await expect(task.promise).resolves.toHaveProperty('text', '你好')
  expect(abort).not.toHaveBeenCalled()
})

test('maps manager timeout, abort, zero status and transport errors', async () => {
  const timed = createChatCompletion({ config: credentials(), messages: messages() })
  options.ontimeout()
  await expect(timed.promise).rejects.toMatchObject({ code: 'TIMEOUT' })
  const stopped = createChatCompletion({ config: credentials(), messages: messages() })
  options.onabort()
  await expect(stopped.promise).rejects.toMatchObject({ code: 'CANCELLED' })
  const zero = createChatCompletion({ config: credentials(), messages: messages() })
  options.onload(response({}, 0))
  await expect(zero.promise).rejects.toMatchObject({ code: 'NETWORK' })
  const failed = createChatCompletion({ config: credentials(), messages: messages() })
  options.onerror({ message: 'untrusted manager error' })
  await expect(failed.promise).rejects.toMatchObject({ code: 'NETWORK' })
})

test('handles synchronous failure callbacks before the abort handle is returned', async () => {
  request.mockImplementation((value: AiGmRequestOptions) => {
    value.ontimeout()
    return { abort }
  })
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  await expect(task.promise).rejects.toMatchObject({ code: 'TIMEOUT' })
  expect(abort).toHaveBeenCalledTimes(1)
  expect(jest.getTimerCount()).toBe(0)
})

test('handles synchronous manager throws without leaking exception details', async () => {
  const config = credentials()
  request.mockImplementation(() => { throw new Error(config.apiKey) })
  const task = createChatCompletion({ config, messages: messages() })
  const error = await task.promise.catch((value: AiClientError) => value)
  expect(error).toMatchObject({ code: 'NETWORK' })
  expect((error as AiClientError).message).not.toContain(config.apiKey)
  expect(jest.getTimerCount()).toBe(0)
})

test('supports modern promise responses and promise cancellation handles', async () => {
  const handle = Object.assign(Promise.resolve(response()), { abort })
  request.mockReturnValue(handle)
  await expect(createChatCompletion({ config: credentials(), messages: messages() }).promise).resolves.toHaveProperty('text', '你好')
  expect(jest.getTimerCount()).toBe(0)
})

test('settles once when modern managers both call onload and resolve their promise', async () => {
  request.mockImplementation((value: AiGmRequestOptions) => {
    value.onload(response(answer('callback answer')))
    return Object.assign(Promise.resolve(response(answer('late promise answer'))), { abort })
  })
  const task = createChatCompletion({ config: credentials(), messages: messages() })
  await expect(task.promise).resolves.toHaveProperty('text', 'callback answer')
  await Promise.resolve()
  task.cancel()
  expect(abort).not.toHaveBeenCalled()
  expect(jest.getTimerCount()).toBe(0)
})

test('consumes rejected manager promises and ignores rejection after cancellation', async () => {
  const config = credentials()
  request.mockReturnValue(Promise.reject(new Error(config.apiKey)))
  const failed = createChatCompletion({ config, messages: messages() })
  await expect(failed.promise).rejects.toMatchObject({ code: 'NETWORK' })
  let rejectManager: (error: Error) => void = () => {}
  const handle = Object.assign(new Promise<AiGmResponse>((_resolve, reject) => { rejectManager = reject }), { abort })
  request.mockReturnValue(handle)
  const stopped = createChatCompletion({ config: credentials(), messages: messages() })
  const rejected = expect(stopped.promise).rejects.toMatchObject({ code: 'CANCELLED' })
  stopped.cancel()
  rejectManager(new Error(config.apiKey))
  await rejected
  await Promise.resolve()
  expect(jest.getTimerCount()).toBe(0)
})

test('connection testing sends only its fixed short prompt with bounded limits', async () => {
  const task = testAiConnection(credentials())
  const body = JSON.parse(options.data)
  expect(body.max_tokens).toBe(64)
  expect(options.timeout).toBe(15000)
  expect(body.messages.map((value: AiMessage) => value.content).join('').length).toBeLessThan(100)
  expect(request).toHaveBeenCalledTimes(1)
  options.onload(response(answer('OK')))
  await expect(task.promise).resolves.toHaveProperty('text', 'OK')
})
