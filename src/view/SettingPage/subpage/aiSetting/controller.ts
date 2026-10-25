import { AiConfig, AiCredentials, AiTask } from '~/service/ai/types'
import { AiClientError, getSafeAiErrorMessage } from '~/service/ai/errors'
import { AI_SERVICE_PRESETS, AiServiceProvider, getAiServicePreset, inferAiServiceProvider } from '~/service/ai/presets'
import { AiModel, AiModelsTask } from '~/service/ai/models'

export interface AiSettingsSnapshot {
  config: AiConfig
  hasApiKey: boolean
  warning?: boolean
}

export interface AiSettingsDependencies {
  load: () => Promise<AiSettingsSnapshot>
  save: (draft: AiCredentials) => Promise<AiSettingsSnapshot>
  credentials: (draft: AiCredentials) => Promise<AiCredentials>
  connect: (credentials: AiCredentials) => AiTask
  fetchModels: (credentials: AiCredentials) => AiModelsTask
  clearKeyInput: () => void
}

export const createAiSettingsState = () => ({
  provider: 'deepseek' as AiServiceProvider,
  baseUrl: 'https://api.deepseek.com',
  model: '',
  models: [] as Array<AiModel>,
  modelSearch: '',
  modelsLoading: false,
  modelsMessage: '',
  modelsStatus: 'idle' as 'idle' | 'success' | 'error',
  advancedOpen: false,
  hasApiKey: false,
  hasDraftKey: false,
  visible: false,
  loading: false,
  saving: false,
  testing: false,
  message: '',
  messageType: 'info' as 'info' | 'success' | 'error',
})

export type AiSettingsState = ReturnType<typeof createAiSettingsState>

export const createAiSettingsController = (
  dependencies: AiSettingsDependencies,
  state: AiSettingsState = createAiSettingsState(),
) => {
  let apiKey = ''
  let disposed = false
  let viewRevision = 0
  let inputRevision = 0
  let loadRevision = 0
  let testRevision = 0
  let activeTask: AiTask | null = null
  let allowSavedKey = false
  let modelsRevision = 0
  let modelsTask: AiModelsTask | null = null

  const cancelModels = () => {
    modelsRevision += 1
    const task = modelsTask
    modelsTask = null
    state.modelsLoading = false
    task?.cancel()
  }
  const clearModels = () => {
    cancelModels()
    state.models = []
    state.modelSearch = ''
    state.modelsMessage = ''
    state.modelsStatus = 'idle'
  }

  const clearKey = () => {
    apiKey = ''
    state.hasDraftKey = false
    dependencies.clearKeyInput()
  }

  const cancelTest = (showMessage = false) => {
    const wasTesting = state.testing
    testRevision += 1
    const task = activeTask
    activeTask = null
    state.testing = false
    task?.cancel()
    if (showMessage && wasTesting && state.visible) {
      state.message = '已取消连接测试。'
      state.messageType = 'info'
    }
  }

  const applySnapshot = (snapshot: AiSettingsSnapshot) => {
    state.provider = inferAiServiceProvider(snapshot.config.baseUrl)
    state.baseUrl = snapshot.config.baseUrl
    state.model = snapshot.hasApiKey ? snapshot.config.model.trim() : ''
    state.hasApiKey = snapshot.hasApiKey
    allowSavedKey = snapshot.hasApiKey
  }

  const draft = (forModels = false): AiCredentials => {
    if (!apiKey && !allowSavedKey) {
      throw new AiClientError('MISSING_API_KEY')
    }
    if (!forModels && !state.model.trim()) throw new AiClientError('INVALID_MODEL')
    return {
      baseUrl: state.baseUrl,
      model: forModels ? 'model-discovery' : state.model.trim(),
      apiKey,
    }
  }

  const load = async () => {
    if (disposed || !state.visible || state.saving) {
      return
    }
    loadRevision += 1
    const operation = loadRevision
    const view = viewRevision
    const inputs = inputRevision
    state.loading = true
    state.message = ''
    try {
      const snapshot = await dependencies.load()
      if (!disposed && state.visible && view === viewRevision
        && operation === loadRevision && inputs === inputRevision) {
        applySnapshot(snapshot)
        clearKey()
        if (snapshot.warning) {
          state.message = '已保存的 AI 配置或密钥存在异常，请检查并重新保存。'
          state.messageType = 'error'
        }
      }
    } catch (error) {
      if (!disposed && state.visible && view === viewRevision
        && operation === loadRevision && inputs === inputRevision) {
        state.message = getSafeAiErrorMessage(error)
        state.messageType = 'error'
      }
    } finally {
      if (operation === loadRevision) {
        state.loading = false
      }
    }
  }

  const setVisible = async (visible: boolean) => {
    if (disposed || state.visible === visible) {
      return
    }
    state.visible = visible
    viewRevision += 1
    loadRevision += 1
    state.loading = false
    cancelTest()
    clearModels()
    clearKey()
    state.message = ''
    state.advancedOpen = false
    if (visible) {
      await load()
    }
  }

  const edit = (field: 'baseUrl' | 'model' | 'apiKey', value: string) => {
    if (disposed || state.saving) {
      return
    }
    inputRevision += 1
    cancelTest()
    cancelModels()
    state.message = ''
    if (field === 'apiKey') {
      clearModels()
      apiKey = value
      state.hasDraftKey = !!value
    } else {
      if (field === 'baseUrl' && value !== state.baseUrl) {
        clearKey()
        allowSavedKey = false
        state.hasApiKey = false
        state.provider = 'custom'
        state.model = ''
        clearModels()
      }
      state[field] = value
    }
  }

  const selectProvider = (provider: AiServiceProvider) => {
    if (disposed || state.saving || provider === state.provider
      || !AI_SERVICE_PRESETS.some((preset) => preset.value === provider)) {
      return
    }
    inputRevision += 1
    cancelTest()
    clearModels()
    clearKey()
    allowSavedKey = false
    state.hasApiKey = false
    const preset = getAiServicePreset(provider)
    state.provider = provider
    state.baseUrl = preset.baseUrl
    state.model = ''
    state.advancedOpen = false
    state.message = '已切换服务商，请填写对应的接口密钥。'
    state.messageType = 'info'
  }

  const save = async () => {
    if (disposed || !state.visible || state.loading || state.saving) {
      return
    }
    cancelTest()
    cancelModels()
    const view = viewRevision
    const inputs = inputRevision
    state.saving = true
    state.message = ''
    try {
      const saved = await dependencies.save(draft())
      if (!disposed && state.visible && view === viewRevision && inputs === inputRevision) {
        applySnapshot(saved)
        clearKey()
        state.message = '配置已保存，可以开始划词翻译了。'
        state.messageType = 'success'
      }
    } catch (error) {
      if (!disposed && state.visible && view === viewRevision) {
        state.message = getSafeAiErrorMessage(error)
        state.messageType = 'error'
      }
    } finally {
      state.saving = false
      if (!disposed && state.visible && view !== viewRevision) {
        await load()
      }
    }
  }

  const testConnection = async () => {
    if (disposed || !state.visible || state.loading || state.saving || state.testing || state.modelsLoading) {
      return
    }
    testRevision += 1
    const operation = testRevision
    const view = viewRevision
    const inputs = inputRevision
    const current = () => !disposed && state.visible && operation === testRevision
      && view === viewRevision && inputs === inputRevision
    state.testing = true
    state.message = ''
    try {
      const credentials = await dependencies.credentials(draft())
      if (!current()) {
        return
      }
      const task = dependencies.connect(credentials)
      activeTask = task
      await task.promise
      if (current()) {
        state.message = '连接成功：当前接口和模型能够返回有效文本。'
        state.messageType = 'success'
      }
    } catch (error) {
      if (current()) {
        state.message = getSafeAiErrorMessage(error)
        state.messageType = 'error'
      }
    } finally {
      if (operation === testRevision) {
        activeTask = null
        state.testing = false
      }
    }
  }

  const listModels = async () => {
    if (disposed || !state.visible || state.loading || state.saving || state.testing || state.modelsLoading) return
    modelsRevision += 1
    const operation = modelsRevision
    const view = viewRevision
    const inputs = inputRevision
    const current = () => !disposed && state.visible && operation === modelsRevision
      && view === viewRevision && inputs === inputRevision
    state.modelsLoading = true
    state.modelsMessage = ''
    state.models = []
    state.modelSearch = ''
    try {
      const credentials = await dependencies.credentials(draft(true))
      if (!current()) return
      const task = dependencies.fetchModels(credentials)
      modelsTask = task
      const result = await task.promise
      if (current()) {
        state.models = result.models.map((model) => ({ ...model }))
        state.modelsStatus = 'success'
        state.modelsMessage = result.models.length
          ? `已读取 ${result.models.length} 个候选模型，筛除 ${result.excludedCount} 个明显非聊天项；尚未验证模型的翻译能力。`
          : '接口已返回列表，但未找到适用候选模型，请向服务商确认后手动输入模型 ID。'
        if (!result.models.length) state.advancedOpen = true
      }
    } catch (error) {
      if (current()) {
        state.modelsStatus = 'error'
        state.modelsMessage = `${getSafeAiErrorMessage(error)} 可手动输入服务商提供的模型 ID，已保存配置未改变。`
        state.advancedOpen = true
      }
    } finally {
      if (operation === modelsRevision) {
        state.modelsLoading = false
        modelsTask = null
      }
    }
  }

  const dispose = () => {
    disposed = true
    viewRevision += 1
    loadRevision += 1
    state.visible = false
    state.loading = false
    cancelTest()
    clearModels()
    clearKey()
  }

  const toggleAdvanced = () => {
    if (!disposed && !state.saving) {
      state.advancedOpen = !state.advancedOpen
    }
  }

  return { state, setVisible, edit, selectProvider, toggleAdvanced, save, testConnection, cancelTest, listModels, cancelModels, dispose }
}
