import { computed, defineComponent, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'

import { createChatCompletion } from '~/service/ai/client'
import { createAnalysisController, createAnalysisState } from '~/service/ai/analysis'
import { createTranslationController, createTranslationState } from '~/service/ai/translation'
import { icibaRoot, shadowRoot } from '~/service/shadowRoot'
import { createSelectionObserver } from '~/service/selection'
import { createBrowserSpeechService, createBrowserSpeechState } from '~/service/speech'
import { getSavedAiCredentials } from '~/service/store/ai'
import { viewService } from '~/service/view'

import { clampPopupPosition, createAiPopupController, createAiPopupState } from './controller'
import { createSelectionTrigger, createSelectionTriggerState } from './selectionTrigger'

export default defineComponent({
  name: 'AiPopup',
  setup: () => {
    const popup = ref<HTMLDivElement>()
    const state = reactive(createAiPopupState())
    const translationState = reactive(createTranslationState())
    const analysisState = reactive(createAnalysisState())
    const speechState = reactive(createBrowserSpeechState())
    const translation = createTranslationController({
      credentials: getSavedAiCredentials,
      complete: createChatCompletion,
    }, translationState)
    const analysis = createAnalysisController({
      credentials: getSavedAiCredentials,
      complete: createChatCompletion,
    }, analysisState)
    const speech = createBrowserSpeechService({ state: speechState })
    const controller = createAiPopupController({
      translation,
      analysis,
      speech,
      openSettings: viewService.openSettings,
    }, state)
    const triggerState = reactive(createSelectionTriggerState())
    const trigger = createSelectionTrigger(controller.select, triggerState)
    const dragging = ref(false)
    let dragOrigin: { x: number, y: number, clientX: number, clientY: number } | null = null
    const endDrag = () => {
      dragOrigin = null
      dragging.value = false
    }
    const close = () => {
      endDrag()
      trigger.close()
      controller.close()
    }

    const isOwnEvent = (event: Event) => event.composedPath().includes(icibaRoot)
    const isOwnNode = (node: Node) => node === icibaRoot || icibaRoot.contains(node) || node.getRootNode() === shadowRoot

    const observer = createSelectionObserver({
      document,
      window,
      isOwnEvent,
      isOwnNode,
      preferPointer: true,
      suppressUnchangedClick: true,
      onStart: close,
      onClear: close,
      onPassiveClear: trigger.close,
      onSelection: (text, anchor) => {
        if (!viewService.state.setting) {
          speechState.errorMessage = ''
          close()
          trigger.show(text, anchor, window.innerWidth, window.innerHeight)
        }
      },
    })

    let disposed = false
    const fitPopup = async () => {
      await nextTick()
      if (disposed || !state.visible || !popup.value) {
        return
      }
      const rect = popup.value.getBoundingClientRect()
      Object.assign(state, clampPopupPosition(
        state.x, state.y, rect.width, rect.height, window.innerWidth, window.innerHeight,
      ))
    }
    const startDrag = (event: MouseEvent) => {
      if (event.button !== 0 || !state.visible || !popup.value) return
      const target = event.target as Element | null
      if (target && typeof target.closest === 'function'
        && target.closest('button, a, input, select, textarea, [role="button"]')) return
      event.preventDefault()
      dragOrigin = { x: state.x, y: state.y, clientX: event.clientX, clientY: event.clientY }
      dragging.value = true
    }
    const onDragMove = (event: MouseEvent) => {
      const origin = dragOrigin
      if (!origin || !state.visible || !popup.value) return
      if (event.buttons === 0) {
        endDrag()
        return
      }
      const rect = popup.value.getBoundingClientRect()
      Object.assign(state, clampPopupPosition(
        origin.x + event.clientX - origin.clientX,
        origin.y + event.clientY - origin.clientY,
        rect.width, rect.height, window.innerWidth, window.innerHeight,
      ))
    }
    watch([
      () => state.visible,
      () => state.text,
      () => translationState.status,
      () => analysisState.status,
      () => analysisState.expanded,
      () => speechState.errorMessage,
      () => speechState.supported,
      () => speechState.usAvailable,
      () => speechState.gbAvailable,
    ], () => {
      fitPopup()
    })
    watch(() => viewService.state.setting, (open) => {
      if (open) {
        close()
        translation.invalidateCache()
        analysis.invalidateCache()
      }
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (state.visible || triggerState.visible)) {
        close()
      }
    }
    const onResize = () => {
      endDrag()
      trigger.close()
      fitPopup()
    }
    const onVisibility = () => {
      if (document.hidden) {
        close()
      }
    }

    onMounted(() => {
      observer.start()
      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('mousemove', onDragMove, true)
      window.addEventListener('mouseup', endDrag, true)
      window.addEventListener('resize', onResize)
      window.addEventListener('blur', close)
      document.addEventListener('visibilitychange', onVisibility)
      document.addEventListener('copy', trigger.close)
    })
    onUnmounted(() => {
      disposed = true
      endDrag()
      observer.dispose()
      trigger.dispose()
      controller.dispose()
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousemove', onDragMove, true)
      window.removeEventListener('mouseup', endDrag, true)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('blur', close)
      document.removeEventListener('visibilitychange', onVisibility)
      document.removeEventListener('copy', trigger.close)
    })

    return {
      popup,
      state,
      dragging,
      trigger: triggerState,
      triggerStyle: computed(() => ({ left: `${triggerState.x}px`, top: `${triggerState.y}px` })),
      translation: translationState,
      analysis: analysisState,
      speech: speechState,
      busy: computed(() => translationState.status === 'debouncing' || translationState.status === 'loading'),
      canAnalyze: computed(controller.canAnalyze),
      analysisButtonLabel: computed(() => {
        if (analysisState.status === 'loading') {
          return '正在解析…'
        }
        if (analysisState.result) {
          return analysisState.expanded ? '收起解析' : '展开解析'
        }
        if (analysisState.status === 'error' || analysisState.status === 'cancelled') {
          return '重试解析'
        }
        return '深入解析'
      }),
      style: computed(() => ({ left: `${state.x}px`, top: `${state.y}px` })),
      m: {
        ...controller,
        startDrag,
        close,
        activateSelection: trigger.activate,
        openSettings: () => {
          endDrag()
          trigger.close()
          controller.openSettings()
        },
      },
    }
  },
})
