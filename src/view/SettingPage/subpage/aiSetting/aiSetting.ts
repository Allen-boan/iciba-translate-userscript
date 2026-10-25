import { computed, defineComponent, onUnmounted, reactive, ref, watch } from 'vue'
import { testAiConnection } from '~/service/ai/client'
import { AI_SERVICE_PRESETS, AiServiceProvider } from '~/service/ai/presets'
import { fetchAiModels } from '~/service/ai/models'
import { aiSettingsState, getAiCredentials, loadAiSettings, saveAiSettings } from '~/service/store/ai'
import { createAiSettingsController, createAiSettingsState } from './controller'

export default defineComponent({
  name: 'AiSettings',
  props: {
    open: Boolean,
    active: Boolean,
  },
  setup: (props) => {
    const keyInput = ref<HTMLInputElement>()
    const state = reactive(createAiSettingsState())
    const savedSnapshot = () => ({
      config: {
        baseUrl: aiSettingsState.config.baseUrl,
        model: aiSettingsState.config.model,
      },
      hasApiKey: aiSettingsState.hasApiKey,
      warning: !!aiSettingsState.errorMessage,
    })
    const controller = createAiSettingsController({
      load: async () => {
        await loadAiSettings()
        return savedSnapshot()
      },
      save: async (draft) => {
        await saveAiSettings(draft)
        return savedSnapshot()
      },
      credentials: getAiCredentials,
      connect: testAiConnection,
      fetchModels: fetchAiModels,
      clearKeyInput: () => {
        if (keyInput.value) {
          keyInput.value.value = ''
        }
      },
    }, state)

    watch(() => props.open && props.active, (visible) => {
      controller.setVisible(visible)
    }, { immediate: true })
    onUnmounted(controller.dispose)

    const handleInput = (field: 'baseUrl' | 'model' | 'apiKey', event: Event) => {
      controller.edit(field, (event.target as HTMLInputElement).value)
    }

    const models = computed(() => state.models.filter((model) => model.id.toLowerCase().includes(state.modelSearch.trim().toLowerCase())))
    return {
      state,
      keyInput,
      providers: AI_SERVICE_PRESETS,
      models,
      unlistedModel: computed(() => state.model && !models.value.some((model) => model.id === state.model)),
      selectedModel: computed(() => state.model),
      disabled: computed(() => state.loading || state.saving),
      m: {
        handleInput,
        selectProvider: (event: Event) => controller.selectProvider((event.target as HTMLSelectElement).value as AiServiceProvider),
        selectModel: (event: Event) => controller.edit('model', (event.target as HTMLSelectElement).value),
        toggleAdvanced: controller.toggleAdvanced,
        save: controller.save,
        testConnection: controller.testConnection,
        listModels: controller.listModels,
        cancelModels: controller.cancelModels,
        searchModels: (event: Event) => { state.modelSearch = (event.target as HTMLInputElement).value },
        cancel: () => controller.cancelTest(true),
      },
    }
  },
})
