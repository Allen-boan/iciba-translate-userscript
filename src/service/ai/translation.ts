import { validateAiCredentials } from './config'
import { AiClientError, getSafeAiErrorMessage } from './errors'
import { AI_MAX_INPUT_LENGTH, AI_PROMPT_VERSION, buildBasicTranslationMessages } from './prompts'
import { AiCredentials, AiRequest, AiTask } from './types'
import { targetLanguage } from './languages'
import { parseBasicTranslation, ParsedTranslation } from './parseTranslation'

export const AI_TRANSLATION_DEBOUNCE_MS = 250
export const AI_TRANSLATION_CACHE_TTL_MS = 5 * 60 * 1000
export const AI_TRANSLATION_CACHE_LIMIT = 50

export type TranslationStatus = 'idle' | 'debouncing' | 'loading' | 'success' | 'error' | 'cancelled'

export const createTranslationState = () => ({
  text: '',
  result: '',
  sourceLanguage: null as string | null,
  targetLanguage: 'zh-CN',
  status: 'idle' as TranslationStatus,
  errorMessage: '',
  cached: false,
})

export type TranslationState = ReturnType<typeof createTranslationState>

export interface TranslationDependencies {
  credentials: () => Promise<AiCredentials>
  complete: (request: AiRequest) => AiTask
  now?: () => number
  debounceMs?: number
}

interface CachedTranslation {
  result: ParsedTranslation
  expiresAt: number
}

export const createTranslationController = (
  dependencies: TranslationDependencies,
  state: TranslationState = createTranslationState(),
) => {
  const now = dependencies.now ?? Date.now
  const requestedDelay = dependencies.debounceMs ?? AI_TRANSLATION_DEBOUNCE_MS
  const delay = Number.isFinite(requestedDelay) && requestedDelay >= 0 ? requestedDelay : AI_TRANSLATION_DEBOUNCE_MS
  const cache = new Map<string, CachedTranslation>()
  // Credentials stay in this private closure; the public state never contains a key.
  let cacheCredentials: AiCredentials | null = null
  let generation = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let activeTask: AiTask | null = null
  let disposed = false

  const interrupt = () => {
    generation += 1
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    const task = activeTask
    activeTask = null
    try {
      task?.cancel()
    } catch {
      // Invalidation still takes effect if the transport cannot abort.
    }
  }

  const resetResult = () => {
    state.result = ''
    state.sourceLanguage = null
    state.errorMessage = ''
    state.cached = false
  }

  const bindCacheToCredentials = (credentials: AiCredentials) => {
    if (!cacheCredentials || cacheCredentials.baseUrl !== credentials.baseUrl
      || cacheCredentials.model !== credentials.model || cacheCredentials.apiKey !== credentials.apiKey) {
      cache.clear()
      cacheCredentials = { ...credentials }
    }
  }

  const remember = (key: string, result: ParsedTranslation) => {
    const timestamp = now()
    for (const [entryKey, entry] of cache) {
      if (entry.expiresAt <= timestamp) cache.delete(entryKey)
    }
    cache.delete(key)
    cache.set(key, { result, expiresAt: timestamp + AI_TRANSLATION_CACHE_TTL_MS })
    while (cache.size > AI_TRANSLATION_CACHE_LIMIT) {
      const oldest = cache.keys().next().value as string | undefined
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  const run = async (text: string, operation: number) => {
    const current = () => !disposed && operation === generation && state.text === text
    if (!current()) return
    state.status = 'loading'
    try {
      // Read and validate the current saved credentials before considering cache hits.
      const credentials = validateAiCredentials(await dependencies.credentials())
      if (!current()) return
      bindCacheToCredentials(credentials)
      state.targetLanguage = targetLanguage(credentials.targetLanguage).code
      const key = JSON.stringify([credentials.baseUrl, credentials.model, AI_PROMPT_VERSION, 'basic', state.targetLanguage, text])
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now()) {
        cache.delete(key)
        cache.set(key, cached)
        state.result = cached.result.text
        state.sourceLanguage = cached.result.sourceLanguage
        state.status = 'success'
        state.cached = true
        return
      }
      cache.delete(key)
      const task = dependencies.complete({
        config: credentials,
        messages: buildBasicTranslationMessages(text, 'unknown', { targetLanguage: state.targetLanguage }),
      })
      activeTask = task
      const completion = await task.promise
      if (!current()) return
      if (!completion || completion.finishReason !== 'stop' || typeof completion.text !== 'string'
        || !completion.text.trim()) {
        throw new AiClientError('RESPONSE')
      }
      const result = parseBasicTranslation(completion.text)
      remember(key, result)
      state.result = result.text
      state.sourceLanguage = result.sourceLanguage
      state.status = 'success'
      state.cached = false
    } catch (error) {
      if (!current()) return
      state.result = ''
      state.sourceLanguage = null
      state.cached = false
      state.status = error instanceof AiClientError && error.code === 'CANCELLED' ? 'cancelled' : 'error'
      state.errorMessage = getSafeAiErrorMessage(error)
    } finally {
      if (current()) activeTask = null
    }
  }

  const schedule = (value: string, immediate: boolean) => {
    if (disposed) return
    const text = typeof value === 'string' ? value.trim() : ''
    interrupt()
    state.text = text
    resetResult()
    if (!text) {
      state.status = 'idle'
      return
    }
    if (Array.from(text).length > AI_MAX_INPUT_LENGTH) {
      state.status = 'error'
      state.errorMessage = `选中文本过长，请缩短到 ${AI_MAX_INPUT_LENGTH} 个字符以内。`
      return
    }
    const operation = generation
    if (immediate) {
      run(text, operation)
      return
    }
    state.status = 'debouncing'
    timer = setTimeout(() => {
      timer = undefined
      run(text, operation)
    }, delay)
  }

  const select = (text: string) => {
    const normalized = typeof text === 'string' ? text.trim() : ''
    if (normalized === state.text && (state.status === 'debouncing' || state.status === 'loading')) return
    schedule(text, false)
  }

  const retry = () => {
    if (state.status !== 'loading' && state.status !== 'debouncing') schedule(state.text, true)
  }

  const cancel = () => {
    if (disposed) return
    interrupt()
    resetResult()
    state.status = state.text ? 'cancelled' : 'idle'
    state.errorMessage = state.text ? 'AI 翻译已取消。' : ''
  }

  const close = () => {
    if (disposed) return
    interrupt()
    state.text = ''
    resetResult()
    state.status = 'idle'
  }

  const invalidateCache = () => {
    if (disposed) return
    cache.clear()
    cacheCredentials = null
    cancel()
    if (state.text) state.errorMessage = 'AI 配置已更改，请重新翻译。'
  }

  const dispose = () => {
    if (disposed) return
    close()
    disposed = true
    cache.clear()
    cacheCredentials = null
  }

  return { state, select, retry, cancel, close, dispose, invalidateCache }
}
