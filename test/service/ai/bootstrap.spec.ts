import * as Vue from 'vue'
import { shadowRoot } from '~/service/shadowRoot'
import { viewService } from '~/service/view'
import { AI_CONFIG_STORAGE_KEY, AI_SECRET_STORAGE_KEY, getSavedAiCredentials } from '~/service/store/ai'

jest.mock('vue', () => {
  const actual = jest.requireActual('vue')
  return { ...actual, createApp: jest.fn(actual.createApp) }
})
jest.mock('~/service/shadowRoot', () => {
  const host = document.createElement('div')
  return { icibaRoot: host, shadowRoot: host.attachShadow({ mode: 'open' }) }
})
jest.mock('~/util/trustedHTMLHack', () => ({}))
jest.mock('~/assets/styles/tailwind.sass', () => ({}))
jest.mock('~/App.vue', () => ({
  default: require('../../__mocks__/compileSfc').compileSfc('src/App.vue'),
}))
jest.mock('~/view/AiPopup/AiPopup.vue', () => ({
  default: require('../../__mocks__/compileSfc').compileSfc('src/view/AiPopup/AiPopup.vue'),
}))
jest.mock('~/view/SettingPage/SettingPage.vue', () => ({
  default: require('../../__mocks__/compileSfc').compileSfc('src/view/SettingPage/SettingPage.vue'),
}))
jest.mock('~/components/modal/modal.vue', () => ({
  default: require('../../__mocks__/compileSfc').compileSfc('src/components/modal/modal.vue'),
}))
jest.mock('~/view/SettingPage/subpage/aiSetting/aiSetting.vue', () => ({
  default: require('../../__mocks__/compileSfc').compileSfc('src/view/SettingPage/subpage/aiSetting/aiSetting.vue'),
}))

const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); await Vue.nextTick() }

test('the production entry opens only AI settings and retains saved credentials without automatic requests or writes', async () => {
  const key = Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('-')
  const config = { schemaVersion: 1, revision: 'saved-revision', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }
  const records: Record<string, string> = {
    [AI_CONFIG_STORAGE_KEY]: JSON.stringify(config),
    [AI_SECRET_STORAGE_KEY]: JSON.stringify({ ...config, apiKey: key }),
    iciba_store: 'old provider preferences must not be read or modified',
    history: 'old history must not be read or modified',
  }
  const original = JSON.stringify(records)
  const getValue = jest.fn(async (name: string, fallback: unknown) => records[name] ?? fallback)
  const setValue = jest.fn()
  const xmlHttpRequest = jest.fn(() => { throw new Error('No real requests are allowed') })
  const menu = jest.fn()
  const previousGm = (global as any).GM
  const previousMenu = (global as any).GM_registerMenuCommand
  const warnings = jest.spyOn(console, 'warn').mockImplementation(() => {})
  Object.assign(global, { GM: { getValue, setValue, xmlHttpRequest }, GM_registerMenuCommand: menu })
  viewService.closeSettings()
  try {
    // Real startup entry: references to any deleted Provider or old store would fail here.
    require('~/index')
    await flush()
    expect(menu).toHaveBeenCalledWith('打开 AI 词典设置', expect.any(Function))
    expect(getValue).not.toHaveBeenCalled()
    expect(shadowRoot.querySelector('.ai-settings')).toBeNull()
    expect(shadowRoot.querySelector('.ai-popup')).toBeNull()

    menu.mock.calls[0][1]()
    await flush()
    const form = shadowRoot.querySelector('.ai-settings')!
    expect(form).not.toBeNull()
    expect(form.querySelector<HTMLSelectElement>('#iciba-ai-model')!.value).toBe(config.model)
    expect(form.querySelector<HTMLInputElement>('#iciba-ai-key')!.value).toBe('')
    expect(form.querySelector<HTMLInputElement>('#iciba-ai-key')!.placeholder).toContain('已保存')
    expect(shadowRoot.querySelectorAll('.i-tabs, .provider-sort')).toHaveLength(0)
    expect(getValue.mock.calls.every(([name]) => [AI_CONFIG_STORAGE_KEY, AI_SECRET_STORAGE_KEY].includes(name))).toBe(true)
    expect(xmlHttpRequest).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(shadowRoot.textContent).not.toContain(key)

    // Closing and reopening the original Modal still loads the same saved AI pair.
    shadowRoot.querySelector<HTMLElement>('.modal-component')!.click()
    await flush()
    expect(viewService.state.setting).toBe(false)
    menu.mock.calls[0][1]()
    await flush()
    expect(shadowRoot.querySelector('.ai-settings')).not.toBeNull()
    expect(await getSavedAiCredentials()).toEqual({ baseUrl: config.baseUrl, model: config.model, apiKey: key })
    expect(JSON.stringify(records)).toBe(original)
    expect(xmlHttpRequest).not.toHaveBeenCalled()
    expect(setValue).not.toHaveBeenCalled()
    expect(warnings).not.toHaveBeenCalled()
  } finally {
    const createApp = Vue.createApp as jest.MockedFunction<typeof Vue.createApp>
    for (const result of createApp.mock.results) if (result.type === 'return') result.value.unmount()
    viewService.closeSettings()
    Object.assign(global, { GM: previousGm, GM_registerMenuCommand: previousMenu })
    warnings.mockRestore()
  }
})
