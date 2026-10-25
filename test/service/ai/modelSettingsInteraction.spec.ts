import * as Vue from 'vue'
import { compileSfc } from '../../__mocks__/compileSfc'
import { fetchAiModels, AiModelList } from '~/service/ai/models'
import { testAiConnection } from '~/service/ai/client'
import { AiClientError } from '~/service/ai/errors'
import { AiCredentials } from '~/service/ai/types'
import { aiSettingsState, getAiCredentials, saveAiSettings } from '~/service/store/ai'

jest.mock('~/service/ai/models', () => ({ ...jest.requireActual('~/service/ai/models'), fetchAiModels: jest.fn() }))
jest.mock('~/service/ai/client', () => ({ testAiConnection: jest.fn() }))
jest.mock('~/service/store/ai', () => {
  const state = require('vue').reactive({ config: { baseUrl: 'https://api.deepseek.com', model: 'saved-model' }, hasApiKey: true, errorMessage: '' })
  return {
    aiSettingsState: state,
    loadAiSettings: jest.fn(async () => {}),
    getAiCredentials: jest.fn(async (draft: AiCredentials) => ({ ...draft })),
    saveAiSettings: jest.fn(async (draft: AiCredentials) => {
      state.config = { baseUrl: draft.baseUrl, model: draft.model, ...draft.targetLanguage ? { targetLanguage: draft.targetLanguage } : {} }
      state.hasApiKey = true
    }),
  }
})

const Settings = compileSfc('src/view/SettingPage/subpage/aiSetting/aiSetting.vue')
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); await Vue.nextTick() }
const fetchModels = fetchAiModels as jest.MockedFunction<typeof fetchAiModels>
let app: Vue.App
let host: HTMLDivElement
let visible: Vue.Ref<boolean>
let warnings: jest.SpyInstance
const input = async (id: string, value: string, event = 'input') => {
  const el = host.querySelector<HTMLInputElement>(id)!
  el.value = value
  el.dispatchEvent(new Event(event, { bubbles: true }))
  await flush()
}
const button = (label: string) => Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent?.includes(label))!

beforeEach(async () => {
  jest.clearAllMocks()
  aiSettingsState.config = { baseUrl: 'https://api.deepseek.com', model: 'saved-model' }
  aiSettingsState.hasApiKey = true
  aiSettingsState.errorMessage = ''
  fetchModels.mockImplementation(() => ({ promise: Promise.resolve({ models: [
    { id: 'future-chat', kind: 'chat' }, { id: 'opaque-model', kind: 'unknown' },
  ], excludedCount: 1 }), cancel: jest.fn() }))
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {})
  host = document.createElement('div')
  document.body.appendChild(host)
  visible = Vue.ref(true)
  app = Vue.createApp({ render: () => Vue.h(Settings, { open: visible.value, active: visible.value }) })
  app.mount(host)
  await flush()
})
afterEach(() => {
  app.unmount()
  host.remove()
  const calls = [...warnings.mock.calls]
  warnings.mockRestore()
  expect(calls).toHaveLength(0)
})

test('custom endpoint is always visible; explicit discovery, search, selection and save follow the new flow', async () => {
  const key = Math.random().toString(36).slice(2)
  expect(fetchModels).not.toHaveBeenCalled()
  await input('#iciba-ai-provider', 'custom', 'change')
  expect(host.querySelector('#iciba-ai-base-url')).not.toBeNull()
  expect(host.querySelector('#iciba-ai-advanced')).toBeNull()
  expect(host.querySelector('#iciba-ai-model')!.textContent).not.toContain('deepseek-flash')
  await input('#iciba-ai-base-url', 'https://my-gateway.example.test/api/v1')
  button('验证密钥并获取模型').click()
  await flush()
  expect(fetchModels).not.toHaveBeenCalled()
  await input('#iciba-ai-key', key)
  button('验证密钥并获取模型').click()
  await flush()
  expect(fetchModels).toHaveBeenCalledTimes(1)
  expect(fetchModels.mock.calls[0][0]).toMatchObject({ baseUrl: 'https://my-gateway.example.test/api/v1', apiKey: key })
  expect(host.textContent).toContain('能力未确认')
  expect(host.textContent).toContain('尚未验证模型')
  await input('#iciba-ai-model-search', 'future')
  expect(host.querySelector('#iciba-ai-model')!.textContent).toContain('future-chat')
  expect(host.querySelector('#iciba-ai-model')!.textContent).not.toContain('opaque-model')
  await input('#iciba-ai-model', 'future-chat', 'change')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flush()
  expect(saveAiSettings).toHaveBeenCalledWith({ baseUrl: 'https://my-gateway.example.test/api/v1', model: 'future-chat', apiKey: key })
  expect(host.querySelector<HTMLInputElement>('#iciba-ai-key')!.value).toBe('')
  expect(host.textContent).not.toContain(key)
  expect(testAiConnection).not.toHaveBeenCalled()
  expect(fetchModels).toHaveBeenCalledTimes(1)
})

test('OpenAI has no fixed model list; a service change requires its own explicitly entered key', async () => {
  await input('#iciba-ai-provider', 'openai', 'change')
  expect(host.querySelector('#iciba-ai-base-url')).toBeNull()
  expect(host.querySelector<HTMLSelectElement>('#iciba-ai-model')!.value).toBe('')
  button('验证密钥并获取模型').click()
  await flush()
  expect(getAiCredentials).not.toHaveBeenCalled()
  await input('#iciba-ai-key', Math.random().toString(36).slice(2))
  button('验证密钥并获取模型').click()
  await flush()
  expect(fetchModels.mock.calls[0][0].baseUrl).toBe('https://api.openai.com/v1')
  expect(host.querySelectorAll('#iciba-ai-model option')).toHaveLength(3)
  expect(saveAiSettings).not.toHaveBeenCalled()
  expect(testAiConnection).not.toHaveBeenCalled()
})

test('an unsupported list opens manual entry and does not overwrite a saved configuration', async () => {
  fetchModels.mockImplementation(() => ({ promise: Promise.reject(new AiClientError('MODELS_UNAVAILABLE', 404)), cancel: jest.fn() }))
  const before = { ...aiSettingsState.config }
  button('验证密钥并获取模型').click()
  await flush()
  expect(host.textContent).toContain('/models')
  expect(host.querySelector('#iciba-ai-manual-model')).not.toBeNull()
  expect(aiSettingsState.config).toEqual(before)
  expect(saveAiSettings).not.toHaveBeenCalled()
  await input('#iciba-ai-manual-model', 'manual-model-id')
  expect(host.querySelector<HTMLSelectElement>('#iciba-ai-model')!.value).toBe('manual-model-id')
  expect(testAiConnection).not.toHaveBeenCalled()
})

test('hiding settings cancels the lookup, clears the password input and ignores late models', async () => {
  let resolve!: (list: AiModelList) => void
  const promise = new Promise<AiModelList>((rs) => { resolve = rs })
  const cancel = jest.fn()
  fetchModels.mockReturnValue({ promise, cancel })
  await input('#iciba-ai-key', Math.random().toString(36).slice(2))
  button('验证密钥并获取模型').click()
  await flush()
  visible.value = false
  await flush()
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(host.querySelector<HTMLInputElement>('#iciba-ai-key')!.value).toBe('')
  resolve({ models: [{ id: 'late-model', kind: 'unknown' }], excludedCount: 0 })
  await flush()
  expect(host.textContent).not.toContain('late-model')
  expect(saveAiSettings).not.toHaveBeenCalled()
})

test('target language defaults to Chinese, offers 13 choices and persists without a model lookup', async () => {
  const select = host.querySelector<HTMLSelectElement>('#iciba-ai-target-language')!
  expect(select.value).toBe('zh-CN')
  expect(select.options).toHaveLength(13)
  await input('#iciba-ai-target-language', 'id', 'change')
  host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  await flush()
  expect(saveAiSettings).toHaveBeenCalledWith(expect.objectContaining({ targetLanguage: 'id', apiKey: '' }))
  expect(host.querySelector<HTMLSelectElement>('#iciba-ai-target-language')!.value).toBe('id')
  expect(fetchModels).not.toHaveBeenCalled()
  expect(testAiConnection).not.toHaveBeenCalled()
})
