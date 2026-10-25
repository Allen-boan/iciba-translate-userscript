import { AiClientError } from './errors'
import { AiConfig, AiCredentials } from './types'

export const DEFAULT_AI_CONFIG: Readonly<AiConfig> = Object.freeze({
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-flash',
})

const hasControlCharacters = (value: string) => Array.from(value).some((character) => {
  const code = character.charCodeAt(0)
  return code < 32 || code === 127
})

export const normalizeAiConfig = (config: AiConfig): AiConfig => {
  const rawBaseUrl = config?.baseUrl
  if (typeof rawBaseUrl !== 'string' || hasControlCharacters(rawBaseUrl)) {
    throw new AiClientError('INVALID_BASE_URL')
  }

  const baseUrl = rawBaseUrl.trim()
  if (!/^https:\/\//i.test(baseUrl) || /[\s\\?#]/.test(baseUrl) || baseUrl.length > 2048) {
    throw new AiClientError('INVALID_BASE_URL')
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch {
    throw new AiClientError('INVALID_BASE_URL')
  }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password
    || parsed.search || parsed.hash || /\/chat\/completions\/*$/i.test(parsed.pathname)) {
    throw new AiClientError('INVALID_BASE_URL')
  }

  const rawModel = config?.model
  if (typeof rawModel !== 'string' || hasControlCharacters(rawModel)
    || !rawModel.trim() || rawModel.trim().length > 256) {
    throw new AiClientError('INVALID_MODEL')
  }

  return {
    baseUrl: parsed.href.replace(/\/+$/, ''),
    model: rawModel.trim(),
  }
}

export const validateAiCredentials = (credentials: AiCredentials): AiCredentials => {
  const config = normalizeAiConfig(credentials)
  if (typeof credentials?.apiKey !== 'string') {
    throw new AiClientError('INVALID_API_KEY')
  }
  const apiKey = credentials.apiKey.trim()
  if (!apiKey) {
    throw new AiClientError('MISSING_API_KEY')
  }
  if (hasControlCharacters(credentials.apiKey) || /\s/.test(apiKey) || apiKey.length > 4096) {
    throw new AiClientError('INVALID_API_KEY')
  }
  return { ...config, apiKey }
}
