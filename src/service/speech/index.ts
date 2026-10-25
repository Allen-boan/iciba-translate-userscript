export type SpeechAccent = 'en-US' | 'en-GB'

export interface BrowserSpeechState {
  supported: boolean
  usAvailable: boolean
  gbAvailable: boolean
  speakingAccent: SpeechAccent | null
  errorMessage: string
}

export interface SpeechService {
  state: BrowserSpeechState
  refreshVoices: () => void
  speak: (text: string, accent: SpeechAccent) => boolean
  stop: () => void
  dispose: () => void
}

export interface BrowserSpeechOptions {
  state?: BrowserSpeechState
  synthesis?: SpeechSynthesis | null
  createUtterance?: ((text: string) => SpeechSynthesisUtterance) | null
}

export const createBrowserSpeechState = (): BrowserSpeechState => ({
  supported: false,
  usAvailable: false,
  gbAvailable: false,
  speakingAccent: null,
  errorMessage: '',
})

const voiceAccent = (voice: SpeechSynthesisVoice) => voice.lang.trim().replace(/_/g, '-').toLowerCase()

const pickVoice = (voices: Array<SpeechSynthesisVoice>, accent: SpeechAccent) => {
  const matching = voices.filter((voice) => voiceAccent(voice) === accent.toLowerCase())
  return matching.find((voice) => voice.localService) ?? matching[0] ?? null
}

const browserSynthesis = (): SpeechSynthesis | null => {
  try {
    return typeof window === 'undefined' ? null : window.speechSynthesis ?? null
  } catch {
    return null
  }
}

// Browser objects are resolved only when creating an adapter, never on import.
export const createBrowserSpeechService = (options: BrowserSpeechOptions = {}): SpeechService => {
  const state = options.state ?? createBrowserSpeechState()
  const synthesis = options.synthesis === undefined
    ? browserSynthesis()
    : options.synthesis
  let createUtterance = options.createUtterance
  if (createUtterance === undefined) {
    createUtterance = typeof SpeechSynthesisUtterance === 'undefined'
      ? null
      : (text: string) => new SpeechSynthesisUtterance(text)
  }
  let disposed = false
  let generation = 0
  let active: SpeechSynthesisUtterance | null = null
  let usVoice: SpeechSynthesisVoice | null = null
  let gbVoice: SpeechSynthesisVoice | null = null
  let listening = false
  let voiceReadFailed = false

  state.supported = !!synthesis && !!createUtterance
    && typeof synthesis.getVoices === 'function'
    && typeof synthesis.speak === 'function' && typeof synthesis.cancel === 'function'
  state.usAvailable = false
  state.gbAvailable = false
  state.speakingAccent = null
  state.errorMessage = ''

  const stop = (): boolean => {
    generation += 1
    const previous = active
    active = null
    state.speakingAccent = null
    state.errorMessage = ''
    if (previous) {
      previous.onstart = null
      previous.onend = null
      previous.onerror = null
      try {
        synthesis?.cancel()
      } catch {
        active = previous
        state.errorMessage = '浏览器未能停止朗读，请检查语音服务。'
        return false
      }
    }
    return true
  }

  const refreshVoices = () => {
    if (disposed || !state.supported || !synthesis) {
      return
    }
    try {
      const voices = synthesis.getVoices()
      usVoice = pickVoice(voices, 'en-US')
      gbVoice = pickVoice(voices, 'en-GB')
      state.usAvailable = usVoice !== null
      state.gbAvailable = gbVoice !== null
      if (voiceReadFailed) {
        state.errorMessage = ''
      }
      voiceReadFailed = false
    } catch {
      usVoice = null
      gbVoice = null
      state.usAvailable = false
      state.gbAvailable = false
      voiceReadFailed = true
      state.errorMessage = '浏览器语音列表读取失败，请稍后重试。'
    }
  }

  const speak = (text: string, accent: SpeechAccent): boolean => {
    if (disposed) {
      return false
    }
    if (!stop()) {
      return false
    }
    if (!state.supported || !synthesis || !createUtterance) {
      state.errorMessage = '当前浏览器不支持原生语音朗读。'
      return false
    }
    if (accent !== 'en-US' && accent !== 'en-GB') {
      state.errorMessage = '请选择美式发音或英式发音。'
      return false
    }
    if (typeof text !== 'string' || !text.trim() || !/[a-z]/i.test(text)) {
      state.errorMessage = '请选择包含英文字母的单词、短语或句子。'
      return false
    }
    if (Array.from(text.trim()).length > 2000) {
      state.errorMessage = '朗读文本过长，请缩短到 2000 个字符以内。'
      return false
    }

    // A voice can disappear after the availability indicator was rendered.
    refreshVoices()
    const voice = accent === 'en-US' ? usVoice : gbVoice
    if (!voice) {
      if (!voiceReadFailed) {
        state.errorMessage = accent === 'en-US'
          ? '当前浏览器没有可用的美式英语语音（en-US）。'
          : '当前浏览器没有可用的英式英语语音（en-GB）。'
      }
      return false
    }

    const operation = generation
    try {
      const utterance = createUtterance(text.trim())
      const current = () => !disposed && operation === generation && active === utterance
      utterance.voice = voice
      utterance.lang = accent
      utterance.onstart = () => {
        if (current()) {
          state.speakingAccent = accent
        }
      }
      utterance.onend = () => {
        if (current()) {
          active = null
          state.speakingAccent = null
        }
      }
      utterance.onerror = () => {
        if (current()) {
          active = null
          state.speakingAccent = null
          state.errorMessage = '浏览器朗读失败或已被中断，请重试。'
        }
      }
      active = utterance
      state.speakingAccent = accent
      state.errorMessage = ''
      synthesis.speak(utterance)
      return true
    } catch {
      stop()
      state.errorMessage = '浏览器无法开始朗读，请检查语音服务后重试。'
      return false
    }
  }

  if (state.supported && synthesis) {
    try {
      synthesis.addEventListener('voiceschanged', refreshVoices)
      listening = true
    } catch {
      // Clicking a pronunciation button still refreshes voices on older hosts.
    }
    refreshVoices()
  }

  const dispose = () => {
    if (disposed) {
      return
    }
    stop()
    disposed = true
    if (listening && synthesis) {
      try {
        synthesis.removeEventListener('voiceschanged', refreshVoices)
      } catch {
        // A detached browser host may no longer expose its EventTarget.
      }
    }
    usVoice = null
    gbVoice = null
    state.supported = false
    state.usAvailable = false
    state.gbAvailable = false
  }

  return { state, refreshVoices, speak, stop, dispose }
}
