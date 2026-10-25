import {
  createBrowserSpeechService,
  createBrowserSpeechState,
  SpeechAccent,
} from '~/service/speech'

const voice = (lang: string, localService = true): SpeechSynthesisVoice => ({
  lang,
  localService,
  name: lang,
  voiceURI: `${lang}-${localService}`,
  default: false,
})

const fixture = (initialVoices: Array<SpeechSynthesisVoice> = []) => {
  let voices = initialVoices
  const listeners = new Set<() => void>()
  const utterances: Array<SpeechSynthesisUtterance> = []
  const synthesis = {
    getVoices: jest.fn(() => voices),
    speak: jest.fn((_utterance: SpeechSynthesisUtterance) => {}),
    cancel: jest.fn(),
    addEventListener: jest.fn((_event: string, listener: () => void) => { listeners.add(listener) }),
    removeEventListener: jest.fn((_event: string, listener: () => void) => { listeners.delete(listener) }),
  }
  const createUtterance = jest.fn((text: string) => {
    const utterance = { text, voice: null, lang: '', onstart: null, onend: null, onerror: null } as unknown as SpeechSynthesisUtterance
    utterances.push(utterance)
    return utterance
  })
  const state = createBrowserSpeechState()
  const service = createBrowserSpeechService({
    state,
    synthesis: synthesis as unknown as SpeechSynthesis,
    createUtterance,
  })
  return {
    service,
    state,
    synthesis,
    createUtterance,
    utterances,
    listeners,
    setVoices: (next: Array<SpeechSynthesisVoice>) => { voices = next },
    voicesChanged: () => { listeners.forEach(listener => listener()) },
  }
}

const callEvent = (handler: unknown) => {
  if (typeof handler === 'function') {
    handler({})
  }
}

test('unavailable browser APIs are reported without a fallback or request', () => {
  const service = createBrowserSpeechService({ synthesis: null, createUtterance: null })
  expect(service.state).toMatchObject({ supported: false, usAvailable: false, gbAvailable: false })
  expect(service.speak('hello', 'en-US')).toBe(false)
  expect(service.state.errorMessage).toContain('不支持')
  service.stop()
  service.dispose()
})

test('voice discovery is passive and an initially empty list does not play', () => {
  const f = fixture()
  expect(f.state).toMatchObject({ supported: true, usAvailable: false, gbAvailable: false, speakingAccent: null })
  expect(f.synthesis.speak).not.toHaveBeenCalled()
  expect(f.synthesis.cancel).not.toHaveBeenCalled()
  expect(f.createUtterance).not.toHaveBeenCalled()
})

test('voiceschanged handles delayed voices without automatically playing', () => {
  const f = fixture()
  f.setVoices([voice('en-US'), voice('en-GB')])
  f.voicesChanged()
  expect(f.state).toMatchObject({ usAvailable: true, gbAvailable: true })
  expect(f.synthesis.speak).not.toHaveBeenCalled()
})

test('US and GB availability are independent and other English accents are not substitutes', () => {
  const f = fixture([voice('en'), voice('en-AU'), voice('en-US-extra'), voice('en-US')])
  expect(f.state.usAvailable).toBe(true)
  expect(f.state.gbAvailable).toBe(false)
  expect(f.service.speak('hello', 'en-GB')).toBe(false)
  expect(f.state.errorMessage).toContain('en-GB')
  expect(f.synthesis.speak).not.toHaveBeenCalled()
  expect(f.service.speak('hello', 'en-US')).toBe(true)
})

test('a GB-only installation cannot masquerade as US', () => {
  const f = fixture([voice('en-GB')])
  expect(f.state).toMatchObject({ usAvailable: false, gbAvailable: true })
  expect(f.service.speak('hello', 'en-US')).toBe(false)
  expect(f.state.errorMessage).toContain('en-US')
})

test('voice language matching normalizes casing and regional separators only', () => {
  const f = fixture([voice(' EN_us '), voice('en-gb')])
  expect(f.state).toMatchObject({ usAvailable: true, gbAvailable: true })
  f.service.speak('hello', 'en-US')
  expect(f.utterances[0].voice?.lang).toBe(' EN_us ')
  expect(f.utterances[0].lang).toBe('en-US')
})

test('chooses an actual matching voice and prefers a local voice within that accent', () => {
  const usRemote = voice('en-US', false)
  const usLocal = voice('en-US')
  const gb = voice('en-GB')
  const f = fixture([gb, usRemote, usLocal])
  expect(f.service.speak('hello', 'en-US')).toBe(true)
  expect(f.utterances[0].voice).toBe(usLocal)
  expect(f.utterances[0].lang).toBe('en-US')
  expect(f.state.speakingAccent).toBe('en-US')
})

test.each(['hello', 'a piece of cake', 'Would you mind opening the window?'])(
  'reads an English word, phrase or complete sentence: %s',
  (text) => {
    const f = fixture([voice('en-US')])
    expect(f.service.speak(` ${text} `, 'en-US')).toBe(true)
    expect(f.utterances[0].text).toBe(text)
    expect(f.synthesis.speak).toHaveBeenCalledTimes(1)
  },
)

test.each(['', '   ', '你好', '12345', 'x'.repeat(2001)])('invalid or oversized text is not queued: %#', (text) => {
  const f = fixture([voice('en-US')])
  expect(f.service.speak(text, 'en-US')).toBe(false)
  expect(f.state.errorMessage).not.toBe('')
  expect(f.synthesis.speak).not.toHaveBeenCalled()
})

test('invalid runtime accents never select a default voice', () => {
  const f = fixture([voice('en-US'), voice('en-GB')])
  expect(f.service.speak('hello', 'en-AU' as SpeechAccent)).toBe(false)
  expect(f.synthesis.speak).not.toHaveBeenCalled()
})

test('refreshes the voice list again before a click, including voice removal', () => {
  const f = fixture([voice('en-US')])
  expect(f.state.usAvailable).toBe(true)
  f.setVoices([])
  expect(f.service.speak('hello', 'en-US')).toBe(false)
  expect(f.state.usAvailable).toBe(false)
  expect(f.synthesis.speak).not.toHaveBeenCalled()
})

test('a second click replaces the old utterance instead of building a queue', () => {
  const f = fixture([voice('en-US'), voice('en-GB')])
  f.service.speak('hello', 'en-US')
  const staleEnd = f.utterances[0].onend
  const staleError = f.utterances[0].onerror
  f.service.speak('hello again', 'en-GB')
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(1)
  expect(f.synthesis.speak).toHaveBeenCalledTimes(2)
  expect(f.utterances[1].voice?.lang).toBe('en-GB')
  callEvent(staleEnd)
  callEvent(staleError)
  expect(f.state.speakingAccent).toBe('en-GB')
  expect(f.state.errorMessage).toBe('')
  f.service.speak('third click', 'en-GB')
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(2)
})

test('stop clears current speech once and ignores all stale callbacks', () => {
  const f = fixture([voice('en-US')])
  f.service.speak('hello', 'en-US')
  const staleStart = f.utterances[0].onstart
  const staleError = f.utterances[0].onerror
  f.service.stop()
  f.service.stop()
  callEvent(staleStart)
  callEvent(staleError)
  expect(f.state.speakingAccent).toBeNull()
  expect(f.state.errorMessage).toBe('')
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(1)
})

test('ending a request releases ownership, so stop does not cancel unrelated page speech', () => {
  const f = fixture([voice('en-US')])
  f.service.stop()
  expect(f.synthesis.cancel).not.toHaveBeenCalled()
  f.service.speak('hello', 'en-US')
  callEvent(f.utterances[0].onend)
  expect(f.state.speakingAccent).toBeNull()
  f.service.stop()
  expect(f.synthesis.cancel).not.toHaveBeenCalled()
})

test('browser playback errors expose only a fixed safe message', () => {
  const f = fixture([voice('en-US')])
  f.service.speak('hello', 'en-US')
  callEvent(f.utterances[0].onerror)
  expect(f.state.speakingAccent).toBeNull()
  expect(f.state.errorMessage).toContain('朗读失败')
})

test('voice-list exceptions fail closed and a later successful refresh recovers', () => {
  const f = fixture([voice('en-US')])
  f.synthesis.getVoices.mockImplementationOnce(() => { throw new Error('private browser details') })
  f.service.refreshVoices()
  expect(f.state).toMatchObject({ usAvailable: false, gbAvailable: false })
  expect(f.state.errorMessage).not.toContain('private browser details')
  f.voicesChanged()
  expect(f.state.usAvailable).toBe(true)
  expect(f.state.errorMessage).toBe('')
})

test('synchronous speak failures are caught and local playback state is cleared', () => {
  const f = fixture([voice('en-US')])
  f.synthesis.speak.mockImplementationOnce(() => { throw new Error('private browser details') })
  expect(f.service.speak('hello', 'en-US')).toBe(false)
  expect(f.state.speakingAccent).toBeNull()
  expect(f.state.errorMessage).not.toContain('private browser details')
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(1)
})

test('a failed cancellation does not queue a replacement utterance', () => {
  const f = fixture([voice('en-US'), voice('en-GB')])
  f.service.speak('hello', 'en-US')
  f.synthesis.cancel.mockImplementationOnce(() => { throw new Error('private browser details') })
  expect(f.service.speak('hello again', 'en-GB')).toBe(false)
  expect(f.synthesis.speak).toHaveBeenCalledTimes(1)
  expect(f.state.errorMessage).toContain('未能停止')
  expect(f.state.errorMessage).not.toContain('private browser details')
  expect(f.service.speak('retry after cancellation recovers', 'en-GB')).toBe(true)
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(2)
  expect(f.synthesis.speak).toHaveBeenCalledTimes(2)
})

test('dispose cancels owned speech, removes its listener and disables further calls', () => {
  const f = fixture([voice('en-US')])
  f.service.speak('hello', 'en-US')
  f.service.dispose()
  f.service.dispose()
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(1)
  expect(f.synthesis.removeEventListener).toHaveBeenCalledTimes(1)
  expect(f.listeners.size).toBe(0)
  expect(f.service.speak('hello', 'en-US')).toBe(false)
  expect(f.state.supported).toBe(false)
  f.voicesChanged()
  expect(f.state.usAvailable).toBe(false)
  expect(f.synthesis.speak).toHaveBeenCalledTimes(1)
})

test.each([
  ['id-ID', 'Selamat pagi'], ['ja-JP', 'おはようございます'], ['ko-KR', '안녕하세요'], ['es-ES', 'Buenos días'], ['ar-SA', 'مرحبا'],
])('matches a real %s voice without an AI request', (language, text) => {
  const f = fixture([voice('en-US'), voice(language)])
  expect(f.service.canSpeak(language)).toBe(true)
  expect(f.service.speak(text, language)).toBe(true)
  expect(f.utterances[0].voice!.lang).toBe(language)
  expect(f.utterances[0].lang).toBe(language)
  f.service.stop()
  expect(f.synthesis.cancel).toHaveBeenCalledTimes(1)
})

test('a delayed non-English voice becomes available after voiceschanged', () => {
  const f = fixture([])
  expect(f.service.canSpeak('id-ID')).toBe(false)
  expect(f.service.speak('Selamat pagi', 'id-ID')).toBe(false)
  expect(f.state.errorMessage).toContain('没有与原文语言匹配')
  expect(f.synthesis.speak).not.toHaveBeenCalled()
  f.setVoices([voice('id-ID')])
  f.voicesChanged()
  expect(f.state.availableLanguages).toContain('id-id')
  expect(f.service.speak('Selamat pagi', 'id-ID')).toBe(true)
})

test('missing language never uses a foreign voice or an English fallback', () => {
  const f = fixture([voice('en-US'), voice('ja-JP')])
  expect(f.service.speak('Selamat pagi', 'id-ID')).toBe(false)
  expect(f.service.canSpeak('id-ID')).toBe(false)
  expect(f.synthesis.speak).not.toHaveBeenCalled()
  expect(f.state.errorMessage).toContain('没有与原文语言匹配')
})

test('non-English regions may use the same language but English accents never substitute', () => {
  const f = fixture([voice('fr-CA'), voice('en-US')])
  expect(f.service.speak('Bonjour', 'fr-FR')).toBe(true)
  expect(f.utterances[0].lang).toBe('fr-CA')
  expect(f.service.speak('Hello', 'en-GB')).toBe(false)
  expect(f.synthesis.speak).toHaveBeenCalledTimes(1)
})
