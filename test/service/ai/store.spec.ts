import { AiCredentials } from '~/service/ai/types'

jest.mock('vue', () => ({ reactive: (value: unknown) => value }))

type SettingsModule = typeof import('~/service/store/ai')

const runtime = globalThis as unknown as Record<string, unknown>
const makeKey = () => `test-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`

let settings: SettingsModule
let values: Map<string, unknown>

const draft = (apiKey = makeKey()): AiCredentials => ({
  baseUrl: 'https://api.example.com/v1',
  model: 'chosen-model',
  apiKey,
})

const installModernStorage = () => {
  const api = {
    getValue: jest.fn(async (name: string, fallback: unknown) => (values.has(name) ? values.get(name) : fallback)),
    setValue: jest.fn(async (name: string, value: unknown) => { values.set(name, value) }),
  }
  runtime.GM = api
  return api
}

beforeEach(() => {
  jest.resetModules()
  delete runtime.GM
  delete runtime.GM_getValue
  delete runtime.GM_setValue
  values = new Map()
  settings = require('~/service/store/ai') as SettingsModule
})

afterEach(() => {
  delete runtime.GM
  delete runtime.GM_getValue
  delete runtime.GM_setValue
})

test('reads saved credentials atomically without publishing the secret', async () => {
  installModernStorage()
  const input = draft()
  await settings.saveAiSettings(input)
  expect(await settings.getSavedAiCredentials()).toEqual(input)
  expect(JSON.stringify(settings.aiSettingsState)).not.toContain(input.apiKey)
})

test('missing or damaged saved configuration never starts an automatic request', async () => {
  installModernStorage()
  await expect(settings.getSavedAiCredentials()).rejects.toMatchObject({ code: 'MISSING_CONFIG' })
  values.set(settings.AI_CONFIG_STORAGE_KEY, 'invalid-json')
  await expect(settings.getSavedAiCredentials()).rejects.toMatchObject({ code: 'MISSING_CONFIG' })
})

test('saved credential lookup refuses a mismatched secret revision', async () => {
  installModernStorage()
  await settings.saveAiSettings(draft())
  const secret = JSON.parse(values.get(settings.AI_SECRET_STORAGE_KEY) as string)
  values.set(settings.AI_SECRET_STORAGE_KEY, JSON.stringify({ ...secret, revision: 'different' }))
  await expect(settings.getSavedAiCredentials()).rejects.toMatchObject({ code: 'MISSING_API_KEY' })
})

describe('AI settings storage', () => {
  test('loads defaults without creating records or using legacy application storage', async () => {
    const api = installModernStorage()
    values.set('iciba_store', 'existing configuration')
    values.set('history', 'existing reading history')

    await settings.loadAiSettings()

    expect(settings.aiSettingsState).toMatchObject({
      config: { baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash' },
      hasApiKey: false,
      loaded: true,
      errorMessage: '',
    })
    expect(api.setValue).not.toHaveBeenCalled()
    expect(api.getValue.mock.calls.map(call => call[0])).toEqual([
      settings.AI_CONFIG_STORAGE_KEY,
      settings.AI_SECRET_STORAGE_KEY,
    ])
    expect(values.get('iciba_store')).toBe('existing configuration')
    expect(values.get('history')).toBe('existing reading history')
  })

  test('saves separate matching records and never exposes a key through reactive state', async () => {
    installModernStorage()
    const input = draft()

    await settings.saveAiSettings(input)
    await settings.loadAiSettings()

    const config = JSON.parse(values.get(settings.AI_CONFIG_STORAGE_KEY) as string)
    const secret = JSON.parse(values.get(settings.AI_SECRET_STORAGE_KEY) as string)
    expect(config).toMatchObject({ schemaVersion: 1, baseUrl: input.baseUrl, model: input.model })
    expect(config.apiKey).toBeUndefined()
    expect(secret).toMatchObject({ schemaVersion: 1, baseUrl: input.baseUrl, apiKey: input.apiKey })
    expect(secret.revision).toBe(config.revision)
    expect(settings.aiSettingsState.hasApiKey).toBe(true)
    expect(JSON.stringify(settings.aiSettingsState)).not.toContain(input.apiKey)
    expect(Object.keys(settings.aiSettingsState.config).sort()).toEqual(['baseUrl', 'model'])
  })

  test('supports legacy GM APIs without requiring a GM namespace', async () => {
    runtime.GM_getValue = jest.fn((name: string, fallback: unknown) => (values.has(name) ? values.get(name) : fallback))
    runtime.GM_setValue = jest.fn((name: string, value: unknown) => { values.set(name, value) })
    const input = draft()

    await settings.saveAiSettings(input)
    expect(await settings.getAiCredentials({ ...input, apiKey: '' })).toEqual(input)
  })

  test('retains modern GM method receivers', async () => {
    const modern = {
      getValue(name: string, fallback: unknown) {
        expect(this).toBe(modern)
        return values.has(name) ? values.get(name) : fallback
      },
      setValue(name: string, value: unknown) {
        expect(this).toBe(modern)
        values.set(name, value)
      },
    }
    runtime.GM = modern
    await settings.saveAiSettings(draft())
    expect(settings.aiSettingsState.hasApiKey).toBe(true)
  })

  test('fails safely when GM storage is unavailable', async () => {
    await expect(settings.loadAiSettings()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    await expect(settings.saveAiSettings(draft())).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' })
    expect(settings.aiSettingsState.loaded).toBe(false)
    expect(settings.aiSettingsState.hasApiKey).toBe(false)
  })

  test('can prepare an explicitly supplied key for a connection test without saving it', async () => {
    const input = draft()
    expect(await settings.getAiCredentials(input)).toEqual(input)
    expect(values.size).toBe(0)
    expect(settings.aiSettingsState.hasApiKey).toBe(false)
  })

  test('reuses a saved key only for the same normalized endpoint', async () => {
    installModernStorage()
    const input = draft()
    await settings.saveAiSettings(input)

    expect(await settings.getAiCredentials({
      baseUrl: `${input.baseUrl}///`,
      model: 'another-model',
      apiKey: '',
    })).toEqual({ ...input, model: 'another-model' })

    await expect(settings.getAiCredentials({ ...input, baseUrl: 'https://other.example.com/v1', apiKey: '' }))
      .rejects.toMatchObject({ code: 'KEY_ENDPOINT_CHANGED' })
    await expect(settings.getAiCredentials({ ...input, baseUrl: 'https://api.example.com/another', apiKey: '' }))
      .rejects.toMatchObject({ code: 'KEY_ENDPOINT_CHANGED' })
  })

  test('requires a key for first save and allows explicit replacement at another endpoint', async () => {
    installModernStorage()
    await expect(settings.saveAiSettings(draft(''))).rejects.toMatchObject({ code: 'MISSING_API_KEY' })
    const input = draft()
    await settings.saveAiSettings(input)
    const replacement = { ...draft(), baseUrl: 'https://other.example.com/v1' }
    await settings.saveAiSettings(replacement)
    expect(await settings.getAiCredentials({ ...replacement, apiKey: '' })).toEqual(replacement)
  })

  test('falls back safely from malformed config without overwriting stored data', async () => {
    const api = installModernStorage()
    const raw = `{${makeKey()}`
    values.set(settings.AI_CONFIG_STORAGE_KEY, raw)

    await settings.loadAiSettings()

    expect(settings.aiSettingsState.config.model).toBe('deepseek-flash')
    expect(settings.aiSettingsState.loaded).toBe(true)
    expect(settings.aiSettingsState.hasApiKey).toBe(false)
    expect(settings.aiSettingsState.errorMessage).not.toContain(raw)
    expect(api.setValue).not.toHaveBeenCalled()
    expect(values.get(settings.AI_CONFIG_STORAGE_KEY)).toBe(raw)
  })

  test('does not reuse corrupt, unsupported or mismatched secret records', async () => {
    installModernStorage()
    const input = draft()
    await settings.saveAiSettings(input)
    const initial = JSON.parse(values.get(settings.AI_SECRET_STORAGE_KEY) as string)
    for (const raw of [
      'not JSON',
      JSON.stringify({ ...initial, schemaVersion: 2 }),
      JSON.stringify({ ...initial, revision: 'different' }),
      JSON.stringify({ ...initial, baseUrl: 'https://other.example.com' }),
    ]) {
      values.set(settings.AI_SECRET_STORAGE_KEY, raw)
      await settings.loadAiSettings()
      expect(settings.aiSettingsState.hasApiKey).toBe(false)
      await expect(settings.getAiCredentials({ ...input, apiKey: '' })).rejects.toBeInstanceOf(Error)
    }
  })

  test('sanitizes storage read failures and does not report a loaded key', async () => {
    const api = installModernStorage()
    const sensitive = makeKey()
    api.getValue.mockRejectedValueOnce(new Error(sensitive))
    await expect(settings.loadAiSettings()).rejects.toMatchObject({ code: 'STORAGE' })
    expect(settings.aiSettingsState.loaded).toBe(false)
    expect(settings.aiSettingsState.hasApiKey).toBe(false)
    expect(settings.aiSettingsState.errorMessage).not.toContain(sensitive)
  })

  test('rolls back both records when the second save write fails', async () => {
    const api = installModernStorage()
    const input = draft()
    await settings.saveAiSettings(input)
    const before = new Map(values)
    api.setValue.mockImplementationOnce(async (name, value) => { values.set(name, value) })
      .mockRejectedValueOnce(new Error(makeKey()))

    await expect(settings.saveAiSettings({ ...draft(), model: 'new-model' })).rejects.toMatchObject({ code: 'STORAGE' })

    expect(values).toEqual(before)
    expect(settings.aiSettingsState.config).toEqual({ baseUrl: input.baseUrl, model: input.model })
    expect(await settings.getAiCredentials({ ...input, apiKey: '' })).toEqual(input)
  })

  test('fails closed if rollback cannot restore matching records', async () => {
    const api = installModernStorage()
    const input = draft()
    await settings.saveAiSettings(input)
    api.setValue.mockImplementationOnce(async (name, value) => { values.set(name, value) })
      .mockRejectedValueOnce(new Error(makeKey()))
      .mockRejectedValueOnce(new Error(makeKey()))

    await expect(settings.saveAiSettings({ ...draft(), model: 'new-model' })).rejects.toMatchObject({ code: 'STORAGE' })

    expect(settings.aiSettingsState.loaded).toBe(false)
    expect(settings.aiSettingsState.hasApiKey).toBe(false)
    await expect(settings.getAiCredentials({ ...input, apiKey: '' })).rejects.toMatchObject({ code: 'MISSING_API_KEY' })
  })

  test('snapshots caller input before queued operations run', async () => {
    installModernStorage()
    const input = draft()
    const original = { ...input }
    const saving = settings.saveAiSettings(input)
    input.baseUrl = 'https://changed.example.com'
    input.model = 'changed-model'
    input.apiKey = makeKey()
    await saving

    expect(await settings.getAiCredentials({ ...original, apiKey: '' })).toEqual(original)
  })

  test('serializes a delayed load before a save and keeps the saved result current', async () => {
    const api = installModernStorage()
    let release: (value: unknown) => void = () => undefined
    api.getValue.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const loading = settings.loadAiSettings()
    const input = draft()
    const saving = settings.saveAiSettings(input)
    await Promise.resolve()
    release('')
    await Promise.all([loading, saving])

    expect(settings.aiSettingsState.config).toEqual({ baseUrl: input.baseUrl, model: input.model })
    expect(settings.aiSettingsState.hasApiKey).toBe(true)
  })
})
