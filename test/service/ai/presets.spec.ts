import { DEFAULT_AI_CONFIG } from '~/service/ai/config'
import { AI_SERVICE_PRESETS, getAiServicePreset, inferAiServiceProvider } from '~/service/ai/presets'

test('presets choose official endpoints only; model lists are never hard-coded', () => {
  expect(DEFAULT_AI_CONFIG).toEqual({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' })
  expect(AI_SERVICE_PRESETS.map((preset) => preset.value)).toEqual(['deepseek', 'openai', 'custom'])
  expect(getAiServicePreset('deepseek').baseUrl).toBe(DEFAULT_AI_CONFIG.baseUrl)
  expect(getAiServicePreset('openai').baseUrl).toBe('https://api.openai.com/v1')
  expect(getAiServicePreset('custom').baseUrl).toBe('')
  for (const preset of AI_SERVICE_PRESETS) {
    expect(preset).not.toHaveProperty('models')
    expect(preset).not.toHaveProperty('defaultModel')
  }
})

test.each([
  ['https://API.deepseek.com:443/v1/', 'deepseek'],
  ['https://api.deepseek.com/', 'deepseek'],
  ['https://api.openai.com/v1/', 'openai'],
  ['https://api.openai.com.example.test/v1', 'custom'],
  ['https://api.openai.com/proxy/v1', 'custom'],
  ['http://api.deepseek.com', 'custom'],
  ['https://someone:secret@api.deepseek.com', 'custom'],
  ['not-a-url', 'custom'],
])('recognizes a saved endpoint without rewriting it: %s', (baseUrl, expected) => {
  expect(inferAiServiceProvider(baseUrl)).toBe(expected)
})
