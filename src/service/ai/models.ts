import { validateAiCredentials } from './config'
import { AiClientError } from './errors'
import { AiCredentials } from './types'
import { AiGmResponse, getAiGmRequest } from './transport'
import { modelQueryError, ModelQueryPhase } from './modelQueryErrors'

export interface AiModel {
  id: string
  kind: 'chat' | 'unknown'
}

export interface AiModelList {
  models: Array<AiModel>
  excludedCount: number
}

export interface AiModelsTask {
  promise: Promise<AiModelList>
  cancel: () => void
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const nonChatId = /(?:^|[/_.-])(?:embeddings?|rerank(?:er)?|whisper|tts|audio|speech|transcribe|transcription|realtime|moderation|dall-e|gpt-image|imagen|video|sora)(?:$|[/_.-])/i

const readModels = (response: AiGmResponse, endpoint: string, secret: string): AiModelList => {
  if (!response || !Number.isInteger(response.status)) throw new AiClientError('MODELS_RESPONSE')
  if (response.finalUrl && response.finalUrl !== endpoint) throw new AiClientError('REDIRECT')
  const { status } = response
  if (status === 0) throw new AiClientError('NETWORK')
  if (status >= 300 && status < 400) throw new AiClientError('REDIRECT', status)
  if ([404, 405, 501].includes(status)) throw new AiClientError('MODELS_UNAVAILABLE', status)
  if (status === 401) throw new AiClientError('AUTH', status)
  if (status === 403) throw new AiClientError('FORBIDDEN', status)
  if (status === 429) throw new AiClientError('RATE_LIMIT', status)
  if (status === 408) throw new AiClientError('TIMEOUT', status)
  if (status >= 500) throw new AiClientError('SERVER', status)
  if (status < 200 || status >= 300) throw new AiClientError('HTTP', status)
  let payload: unknown = typeof response.responseText === 'string' && response.responseText
    ? response.responseText : response.response
  if (typeof payload === 'string') {
    if (payload.length > 1000000) throw new AiClientError('MODELS_RESPONSE')
    try { payload = JSON.parse(payload) as unknown } catch { throw new AiClientError('MODELS_RESPONSE') }
  }
  if (!record(payload) || !Array.isArray(payload.data) || payload.data.length > 5000) throw new AiClientError('MODELS_RESPONSE')
  const models = new Map<string, AiModel>()
  let excludedCount = 0
  for (const item of payload.data as Array<unknown>) {
    if (!record(item) || typeof item.id !== 'string' || !item.id || item.id.length > 256
      || /\s/.test(item.id) || Array.from(item.id).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
      || item.id.includes(secret)) continue
    if (nonChatId.test(item.id) || (typeof item.type === 'string' && /^(embedding|audio|image|video|rerank|moderation)$/.test(item.type))) {
      excludedCount += 1
      continue
    }
    const chat = (record(item.capabilities) && item.capabilities.chat === true)
      || /(?:chat|instruct|gpt|deepseek|claude|gemini)/i.test(item.id)
    models.set(item.id, { id: item.id, kind: chat ? 'chat' : 'unknown' })
  }
  return { models: Array.from(models.values()).sort((a, b) => a.id.localeCompare(b.id)), excludedCount }
}

// One explicit GET to one selected endpoint. No probes, pagination or generation requests.
export const fetchAiModels = (credentials: Pick<AiCredentials, 'baseUrl' | 'apiKey'>, timeoutMs = 15000): AiModelsTask => {
  const startedAt = Date.now()
  let phase: ModelQueryPhase = 'validation'
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: (() => void) | undefined
  let shouldAbort = false
  let resolve!: (value: AiModelList) => void
  let reject!: (error: AiClientError) => void
  const promise = new Promise<AiModelList>((rs, rj) => { resolve = rs; reject = rj })
  const stop = () => { try { abort?.() } catch { /* Local cancellation still wins. */ } }
  const fail = (error: unknown, stage: ModelQueryPhase, cancelTransport = false, response?: unknown) => {
    if (settled) return
    settled = true
    if (timer !== undefined) clearTimeout(timer)
    shouldAbort = cancelTransport
    reject(modelQueryError(error, stage, Date.now() - startedAt, response))
    if (cancelTransport) stop()
  }
  try {
    const config = validateAiCredentials({ ...credentials, model: 'model-discovery' })
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new AiClientError('INVALID_REQUEST')
    const endpoint = `${config.baseUrl}/models`
    const complete = (response: AiGmResponse, stage: ModelQueryPhase = 'onload') => {
      if (settled) return
      try {
        const models = readModels(response, endpoint, config.apiKey)
        settled = true
        if (timer !== undefined) clearTimeout(timer)
        resolve(models)
      } catch (error) {
        fail(error instanceof AiClientError ? error : new AiClientError('MODELS_RESPONSE'), stage, false, response)
      }
    }
    phase = 'invoke'
    timer = setTimeout(() => fail(new AiClientError('TIMEOUT'), 'watchdog', true), timeoutMs)
    const handle = getAiGmRequest()({
      method: 'GET',
      url: endpoint,
      headers: { Accept: 'application/json', Authorization: `Bearer ${config.apiKey}` },
      anonymous: true,
      redirect: 'error',
      responseType: 'text',
      timeout: timeoutMs,
      onload: complete,
      onerror: (error) => fail(error, 'onerror', true),
      ontimeout: (error) => fail(error, 'ontimeout', true),
      onabort: (error) => fail(error, 'onabort'),
    })
    if (handle && (typeof handle === 'object' || typeof handle === 'function')) {
      const request = handle as { abort?: () => void, then?: unknown }
      if (typeof request.abort === 'function') abort = () => request.abort?.()
      if (shouldAbort) stop()
      if (typeof request.then === 'function') {
        Promise.resolve(handle).then((response) => complete(response as AiGmResponse, 'promise-resolution'), (error: unknown) => fail(error, 'promise-rejection', true))
      }
    }
  } catch (error) {
    fail(error, phase, true)
  }
  return { promise, cancel: () => fail(new AiClientError('CANCELLED'), 'cancel', true) }
}
