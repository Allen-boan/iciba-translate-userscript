import { validateAiCredentials } from './config'
import { AiClientError, getSafeAiErrorMessage } from './errors'
import { AI_DETAIL_PROMPT_VERSION, AI_MAX_INPUT_LENGTH, buildDetailedAnalysisMessages } from './prompts'
import { AiCredentials, AiRequest, AiTask } from './types'

export const AI_ANALYSIS_CACHE_TTL_MS = 5 * 60 * 1000
export const AI_ANALYSIS_CACHE_LIMIT = 50

export type AnalysisStatus = 'idle' | 'loading' | 'success' | 'error' | 'cancelled'

export const createAnalysisState = () => ({
  text: '',
  result: '',
  status: 'idle' as AnalysisStatus,
  errorMessage: '',
  cached: false,
  expanded: false,
})

export type AnalysisState = ReturnType<typeof createAnalysisState>

export interface AnalysisDependencies {
  credentials: () => Promise<AiCredentials>
  complete: (request: AiRequest) => AiTask
  now?: () => number
}

interface CachedAnalysis {
  text: string
  expiresAt: number
}

export const createAnalysisController = (
  dependencies: AnalysisDependencies,
  state: AnalysisState = createAnalysisState(),
) => {
  const now = dependencies.now ?? Date.now
  const cache = new Map<string, CachedAnalysis>()
  let cacheCredentials: AiCredentials | null = null
  let generation = 0
  let activeTask: AiTask | null = null
  let disposed = false

  const interrupt = () => {
    generation += 1
    const task = activeTask
    activeTask = null
    try {
      task?.cancel()
    } catch {
      // Generation invalidation still prevents a late result from being used.
    }
  }

  const reset = () => {
    state.result = ''
    state.status = 'idle'
    state.errorMessage = ''
    state.cached = false
    state.expanded = false
  }

  const prepare = (text: string) => {
    if (disposed) return
    interrupt()
    reset()
    state.text = typeof text === 'string' ? text.trim() : ''
  }

  const bindCache = (credentials: AiCredentials) => {
    if (!cacheCredentials || cacheCredentials.baseUrl !== credentials.baseUrl
      || cacheCredentials.model !== credentials.model || cacheCredentials.apiKey !== credentials.apiKey) {
      cache.clear()
      cacheCredentials = { ...credentials }
    }
  }

  const remember = (key: string, text: string) => {
    const timestamp = now()
    for (const [entryKey, entry] of cache) {
      if (entry.expiresAt <= timestamp) cache.delete(entryKey)
    }
    cache.delete(key)
    cache.set(key, { text, expiresAt: timestamp + AI_ANALYSIS_CACHE_TTL_MS })
    while (cache.size > AI_ANALYSIS_CACHE_LIMIT) {
      const oldest = cache.keys().next().value as string | undefined
      if (oldest === undefined) break
      cache.delete(oldest)
    }
  }

  const run = async (text: string, operation: number) => {
    const current = () => !disposed && operation === generation && state.text === text
    try {
      const credentials = validateAiCredentials(await dependencies.credentials())
      if (!current()) return
      bindCache(credentials)
      const key = JSON.stringify([credentials.baseUrl, credentials.model, AI_DETAIL_PROMPT_VERSION, 'detail', text])
      const cached = cache.get(key)
      if (cached && cached.expiresAt > now()) {
        cache.delete(key)
        cache.set(key, cached)
        state.result = cached.text
        state.status = 'success'
        state.cached = true
        return
      }
      cache.delete(key)
      const task = dependencies.complete({
        config: credentials,
        messages: buildDetailedAnalysisMessages(text),
        maxTokens: 1536,
        timeoutMs: 45000,
      })
      activeTask = task
      const completion = await task.promise
      if (!current()) return
      if (!completion || completion.finishReason !== 'stop' || typeof completion.text !== 'string'
        || !completion.text.trim() || completion.text.length > 1000000) {
        throw new AiClientError('RESPONSE')
      }
      const result = completion.text.trim()
      remember(key, result)
      state.result = result
      state.status = 'success'
      state.cached = false
    } catch (error) {
      if (!current()) return
      state.result = ''
      state.cached = false
      state.status = error instanceof AiClientError && error.code === 'CANCELLED' ? 'cancelled' : 'error'
      state.errorMessage = getSafeAiErrorMessage(error)
    } finally {
      if (current()) activeTask = null
    }
  }

  const request = () => {
    if (disposed || state.status === 'loading') return
    if (state.status === 'success' && state.result) {
      state.expanded = true
      return
    }
    if (!state.text) return
    interrupt()
    state.result = ''
    state.cached = false
    state.errorMessage = ''
    state.expanded = true
    if (Array.from(state.text).length > AI_MAX_INPUT_LENGTH) {
      state.status = 'error'
      state.errorMessage = `选中文本过长，请缩短到 ${AI_MAX_INPUT_LENGTH} 个字符以内。`
      return
    }
    state.status = 'loading'
    run(state.text, generation)
  }

  const toggle = () => {
    if (disposed || state.status === 'loading') return
    if (state.status === 'success' && state.result) {
      state.expanded = !state.expanded
      return
    }
    request()
  }

  const collapse = () => {
    if (!disposed) state.expanded = false
  }

  const cancel = () => {
    if (disposed || state.status !== 'loading') return
    interrupt()
    state.result = ''
    state.cached = false
    state.status = 'cancelled'
    state.errorMessage = '深入解析已取消。'
  }

  const close = () => {
    if (disposed) return
    interrupt()
    state.text = ''
    reset()
  }

  const invalidateCache = () => {
    if (disposed) return
    cache.clear()
    cacheCredentials = null
    close()
  }

  const dispose = () => {
    if (disposed) return
    close()
    disposed = true
    cache.clear()
    cacheCredentials = null
  }

  return { state, prepare, request, toggle, collapse, cancel, close, invalidateCache, dispose }
}
