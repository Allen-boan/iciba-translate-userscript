import { parseBasicTranslation } from '~/service/ai/parseTranslation'
import { TARGET_LANGUAGES, normalizeSourceLanguage } from '~/service/ai/languages'
import { buildBasicTranslationMessages, buildDetailedAnalysisMessages } from '~/service/ai/prompts'
import { createTranslationController } from '~/service/ai/translation'
import { createAnalysisController } from '~/service/ai/analysis'
import { AiCredentials, AiRequest } from '~/service/ai/types'

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const credentials = (): AiCredentials => ({ baseUrl: 'https://example.test/v1', model: 'test-model', apiKey: Math.random().toString(36).slice(2) })

test.each([
  ['en', 'hello', '你好'], ['id', 'Selamat pagi', '早上好'], ['ja', 'おはようございます', '早上好'], ['es', 'Buenos días', '早上好'],
])('one basic request returns clean %s translation and a source marker', async (sourceLanguage, text, translation) => {
  jest.useFakeTimers()
  const complete = jest.fn((_request: AiRequest) => ({ promise: Promise.resolve({ text: JSON.stringify({ sourceLanguage, translation }), finishReason: 'stop' }), cancel: jest.fn() }))
  const config = credentials()
  const controller = createTranslationController({ credentials: async () => config, complete })
  controller.select(text)
  jest.advanceTimersByTime(250)
  await flush()
  expect(controller.state).toMatchObject({ result: translation, sourceLanguage, status: 'success', targetLanguage: 'zh-CN' })
  expect(complete).toHaveBeenCalledTimes(1)
  expect(JSON.parse(complete.mock.calls[0][0].messages[1].content)).toEqual({ text, kindHint: 'unknown' })
  controller.dispose()
  jest.useRealTimers()
})

test.each([
  ['{"translation":"早上好"}', null],
  ['{"sourceLanguage":"not a language","translation":"早上好"}', null],
  ['{"sourceLanguage":"und","translation":"早上好"}', null],
  ['早上好', null],
  ['```json\n{"sourceLanguage":"id-ID","translation":"早上好"}\n```', 'id-id'],
])('missing or invalid language never becomes English: %#', (raw, expected) => {
  expect(parseBasicTranslation(raw)).toEqual({ text: '早上好', sourceLanguage: expected })
})

test.each([
  '{"sourceLanguage":"ja",', '{"sourceLanguage":"ja"}', '{"translation":{"unsafe":"metadata"}}',
  'sourceLanguage: ja\ntranslation: 你好', '<source_language>ja</source_language><translation>你好</translation>',
  '原文语言：日语\n译文：你好', '[{"translation":"你好"}]', '```broken metadata```',
  'language=en\ntext=你好', 'Detected language English\n你好',
])('malformed envelopes fail safely without exposing metadata: %#', (raw) => {
  expect(() => parseBasicTranslation(raw)).toThrow('翻译返回格式异常')
})

test('both translation cache and stored source marker are isolated by target language', async () => {
  jest.useFakeTimers()
  const config = credentials()
  const complete = jest.fn((request: AiRequest) => ({ promise: Promise.resolve({
    text: JSON.stringify({ sourceLanguage: 'id', translation: request.config.targetLanguage === 'en' ? 'Good morning' : '早上好' }), finishReason: 'stop',
  }), cancel: jest.fn() }))
  const controller = createTranslationController({ credentials: async () => ({ ...config }), complete })
  const select = async () => { controller.select('Selamat pagi'); jest.advanceTimersByTime(250); await flush() }
  await select()
  expect(controller.state.result).toBe('早上好')
  config.targetLanguage = 'en'
  await select()
  expect(controller.state.result).toBe('Good morning')
  expect(controller.state.cached).toBe(false)
  delete config.targetLanguage
  await select()
  expect(controller.state).toMatchObject({ result: '早上好', sourceLanguage: 'id', cached: true })
  expect(complete).toHaveBeenCalledTimes(2)
  controller.dispose()
  jest.useRealTimers()
})

test('a malformed basic response is not displayed and does not trigger an automatic repair request', async () => {
  jest.useFakeTimers()
  const complete = jest.fn(() => ({ promise: Promise.resolve({ text: '{"sourceLanguage":"en",', finishReason: 'stop' }), cancel: jest.fn() }))
  const controller = createTranslationController({ credentials: async () => credentials(), complete })
  controller.select('Hello')
  jest.advanceTimersByTime(250)
  await flush()
  expect(controller.state).toMatchObject({ status: 'error', result: '', sourceLanguage: null })
  expect(controller.state.errorMessage).toContain('返回格式异常')
  expect(controller.state.errorMessage).not.toContain('sourceLanguage')
  expect(complete).toHaveBeenCalledTimes(1)
  controller.dispose()
  jest.useRealTimers()
})

test('analysis cache uses target language and refuses a target different from the visible base translation', async () => {
  const config = credentials()
  const complete = jest.fn((_request: AiRequest) => ({ promise: Promise.resolve({ text: '解析', finishReason: 'stop' }), cancel: jest.fn() }))
  const controller = createAnalysisController({ credentials: async () => ({ ...config }), complete })
  controller.prepare('Selamat pagi')
  expect(complete).not.toHaveBeenCalled()
  controller.toggle({ sourceLanguage: 'id', targetLanguage: 'zh-CN' })
  await flush()
  expect(complete).toHaveBeenCalledTimes(1)
  config.targetLanguage = 'en'
  controller.prepare('Selamat pagi')
  controller.request()
  await flush()
  expect(complete).toHaveBeenCalledTimes(2)
  expect(complete.mock.calls[1][0].messages[0].content).toContain('英语（en）')
  controller.prepare('Selamat pagi')
  controller.toggle({ sourceLanguage: 'id', targetLanguage: 'zh-CN' })
  await flush()
  expect(controller.state).toMatchObject({ status: 'error' })
  expect(controller.state.errorMessage).toContain('目标语言已改变')
  expect(complete).toHaveBeenCalledTimes(2)
})

test.each(TARGET_LANGUAGES.map((language) => [language.code, language.label]))('prompts use %s for base and analysis without English-only teaching templates', (code, label) => {
  const basic = buildBasicTranslationMessages('Selamat pagi', 'unknown', { targetLanguage: code })
  const detail = buildDetailedAnalysisMessages('Selamat pagi', 'unknown', { targetLanguage: code, sourceLanguage: 'id' })
  expect(basic[0].content).toContain(`${label}（${code}）`)
  expect(detail[0].content).toContain(`${label}（${code}）`)
  expect(detail[0].content).toContain('不要把英语时态、从句模板机械套在印尼语、日语、韩语')
  expect(detail[0].content).toContain('语域')
  expect(detail[0].content).toContain('源语言提示为 id')
  expect(JSON.parse(detail[1].content)).toEqual({ text: 'Selamat pagi', kindHint: 'unknown' })
})

test('normalizes explicit language tags without guessing from Latin characters', () => {
  expect(normalizeSourceLanguage('ind')).toBe('id')
  expect(normalizeSourceLanguage('JA_jp')).toBe('ja-jp')
  expect(normalizeSourceLanguage('English text')).toBeNull()
  expect(normalizeSourceLanguage(null)).toBeNull()
})
