import { validateAiCredentials } from './config'
import { AiClientError } from './errors'
import { buildConnectionTestMessages } from './prompts'
import { getAiGmRequest, AiGmResponse } from './transport'
import { AiCompletion, AiCredentials, AiMessage, AiRequest, AiTask } from './types'

const DEFAULT_TIMEOUT_MS = 30000
const DEFAULT_MAX_TOKENS = 768
const MAX_MESSAGE_CHARACTERS = 32000
const MAX_RESPONSE_CHARACTERS = 1000000

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)


const isBoundedInteger = (value: number, maximum: number) => Number.isInteger(value) && value > 0 && value <= maximum


const copyMessages = (messages: ReadonlyArray<AiMessage>): Array<AiMessage> => {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 30) {
    throw new AiClientError('INVALID_REQUEST')
  }
  let length = 0
  return messages.map((message: AiMessage) => {
    if (!message || !['system', 'user', 'assistant'].includes(message.role)
      || typeof message.content !== 'string' || !message.content.trim()) {
      throw new AiClientError('INVALID_REQUEST')
    }
    length += message.content.length
    if (length > MAX_MESSAGE_CHARACTERS) {
      throw new AiClientError('INVALID_REQUEST')
    }
    return { role: message.role, content: message.content }
  })
}

const httpError = (status: number): AiClientError => {
  if (status >= 300 && status < 400) {
    return new AiClientError('REDIRECT', status)
  }
  if (status === 400) {
    return new AiClientError('BAD_REQUEST', status)
  }
  if (status === 401) {
    return new AiClientError('AUTH', status)
  }
  if (status === 402) {
    return new AiClientError('QUOTA', status)
  }
  if (status === 403) {
    return new AiClientError('FORBIDDEN', status)
  }
  if (status === 404) {
    return new AiClientError('NOT_FOUND', status)
  }
  if (status === 408) {
    return new AiClientError('TIMEOUT', status)
  }
  if (status === 429) {
    return new AiClientError('RATE_LIMIT', status)
  }
  if (status >= 500 && status <= 599) {
    return new AiClientError('SERVER', status)
  }
  return new AiClientError('HTTP', status)
}

const readCompletion = (response: AiGmResponse, endpoint: string): AiCompletion => {
  if (!response || !Number.isInteger(response.status)) {
    throw new AiClientError('RESPONSE')
  }
  if (response.status === 0) {
    throw new AiClientError('NETWORK')
  }
  if (response.finalUrl) {
    let finalUrl: string
    try {
      finalUrl = new URL(response.finalUrl).href
    } catch {
      throw new AiClientError('REDIRECT')
    }
    if (finalUrl !== endpoint) {
      throw new AiClientError('REDIRECT')
    }
  }
  if (response.status < 200 || response.status >= 300) {
    throw httpError(response.status)
  }

  const raw = typeof response.responseText === 'string' && response.responseText
    ? response.responseText
    : response.response
  let payload: unknown = raw
  if (typeof raw === 'string') {
    if (raw.length > MAX_RESPONSE_CHARACTERS) {
      throw new AiClientError('RESPONSE')
    }
    try {
      payload = JSON.parse(raw) as unknown
    } catch {
      throw new AiClientError('RESPONSE')
    }
  }
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !payload.choices.length) {
    throw new AiClientError('RESPONSE')
  }
  const choice: unknown = payload.choices[0]
  if (!isRecord(choice) || !isRecord(choice.message)) {
    throw new AiClientError('RESPONSE')
  }
  if (choice.finish_reason === 'length') {
    throw new AiClientError('TRUNCATED')
  }
  if (choice.finish_reason === 'content_filter' || choice.message.refusal) {
    throw new AiClientError('REFUSED')
  }
  if (choice.finish_reason !== 'stop' || typeof choice.message.content !== 'string'
    || !choice.message.content.trim() || choice.message.content.length > MAX_RESPONSE_CHARACTERS) {
    throw new AiClientError('RESPONSE')
  }
  return { text: choice.message.content.trim(), finishReason: choice.finish_reason }
}

const abortFunction = (handle: unknown): (() => void) | null => {
  if ((typeof handle === 'object' && handle !== null) || typeof handle === 'function') {
    const abort = (handle as { abort?: unknown }).abort
    if (typeof abort === 'function') {
      const cancel = abort as (this: unknown) => void
      return () => { cancel.call(handle) }
    }
  }
  return null
}

export const createChatCompletion = (request: AiRequest): AiTask => {
  let resolveTask: (value: AiCompletion) => void = () => {}
  let rejectTask: (error: AiClientError) => void = () => {}
  const promise = new Promise<AiCompletion>((resolve, reject) => {
    resolveTask = resolve
    rejectTask = reject
  })
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | null = null
  let shouldAbort = false

  const abortRequest = () => {
    try {
      abort?.()
    } catch {
      // Cancellation remains settled even if the manager cannot abort its transport.
    }
  }
  const fail = (error: AiClientError, cancelTransport = false) => {
    if (settled) {
      return
    }
    settled = true
    if (timer !== undefined) {
      clearTimeout(timer)
    }
    shouldAbort = cancelTransport
    rejectTask(error)
    if (cancelTransport) {
      abortRequest()
    }
  }
  const complete = (response: AiGmResponse, endpoint: string) => {
    if (settled) {
      return
    }
    try {
      const completion = readCompletion(response, endpoint)
      settled = true
      if (timer !== undefined) {
        clearTimeout(timer)
      }
      resolveTask(completion)
    } catch (error) {
      fail(error instanceof AiClientError ? error : new AiClientError('RESPONSE'))
    }
  }

  try {
    if (!request || typeof request !== 'object') {
      throw new AiClientError('INVALID_REQUEST')
    }
    const config = validateAiCredentials(request.config)
    const messages = copyMessages(request.messages)
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS
    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!isBoundedInteger(maxTokens, 8192) || !isBoundedInteger(timeoutMs, 120000)) {
      throw new AiClientError('INVALID_REQUEST')
    }
    const endpoint = `${config.baseUrl}/chat/completions`
    const hostname = new URL(config.baseUrl).hostname
    const payload: Record<string, unknown> = { model: config.model, messages, stream: false }
    if (hostname === 'api.openai.com') {
      payload.max_completion_tokens = maxTokens
    } else {
      payload.max_tokens = maxTokens
    }
    if (hostname === 'api.deepseek.com') {
      payload.thinking = { type: 'disabled' }
    }
    const api = getAiGmRequest()
    timer = setTimeout(() => fail(new AiClientError('TIMEOUT'), true), timeoutMs)
    const handle = api({
      method: 'POST',
      url: endpoint,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      data: JSON.stringify(payload),
      anonymous: true,
      redirect: 'error',
      responseType: 'text',
      timeout: timeoutMs,
      onload: (response) => complete(response, endpoint),
      onerror: () => fail(new AiClientError('NETWORK'), true),
      ontimeout: () => fail(new AiClientError('TIMEOUT'), true),
      onabort: () => fail(new AiClientError('CANCELLED')),
    })
    abort = abortFunction(handle)
    if (shouldAbort) {
      abortRequest()
    }
    if (handle !== null && handle !== undefined
      && typeof (handle as { then?: unknown }).then === 'function') {
      Promise.resolve(handle).then(
        (response) => complete(response as AiGmResponse, endpoint),
        () => fail(new AiClientError('NETWORK'), true),
      )
    }
  } catch (error) {
    fail(error instanceof AiClientError ? error : new AiClientError('NETWORK'), true)
  }

  return { promise, cancel: () => fail(new AiClientError('CANCELLED'), true) }
}

export const testAiConnection = (config: AiCredentials): AiTask => createChatCompletion({
  config,
  messages: buildConnectionTestMessages(),
  maxTokens: 64,
  timeoutMs: 15000,
})
