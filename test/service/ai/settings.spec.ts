import { AiClientError } from '~/service/ai/errors'
import { AiCompletion, AiCredentials } from '~/service/ai/types'
import { AiModelList, AiModelsTask } from '~/service/ai/models'
import { modelQueryError } from '~/service/ai/modelQueryErrors'
import {
  AiSettingsSnapshot,
  createAiSettingsController,
} from '~/view/SettingPage/subpage/aiSetting/controller'

const temporaryKey = () => Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join('-')

const deferred = <T>() => {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((rs, rj) => { resolve = rs; reject = rj })
  return { promise, resolve, reject }
}

const createFixture = () => {
  const key = temporaryKey()
  const saved: AiSettingsSnapshot = {
    config: { baseUrl: 'https://api.example.test/v1', model: 'reading-model' },
    hasApiKey: true,
  }
  const load = jest.fn(async () => saved)
  const save = jest.fn(async (draft: AiCredentials): Promise<AiSettingsSnapshot> => ({
    config: { baseUrl: draft.baseUrl, model: draft.model },
    hasApiKey: true,
  }))
  const credentials = jest.fn(async (draft: AiCredentials) => ({ ...draft, apiKey: draft.apiKey || key }))
  const task = { promise: Promise.resolve({ text: 'OK', finishReason: 'stop' }), cancel: jest.fn() }
  const connect = jest.fn((_credentials: AiCredentials) => task)
  const clearKeyInput = jest.fn()
  const fetchModels = jest.fn((): AiModelsTask => ({ promise: Promise.resolve({ models: [{ id: 'listed-chat', kind: 'chat' }], excludedCount: 0 }), cancel: jest.fn() }))
  const controller = createAiSettingsController({ load, save, credentials, connect, fetchModels, clearKeyInput })
  return { controller, key, saved, load, save, credentials, connect, fetchModels, clearKeyInput }
}

test('settings are lazy and opening does not send or save an AI request', async () => {
  const fixture = createFixture()
  expect(fixture.load).not.toHaveBeenCalled()
  await fixture.controller.setVisible(true)
  expect(fixture.load).toHaveBeenCalledTimes(1)
  expect(fixture.connect).not.toHaveBeenCalled()
  expect(fixture.save).not.toHaveBeenCalled()
  expect(fixture.controller.state.hasApiKey).toBe(true)
  expect(JSON.stringify(fixture.controller.state)).not.toContain(fixture.key)
})

test('corrupt saved configuration is surfaced with a fixed, non-sensitive warning', async () => {
  const fixture = createFixture()
  fixture.load.mockResolvedValue({ ...fixture.saved, warning: true, hasApiKey: false })
  await fixture.controller.setVisible(true)
  expect(fixture.controller.state.messageType).toBe('error')
  expect(fixture.controller.state.message).toContain('配置或密钥存在异常')
  expect(fixture.controller.state.message).not.toContain(fixture.key)
  expect(fixture.connect).not.toHaveBeenCalled()
})

test('draft edits do not persist until save; saved key is cleared without a DOM refill', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  fixture.clearKeyInput.mockClear()
  const key = temporaryKey()
  fixture.controller.edit('model', 'new-model')
  fixture.controller.edit('apiKey', key)
  expect(fixture.save).not.toHaveBeenCalled()
  expect(JSON.stringify(fixture.controller.state)).not.toContain(key)

  await fixture.controller.save()
  expect(fixture.save).toHaveBeenCalledWith({ ...fixture.saved.config, model: 'new-model', apiKey: key })
  expect(fixture.clearKeyInput).toHaveBeenCalledTimes(1)
  expect(fixture.controller.state.hasDraftKey).toBe(false)
  expect(fixture.controller.state.messageType).toBe('success')
  await fixture.controller.testConnection()
  expect(fixture.credentials).toHaveBeenLastCalledWith({ ...fixture.saved.config, model: 'new-model', apiKey: '' })
})

test('test uses the draft credentials without saving or displaying the returned text', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  const key = temporaryKey()
  fixture.controller.edit('apiKey', key)
  fixture.connect.mockReturnValue({ promise: Promise.resolve({ text: key, finishReason: 'stop' }), cancel: jest.fn() })
  await fixture.controller.testConnection()
  expect(fixture.connect).toHaveBeenCalledWith({ ...fixture.saved.config, apiKey: key })
  expect(fixture.save).not.toHaveBeenCalled()
  expect(fixture.controller.state.messageType).toBe('success')
  expect(fixture.controller.state.message).not.toContain(key)
})

test('cancelling while the saved key is loading prevents a later API request', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  const pending = deferred<AiCredentials>()
  fixture.credentials.mockReturnValue(pending.promise)
  const operation = fixture.controller.testConnection()
  fixture.controller.cancelTest(true)
  pending.resolve({ ...fixture.saved.config, apiKey: fixture.key })
  await operation
  expect(fixture.connect).not.toHaveBeenCalled()
  expect(fixture.controller.state.testing).toBe(false)
  expect(fixture.controller.state.message).toBe('已取消连接测试。')
})

test('field edits cancel an in-flight request and ignore its late result', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  const pending = deferred<AiCompletion>()
  const cancel = jest.fn()
  fixture.connect.mockReturnValue({ promise: pending.promise, cancel })
  const operation = fixture.controller.testConnection()
  await Promise.resolve()
  expect(fixture.connect).toHaveBeenCalledTimes(1)
  fixture.controller.edit('baseUrl', 'https://another.example.test/api')
  expect(cancel).toHaveBeenCalledTimes(1)
  pending.resolve({ text: 'late answer', finishReason: 'stop' })
  await operation
  expect(fixture.controller.state.message).toBe('')
  expect(fixture.controller.state.testing).toBe(false)
})

test('repeated test clicks produce only one request', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  const pending = deferred<AiCompletion>()
  fixture.connect.mockReturnValue({ promise: pending.promise, cancel: jest.fn() })
  const operation = fixture.controller.testConnection()
  await fixture.controller.testConnection()
  expect(fixture.connect).toHaveBeenCalledTimes(1)
  pending.resolve({ text: 'OK', finishReason: 'stop' })
  await operation
})

test('closing the settings cancels requests and clears the key input', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  fixture.controller.edit('apiKey', fixture.key)
  const pending = deferred<AiCompletion>()
  const cancel = jest.fn()
  fixture.connect.mockReturnValue({ promise: pending.promise, cancel })
  const operation = fixture.controller.testConnection()
  await Promise.resolve()
  await fixture.controller.setVisible(false)
  expect(cancel).toHaveBeenCalledTimes(1)
  expect(fixture.controller.state.hasDraftKey).toBe(false)
  pending.reject(new AiClientError('CANCELLED'))
  await operation
  expect(fixture.controller.state.message).toBe('')
})

test('unknown errors cannot echo credentials into the settings UI', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  fixture.credentials.mockRejectedValue(new Error(fixture.key))
  await fixture.controller.testConnection()
  expect(fixture.controller.state.messageType).toBe('error')
  expect(fixture.controller.state.message).not.toContain(fixture.key)
})

test('save failure retains the draft key for an explicit retry', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  fixture.clearKeyInput.mockClear()
  fixture.controller.edit('apiKey', fixture.key)
  fixture.save.mockRejectedValueOnce(new AiClientError('STORAGE'))
  await fixture.controller.save()
  expect(fixture.controller.state.messageType).toBe('error')
  expect(fixture.controller.state.hasDraftKey).toBe(true)
  expect(fixture.clearKeyInput).not.toHaveBeenCalled()
  await fixture.controller.save()
  expect(fixture.save).toHaveBeenLastCalledWith({ ...fixture.saved.config, apiKey: fixture.key })
  expect(fixture.controller.state.hasDraftKey).toBe(false)
})

test('late configuration reads cannot overwrite a newer draft', async () => {
  const fixture = createFixture()
  const pending = deferred<AiSettingsSnapshot>()
  fixture.load.mockReturnValue(pending.promise)
  const opening = fixture.controller.setVisible(true)
  fixture.controller.edit('model', 'edited-before-load-finished')
  pending.resolve(fixture.saved)
  await opening
  expect(fixture.controller.state.model).toBe('edited-before-load-finished')
  expect(fixture.controller.state.loading).toBe(false)
})

test('save snapshots cannot be changed while the storage write is pending', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  const pending = deferred<AiSettingsSnapshot>()
  fixture.save.mockReturnValue(pending.promise)
  fixture.controller.edit('apiKey', fixture.key)
  const operation = fixture.controller.save()
  fixture.controller.edit('apiKey', temporaryKey())
  fixture.controller.edit('model', 'ignored-during-save')
  expect(fixture.controller.state.model).toBe(fixture.saved.config.model)
  expect(fixture.save).toHaveBeenCalledWith({ ...fixture.saved.config, apiKey: fixture.key })
  pending.resolve(fixture.saved)
  await operation
  expect(fixture.controller.state.saving).toBe(false)
})

test('closing and reopening during save reloads the saved state without stale feedback', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  const pending = deferred<AiSettingsSnapshot>()
  fixture.save.mockReturnValue(pending.promise)
  fixture.controller.edit('apiKey', fixture.key)
  const saving = fixture.controller.save()
  await fixture.controller.setVisible(false)
  await fixture.controller.setVisible(true)
  expect(fixture.controller.state.saving).toBe(true)
  const saved = { config: { ...fixture.saved.config, model: 'updated-model' }, hasApiKey: true }
  fixture.load.mockResolvedValue(saved)
  pending.resolve(saved)
  await saving
  expect(fixture.load).toHaveBeenCalledTimes(2)
  expect(fixture.controller.state.model).toBe('updated-model')
  expect(fixture.controller.state.hasDraftKey).toBe(false)
  expect(fixture.controller.state.message).toBe('')
})

test('disposed settings cannot issue further requests or persist data', async () => {
  const fixture = createFixture()
  await fixture.controller.setVisible(true)
  fixture.controller.dispose()
  await fixture.controller.testConnection()
  await fixture.controller.save()
  await fixture.controller.setVisible(true)
  expect(fixture.connect).not.toHaveBeenCalled()
  expect(fixture.save).not.toHaveBeenCalled()
  expect(fixture.controller.state.visible).toBe(false)
})

test('a new DeepSeek user enters a key, fetches and chooses a model without entering an address', async () => {
  const f = createFixture()
  f.load.mockResolvedValue({ config: { baseUrl: 'https://api.deepseek.com', model: '' }, hasApiKey: false })
  await f.controller.setVisible(true)
  expect(f.controller.state).toMatchObject({ provider: 'deepseek', model: '', advancedOpen: false })
  f.controller.edit('apiKey', f.key)
  await f.controller.listModels()
  expect(f.fetchModels).toHaveBeenCalledTimes(1)
  f.controller.edit('model', 'listed-chat')
  await f.controller.save()
  expect(f.save).toHaveBeenCalledWith({ baseUrl: 'https://api.deepseek.com', model: 'listed-chat', apiKey: f.key })
  expect(f.controller.state.hasDraftKey).toBe(false)
})

test('provider selection supplies the official address without inventing a model', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  f.controller.selectProvider('openai')
  expect(f.controller.state).toMatchObject({ provider: 'openai', baseUrl: 'https://api.openai.com/v1', model: '' })
  f.controller.selectProvider('deepseek')
  expect(f.controller.state).toMatchObject({ baseUrl: 'https://api.deepseek.com', model: '' })
  expect(f.connect).not.toHaveBeenCalled()
})

test('switching providers clears draft and saved-key reuse before saving or testing', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  f.controller.edit('apiKey', f.key)
  f.controller.selectProvider('openai')
  expect(f.controller.state).toMatchObject({ hasApiKey: false, hasDraftKey: false })
  await f.controller.testConnection()
  await f.controller.save()
  expect(f.credentials).not.toHaveBeenCalled()
  expect(f.connect).not.toHaveBeenCalled()
  expect(f.save).not.toHaveBeenCalled()
  expect(f.controller.state.message).toContain('密钥')
  f.controller.edit('apiKey', temporaryKey())
  f.controller.edit('model', 'chosen-model')
  await f.controller.testConnection()
  expect(f.connect).toHaveBeenCalledTimes(1)
  expect(f.connect.mock.calls[0][0].apiKey).not.toBe(f.key)
})

test('switching away and back does not silently reuse a saved key', async () => {
  const f = createFixture()
  f.load.mockResolvedValue({ config: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' }, hasApiKey: true })
  await f.controller.setVisible(true)
  f.controller.selectProvider('openai')
  f.controller.selectProvider('deepseek')
  await f.controller.testConnection()
  expect(f.credentials).not.toHaveBeenCalled()
  expect(f.connect).not.toHaveBeenCalled()
})

test('service change cancels a pending key lookup before transport is called', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  const pending = deferred<AiCredentials>()
  f.credentials.mockReturnValue(pending.promise)
  const operation = f.controller.testConnection()
  f.controller.selectProvider('deepseek')
  pending.resolve({ ...f.saved.config, apiKey: f.key })
  await operation
  expect(f.connect).not.toHaveBeenCalled()
})

test('service change cancels transport and late responses do not overwrite the new provider', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  const pending = deferred<AiCompletion>()
  const cancel = jest.fn()
  f.connect.mockReturnValue({ promise: pending.promise, cancel })
  const operation = f.controller.testConnection()
  await Promise.resolve()
  f.controller.selectProvider('deepseek')
  expect(cancel).toHaveBeenCalledTimes(1)
  pending.resolve({ text: 'private output', finishReason: 'stop' })
  await operation
  expect(f.controller.state.provider).toBe('deepseek')
  expect(f.controller.state.messageType).toBe('info')
})

test('a custom interface never falls back to a DeepSeek model; manual IDs are required without a list', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  f.controller.selectProvider('custom')
  f.controller.edit('baseUrl', 'https://new.example.test/v1')
  f.controller.edit('model', '')
  f.controller.edit('apiKey', f.key)
  await f.controller.save()
  expect(f.save).not.toHaveBeenCalled()
  expect(f.controller.state.message).toContain('模型')
  f.controller.edit('model', 'my-chat-model')
  await f.controller.save()
  expect(f.save).toHaveBeenCalledWith({ baseUrl: 'https://new.example.test/v1', model: 'my-chat-model', apiKey: f.key })
})

test('advanced settings fold without requests and reopen folded after hiding', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  expect(f.controller.state.advancedOpen).toBe(false)
  f.controller.toggleAdvanced()
  expect(f.controller.state.advancedOpen).toBe(true)
  await f.controller.setVisible(false)
  await f.controller.setVisible(true)
  expect(f.controller.state.advancedOpen).toBe(false)
  expect(f.connect).not.toHaveBeenCalled()
})

test('manual endpoint changes invalidate saved and drafted secrets', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  f.controller.edit('apiKey', f.key)
  f.controller.edit('baseUrl', 'https://another.example.test/v1')
  expect(f.controller.state.hasDraftKey).toBe(false)
  await f.controller.testConnection()
  expect(f.credentials).not.toHaveBeenCalled()
  expect(f.connect).not.toHaveBeenCalled()
})

test('opening settings and editing a key never discover models without explicit action', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  f.controller.selectProvider('openai')
  f.controller.edit('apiKey', f.key)
  expect(f.fetchModels).not.toHaveBeenCalled()
  expect(f.connect).not.toHaveBeenCalled()
  expect(f.controller.state.models).toEqual([])
  expect(f.controller.state.model).toBe('')
})

test('an explicit lookup uses only the chosen endpoint and saved key resolver, without generating or saving', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  await f.controller.listModels()
  expect(f.credentials).toHaveBeenCalledWith({ ...f.saved.config, model: 'model-discovery', apiKey: '' })
  expect(f.fetchModels).toHaveBeenCalledWith({ ...f.saved.config, model: 'model-discovery', apiKey: f.key })
  expect(f.controller.state.models).toEqual([{ id: 'listed-chat', kind: 'chat' }])
  expect(f.controller.state.model).toBe(f.saved.config.model)
  expect(f.controller.state.modelsMessage).toContain('尚未验证')
  expect(f.connect).not.toHaveBeenCalled()
  expect(f.save).not.toHaveBeenCalled()
  expect(JSON.stringify(f.controller.state)).not.toContain(f.key)
})

test('duplicate lookup clicks are coalesced and model selection does not issue generation calls', async () => {
  const f = createFixture()
  const pending = deferred<AiModelList>()
  f.fetchModels.mockReturnValue({ promise: pending.promise, cancel: jest.fn() })
  await f.controller.setVisible(true)
  const first = f.controller.listModels()
  await Promise.resolve()
  await f.controller.listModels()
  expect(f.fetchModels).toHaveBeenCalledTimes(1)
  pending.resolve({ models: [{ id: 'next-chat', kind: 'unknown' }], excludedCount: 0 })
  await first
  f.controller.edit('model', 'next-chat')
  await f.controller.save()
  expect(f.save).toHaveBeenCalledWith({ ...f.saved.config, model: 'next-chat', apiKey: '' })
  expect(f.connect).not.toHaveBeenCalled()
})

test.each(['provider', 'address', 'key', 'close', 'dispose'])('changing %s cancels lookup and ignores a late list', async (change) => {
  const f = createFixture()
  const pending = deferred<AiModelList>()
  const cancel = jest.fn()
  f.fetchModels.mockReturnValue({ promise: pending.promise, cancel })
  await f.controller.setVisible(true)
  const operation = f.controller.listModels()
  await Promise.resolve()
  if (change === 'provider') f.controller.selectProvider('openai')
  if (change === 'address') f.controller.edit('baseUrl', 'https://new.example.test/v1')
  if (change === 'key') f.controller.edit('apiKey', temporaryKey())
  if (change === 'close') await f.controller.setVisible(false)
  if (change === 'dispose') f.controller.dispose()
  expect(cancel).toHaveBeenCalledTimes(1)
  pending.resolve({ models: [{ id: 'stale-chat', kind: 'chat' }], excludedCount: 0 })
  await operation
  expect(f.controller.state.models).toEqual([])
  expect(f.controller.state.modelsLoading).toBe(false)
  expect(f.save).not.toHaveBeenCalled()
})

test('switching provider during async credential lookup cannot send the old key to either provider', async () => {
  const f = createFixture()
  const pending = deferred<AiCredentials>()
  f.credentials.mockReturnValue(pending.promise)
  await f.controller.setVisible(true)
  const operation = f.controller.listModels()
  f.controller.selectProvider('openai')
  pending.resolve({ ...f.saved.config, apiKey: f.key })
  await operation
  await f.controller.listModels()
  expect(f.fetchModels).not.toHaveBeenCalled()
  expect(f.controller.state.modelsMessage).toContain('密钥')
})

test('lookup failures preserve the saved snapshot, expose manual fallback and do not echo server secrets', async () => {
  const f = createFixture()
  const before = JSON.stringify(f.saved)
  f.fetchModels.mockReturnValue({ promise: Promise.reject(new Error(f.key)), cancel: jest.fn() })
  await f.controller.setVisible(true)
  await f.controller.listModels()
  expect(f.controller.state.model).toBe(f.saved.config.model)
  expect(f.controller.state.advancedOpen).toBe(true)
  expect(f.controller.state.modelsStatus).toBe('error')
  expect(f.controller.state.modelsMessage).toContain('手动输入')
  expect(f.controller.state.modelsMessage).not.toContain(f.key)
  expect(f.save).not.toHaveBeenCalled()
  expect(JSON.stringify(f.saved)).toBe(before)
})

test('an empty model list permits manual entry without selecting a fabricated default', async () => {
  const f = createFixture()
  await f.controller.setVisible(true)
  f.controller.selectProvider('custom')
  f.controller.edit('baseUrl', 'https://any-compatible.example.test/v1')
  f.controller.edit('apiKey', f.key)
  f.fetchModels.mockReturnValue({ promise: Promise.resolve({ models: [], excludedCount: 0 }), cancel: jest.fn() })
  await f.controller.listModels()
  expect(f.controller.state.model).toBe('')
  expect(f.controller.state.advancedOpen).toBe(true)
  f.controller.edit('model', 'provider-offered-id')
  await f.controller.save()
  expect(f.save).toHaveBeenCalledWith({ baseUrl: 'https://any-compatible.example.test/v1', model: 'provider-offered-id', apiKey: f.key })
})

test('the models error presentation shows only safe diagnostics and preserves the saved config', async () => {
  const f = createFixture()
  const before = JSON.stringify(f.saved)
  f.fetchModels.mockImplementation(() => ({
    promise: Promise.reject(modelQueryError({ status: 403, name: 'SecurityError',
      message: f.key, responseText: f.key, headers: { Authorization: f.key },
    }, 'promise-rejection', 32)),
    cancel: jest.fn(),
  }))
  await f.controller.setVisible(true)
  await f.controller.listModels()
  expect(f.controller.state.modelsMessage).toContain('分类=HTTP；HTTP=403；阶段=promise-rejection；耗时=32ms')
  expect(f.controller.state.modelsMessage).not.toContain('PERMISSION')
  expect(f.controller.state.modelsMessage).not.toContain(f.key)
  expect(f.controller.state.modelsMessage).not.toContain('Authorization')
  expect(f.controller.state.modelsMessage).not.toContain('responseText')
  expect(f.controller.state.model).toBe(f.saved.config.model)
  expect(JSON.stringify(f.saved)).toBe(before)
  expect(f.save).not.toHaveBeenCalled()
  expect(f.connect).not.toHaveBeenCalled()
})
