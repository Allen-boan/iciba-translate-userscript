export type AiServiceProvider = 'deepseek' | 'openai' | 'custom'

interface AiServicePreset {
  value: AiServiceProvider
  label: string
  baseUrl: string
}

// Presets choose endpoints only. Available models come from the selected endpoint.
export const AI_SERVICE_PRESETS: ReadonlyArray<AiServicePreset> = [
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { value: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { value: 'custom', label: '自定义兼容接口', baseUrl: '' },
]

export const getAiServicePreset = (provider: AiServiceProvider) => AI_SERVICE_PRESETS.find((preset) => preset.value === provider) ?? AI_SERVICE_PRESETS[0]

export const inferAiServiceProvider = (baseUrl: string): AiServiceProvider => {
  try {
    const parsed = new URL(baseUrl)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
      return 'custom'
    }
    const endpoint = parsed.href.replace(/\/+$/, '')
    if (endpoint === 'https://api.deepseek.com' || endpoint === 'https://api.deepseek.com/v1') {
      return 'deepseek'
    }
    if (endpoint === 'https://api.openai.com/v1') {
      return 'openai'
    }
  } catch {
    return 'custom'
  }
  return 'custom'
}
