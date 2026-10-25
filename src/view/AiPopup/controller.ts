import type { createTranslationController } from '~/service/ai/translation'
import type { createAnalysisController } from '~/service/ai/analysis'
import type { createBrowserSpeechService } from '~/service/speech'
import type { SelectionAnchor } from '~/service/selection'
import { sourceSpeechLanguage } from '~/service/ai/languages'

export const createAiPopupState = () => ({
  visible: false,
  text: '',
  x: 12,
  y: 12,
})

type Translation = Pick<ReturnType<typeof createTranslationController>, 'state' | 'select' | 'retry' | 'cancel' | 'close' | 'dispose' | 'invalidateCache'>
type Analysis = Pick<ReturnType<typeof createAnalysisController>, 'prepare' | 'toggle' | 'cancel' | 'close' | 'dispose' | 'invalidateCache'>
type Speech = Pick<ReturnType<typeof createBrowserSpeechService>, 'speak' | 'stop' | 'dispose'>

interface Dependencies {
  translation: Translation
  analysis: Analysis
  speech: Speech
  openSettings: () => void
}

export const createAiPopupController = (
  dependencies: Dependencies,
  state = createAiPopupState(),
) => {
  let disposed = false

  const close = () => {
    state.visible = false
    state.text = ''
    dependencies.translation.close()
    dependencies.analysis.close()
    dependencies.speech.stop()
  }

  const select = (text: string, anchor: SelectionAnchor) => {
    if (disposed) {
      return
    }
    const normalized = text.trim()
    if (!normalized) {
      close()
      return
    }
    dependencies.speech.stop()
    state.text = normalized
    state.x = Number.isFinite(anchor.x) ? anchor.x : 12
    state.y = Number.isFinite(anchor.y) ? anchor.y + 12 : 12
    state.visible = true
    dependencies.analysis.prepare(normalized)
    dependencies.translation.select(normalized)
  }

  const speak = (accent: string) => {
    if (!disposed && state.visible) {
      const language = sourceSpeechLanguage(dependencies.translation.state.sourceLanguage)
      if (!language || (language === 'en' ? !['en-US', 'en-GB'].includes(accent) : accent !== language)) return
      dependencies.speech.speak(state.text, accent)
    }
  }

  const openSettings = () => {
    if (disposed) {
      return
    }
    close()
    dependencies.translation.invalidateCache()
    dependencies.analysis.invalidateCache()
    dependencies.openSettings()
  }

  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    close()
    dependencies.translation.dispose()
    dependencies.analysis.dispose()
    dependencies.speech.dispose()
  }

  const canAnalyze = () => !disposed && state.visible
    && dependencies.translation.state.text === state.text
    && dependencies.translation.state.status === 'success'
    && !!dependencies.translation.state.result.trim()

  return {
    state,
    select,
    close,
    selectionStart: close,
    speak,
    stopSpeech: () => { dependencies.speech.stop() },
    openSettings,
    canAnalyze,
    toggleAnalysis: () => {
      if (canAnalyze()) {
        dependencies.analysis.toggle({
          sourceLanguage: dependencies.translation.state.sourceLanguage,
          targetLanguage: dependencies.translation.state.targetLanguage,
        })
      }
    },
    cancelAnalysis: () => {
      if (!disposed && state.visible) {
        dependencies.analysis.cancel()
      }
    },
    retry: () => {
      if (!disposed && state.visible) {
        dependencies.analysis.prepare(state.text)
        dependencies.translation.retry()
      }
    },
    cancel: () => {
      if (!disposed && state.visible) {
        dependencies.analysis.close()
        dependencies.translation.cancel()
      }
    },
    dispose,
  }
}

export const clampPopupPosition = (
  x: number,
  y: number,
  width: number,
  height: number,
  viewportWidth: number,
  viewportHeight: number,
) => ({
  x: Math.max(12, Math.min(x, viewportWidth - width - 12)),
  y: Math.max(12, Math.min(y, viewportHeight - height - 12)),
})
