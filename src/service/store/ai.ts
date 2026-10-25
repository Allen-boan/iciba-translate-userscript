import { reactive } from 'vue'

import { DEFAULT_AI_CONFIG, normalizeAiConfig, validateAiCredentials } from '~/service/ai/config'
import { AiClientError, getSafeAiErrorMessage } from '~/service/ai/errors'
import { AiConfig, AiCredentials } from '~/service/ai/types'

export const AI_CONFIG_STORAGE_KEY = 'iciba_ai_config_v1'
export const AI_SECRET_STORAGE_KEY = 'iciba_ai_secret_v1'

interface GmStorage {
  getValue: (name: string, defaultValue: unknown) => unknown
  setValue: (name: string, value: unknown) => unknown
}

interface ConfigRecord extends AiConfig {
  schemaVersion: 1
  revision: string
}

interface SecretRecord {
  schemaVersion: 1
  baseUrl: string
  apiKey: string
  revision: string
}

export const aiSettingsState = reactive({
  config: { ...DEFAULT_AI_CONFIG } as AiConfig,
  hasApiKey: false,
  loaded: false,
  errorMessage: '',
})

// Serialize local reads and writes so a late load cannot overwrite a completed save.
let operationQueue: Promise<unknown> = Promise.resolve()
let revisionCounter = 0

const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = operationQueue.then(operation, operation)
  operationQueue = result.then(() => undefined, () => undefined)
  return result
}

const getStorage = (): GmStorage => {
  if (typeof GM !== 'undefined' && GM !== null
    && typeof GM.getValue === 'function' && typeof GM.setValue === 'function') {
    const modern = GM as unknown as GmStorage
    return {
      getValue: (name, defaultValue) => modern.getValue(name, defaultValue),
      setValue: (name, value) => modern.setValue(name, value),
    }
  }
  if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
    const legacyGet = GM_getValue as unknown as GmStorage['getValue']
    const legacySet = GM_setValue as unknown as GmStorage['setValue']
    return {
      getValue: (name, defaultValue) => legacyGet(name, defaultValue),
      setValue: (name, value) => legacySet(name, value),
    }
  }
  throw new AiClientError('STORAGE_UNAVAILABLE')
}

const parseRecord = (raw: unknown): Record<string, unknown> | null => {
  if (typeof raw !== 'string' || !raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

const hasRevision = (record: Record<string, unknown>) => typeof record.revision === 'string' && /^[a-z0-9-]{1,96}$/.test(record.revision)


const decodeConfig = (raw: unknown): ConfigRecord | null => {
  const record = parseRecord(raw)
  if (!record || record.schemaVersion !== 1 || !hasRevision(record)) {
    return null
  }
  try {
    return {
      ...normalizeAiConfig({ baseUrl: record.baseUrl as string, model: record.model as string }),
      schemaVersion: 1,
      revision: record.revision as string,
    }
  } catch {
    return null
  }
}

const decodeSecret = (raw: unknown): SecretRecord | null => {
  const record = parseRecord(raw)
  if (!record || record.schemaVersion !== 1 || !hasRevision(record)) {
    return null
  }
  try {
    const credentials = validateAiCredentials({
      baseUrl: record.baseUrl as string,
      model: 'stored-secret-validation',
      apiKey: record.apiKey as string,
    })
    return {
      schemaVersion: 1,
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
      revision: record.revision as string,
    }
  } catch {
    return null
  }
}

const readRecords = async (storage: GmStorage) => ({
  config: await storage.getValue(AI_CONFIG_STORAGE_KEY, ''),
  secret: await storage.getValue(AI_SECRET_STORAGE_KEY, ''),
})

const resolveCredentials = (draft: AiCredentials, rawConfig: unknown, rawSecret: unknown): AiCredentials => {
  const config = normalizeAiConfig(draft)
  if (typeof draft.apiKey !== 'string') {
    throw new AiClientError('INVALID_API_KEY')
  }
  if (draft.apiKey) {
    return validateAiCredentials({ ...config, apiKey: draft.apiKey })
  }

  const savedConfig = decodeConfig(rawConfig)
  const savedSecret = decodeSecret(rawSecret)
  if (!savedConfig || !savedSecret || savedConfig.revision !== savedSecret.revision) {
    throw new AiClientError('MISSING_API_KEY')
  }
  if (savedConfig.baseUrl !== config.baseUrl || savedSecret.baseUrl !== config.baseUrl) {
    throw new AiClientError('KEY_ENDPOINT_CHANGED')
  }
  return { ...config, apiKey: savedSecret.apiKey }
}

const safeStorageError = (error: unknown) => (
  error instanceof AiClientError ? error : new AiClientError('STORAGE')
)

export const loadAiSettings = (): Promise<void> => enqueue(async () => {
  try {
    const records = await readRecords(getStorage())
    const config = decodeConfig(records.config)
    const secret = decodeSecret(records.secret)
    aiSettingsState.config = config
      ? { baseUrl: config.baseUrl, model: config.model }
      : { ...DEFAULT_AI_CONFIG }
    aiSettingsState.hasApiKey = !!config && !!secret && config.baseUrl === secret.baseUrl
      && config.revision === secret.revision
    aiSettingsState.loaded = true
    aiSettingsState.errorMessage = ''
    if (records.config && !config) {
      aiSettingsState.errorMessage = '已保存的 AI 配置无效，请重新填写。'
    } else if (records.secret && !aiSettingsState.hasApiKey) {
      aiSettingsState.errorMessage = '已保存的 API Key 无效或与接口地址不匹配，请重新输入。'
    }
  } catch (error) {
    const safe = safeStorageError(error)
    aiSettingsState.loaded = false
    aiSettingsState.hasApiKey = false
    aiSettingsState.errorMessage = getSafeAiErrorMessage(safe)
    throw safe
  }
})

export const saveAiSettings = (draft: AiCredentials): Promise<void> => {
  const snapshot = { ...draft }
  return enqueue(async () => {
    let storage: GmStorage
    let previous: { config: unknown, secret: unknown }
    let credentials: AiCredentials
    try {
      storage = getStorage()
      previous = await readRecords(storage)
      credentials = resolveCredentials(snapshot, previous.config, previous.secret)
    } catch (error) {
      const safe = safeStorageError(error)
      aiSettingsState.errorMessage = getSafeAiErrorMessage(safe)
      throw safe
    }

    revisionCounter += 1
    const revision = [
      Date.now().toString(36),
      revisionCounter.toString(36),
      Math.random().toString(36).slice(2),
    ].join('-')
    const config: ConfigRecord = {
      schemaVersion: 1,
      revision,
      baseUrl: credentials.baseUrl,
      model: credentials.model,
    }
    const secret: SecretRecord = {
      schemaVersion: 1,
      revision,
      baseUrl: credentials.baseUrl,
      apiKey: credentials.apiKey,
    }
    try {
      await storage.setValue(AI_SECRET_STORAGE_KEY, JSON.stringify(secret))
      await storage.setValue(AI_CONFIG_STORAGE_KEY, JSON.stringify(config))
    } catch {
      let rollbackFailed = false
      for (const [name, value] of [
        [AI_SECRET_STORAGE_KEY, previous.secret],
        [AI_CONFIG_STORAGE_KEY, previous.config],
      ] as Array<[string, unknown]>) {
        try {
          await storage.setValue(name, value)
        } catch {
          rollbackFailed = true
        }
      }
      if (rollbackFailed) {
        aiSettingsState.loaded = false
        aiSettingsState.hasApiKey = false
      }
      const error = new AiClientError('STORAGE')
      aiSettingsState.errorMessage = error.message
      throw error
    }

    aiSettingsState.config = { baseUrl: config.baseUrl, model: config.model }
    aiSettingsState.hasApiKey = true
    aiSettingsState.loaded = true
    aiSettingsState.errorMessage = ''
  })
}

export const getAiCredentials = (draft: AiCredentials): Promise<AiCredentials> => {
  const snapshot = { ...draft }
  return enqueue(async () => {
    try {
      if (typeof snapshot.apiKey === 'string' && snapshot.apiKey) {
        return validateAiCredentials(snapshot)
      }
      const records = await readRecords(getStorage())
      return resolveCredentials(snapshot, records.config, records.secret)
    } catch (error) {
      throw safeStorageError(error)
    }
  })
}

// Read one consistent saved pair without putting the key into reactive state.
export const getSavedAiCredentials = (): Promise<AiCredentials> => enqueue(async () => {
  try {
    const records = await readRecords(getStorage())
    const config = decodeConfig(records.config)
    if (!config) {
      throw new AiClientError('MISSING_CONFIG')
    }
    return resolveCredentials({ baseUrl: config.baseUrl, model: config.model, apiKey: '' }, records.config, records.secret)
  } catch (error) {
    throw safeStorageError(error)
  }
})
