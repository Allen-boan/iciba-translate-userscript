import { clampPopupPosition, createAiPopupController } from '~/view/AiPopup/controller'
import { createTranslationState } from '~/service/ai/translation'

const fixture = () => {
  const translation = {
    state: createTranslationState(),
    select: jest.fn(),
    retry: jest.fn(),
    cancel: jest.fn(),
    close: jest.fn(),
    dispose: jest.fn(),
    invalidateCache: jest.fn(),
  }
  const analysis = {
    prepare: jest.fn(),
    toggle: jest.fn(),
    cancel: jest.fn(),
    close: jest.fn(),
    dispose: jest.fn(),
    invalidateCache: jest.fn(),
  }
  const speech = { speak: jest.fn(() => true), stop: jest.fn(), dispose: jest.fn() }
  const openSettings = jest.fn()
  const controller = createAiPopupController({ translation, analysis, speech, openSettings })
  const succeed = () => {
    translation.state.text = controller.state.text
    translation.state.status = 'success'
    translation.state.result = '基础译文'
  }
  return { translation, analysis, speech, openSettings, controller, succeed }
}

test('selecting text opens the popup and schedules only basic translation', () => {
  const f = fixture()
  f.controller.select('  reading a book  ', { x: 100, y: 200 })
  expect(f.controller.state).toEqual({ visible: true, text: 'reading a book', x: 100, y: 212 })
  expect(f.translation.select).toHaveBeenCalledWith('reading a book')
  expect(f.speech.speak).not.toHaveBeenCalled()
})

test('unknown source never enables English and a known non-English source only allows its own language', () => {
  const f = fixture()
  f.controller.select('Selamat pagi', { x: 0, y: 0 })
  f.controller.speak('en-US')
  expect(f.speech.speak).not.toHaveBeenCalled()
  f.translation.state.sourceLanguage = 'id'
  f.controller.speak('en-US')
  expect(f.speech.speak).not.toHaveBeenCalled()
  f.controller.speak('id-ID')
  expect(f.speech.speak).toHaveBeenCalledWith('Selamat pagi', 'id-ID')
  f.controller.stopSpeech()
  expect(f.speech.stop).toHaveBeenCalled()
})

test('pronunciation uses the original selection independently of translation results', () => {
  const f = fixture()
  f.controller.select('Read this sentence.', { x: 0, y: 0 })
  f.translation.select.mockClear()
  f.translation.state.sourceLanguage = 'en'
  f.controller.speak('en-US')
  f.controller.speak('en-GB')
  expect(f.speech.speak.mock.calls).toEqual([
    ['Read this sentence.', 'en-US'],
    ['Read this sentence.', 'en-GB'],
  ])
  expect(f.translation.select).not.toHaveBeenCalled()
  expect(f.translation.retry).not.toHaveBeenCalled()
})

test('starting a new selection immediately closes and cancels the old popup', () => {
  const f = fixture()
  f.controller.select('first', { x: 0, y: 0 })
  f.speech.stop.mockClear()
  f.controller.selectionStart()
  expect(f.controller.state.visible).toBe(false)
  expect(f.translation.close).toHaveBeenCalledTimes(1)
  expect(f.speech.stop).toHaveBeenCalledTimes(1)
  f.controller.select('second', { x: 20, y: 30 })
  expect(f.controller.state.text).toBe('second')
})

test('closing cancels translation and speech and prevents hidden pronunciation', () => {
  const f = fixture()
  f.controller.select('word', { x: 0, y: 0 })
  f.controller.close()
  f.controller.speak('en-US')
  expect(f.translation.close).toHaveBeenCalledTimes(1)
  expect(f.speech.speak).not.toHaveBeenCalled()
  expect(f.controller.state.text).toBe('')
})

test('an empty selection closes the popup without a translation request', () => {
  const f = fixture()
  f.controller.select(' \n ', { x: 0, y: 0 })
  expect(f.controller.state.visible).toBe(false)
  expect(f.translation.select).not.toHaveBeenCalled()
})

test('opening settings stops work and invalidates the reading cache', () => {
  const f = fixture()
  f.controller.select('word', { x: 0, y: 0 })
  f.controller.openSettings()
  expect(f.controller.state.visible).toBe(false)
  expect(f.translation.close).toHaveBeenCalledTimes(1)
  expect(f.translation.invalidateCache).toHaveBeenCalledTimes(1)
  expect(f.openSettings).toHaveBeenCalledTimes(1)
})

test('retry and cancellation are explicit actions', () => {
  const f = fixture()
  f.controller.retry()
  expect(f.translation.retry).not.toHaveBeenCalled()
  f.controller.select('word', { x: 0, y: 0 })
  f.controller.cancel()
  f.controller.retry()
  expect(f.translation.cancel).toHaveBeenCalledTimes(1)
  expect(f.translation.retry).toHaveBeenCalledTimes(1)
})

test('dispose releases both services and ignores future selections', () => {
  const f = fixture()
  f.controller.dispose()
  f.controller.dispose()
  f.controller.select('word', { x: 0, y: 0 })
  f.controller.openSettings()
  f.controller.retry()
  expect(f.translation.dispose).toHaveBeenCalledTimes(1)
  expect(f.speech.dispose).toHaveBeenCalledTimes(1)
  expect(f.translation.select).not.toHaveBeenCalled()
  expect(f.openSettings).not.toHaveBeenCalled()
})

test('positions are clamped to the viewport and invalid anchors use safe coordinates', () => {
  expect(clampPopupPosition(999, 999, 360, 240, 800, 600)).toEqual({ x: 428, y: 348 })
  expect(clampPopupPosition(-40, -30, 360, 240, 800, 600)).toEqual({ x: 12, y: 12 })
  const f = fixture()
  f.controller.select('word', { x: NaN, y: Infinity })
  expect(f.controller.state.x).toBe(12)
  expect(f.controller.state.y).toBe(12)
})

test('opening and completing basic translation never start analysis', () => {
  const f = fixture()
  f.controller.select('word', { x: 0, y: 0 })
  expect(f.analysis.prepare).toHaveBeenCalledWith('word')
  expect(f.controller.canAnalyze()).toBe(false)
  f.controller.toggleAnalysis()
  expect(f.analysis.toggle).not.toHaveBeenCalled()
  f.succeed()
  expect(f.controller.canAnalyze()).toBe(true)
  expect(f.analysis.toggle).not.toHaveBeenCalled()
})

test('analysis is only delegated by a click after matching basic success', () => {
  const f = fixture()
  f.controller.select('word', { x: 0, y: 0 })
  f.succeed()
  f.controller.toggleAnalysis()
  expect(f.analysis.toggle).toHaveBeenCalledTimes(1)
  f.translation.state.text = 'another selection'
  f.controller.toggleAnalysis()
  expect(f.analysis.toggle).toHaveBeenCalledTimes(1)
})

test('failed or empty basic results do not enable analysis', () => {
  const f = fixture()
  f.controller.select('word', { x: 0, y: 0 })
  f.succeed()
  f.translation.state.status = 'error'
  f.controller.toggleAnalysis()
  f.translation.state.status = 'success'
  f.translation.state.result = '  '
  f.controller.toggleAnalysis()
  expect(f.controller.canAnalyze()).toBe(false)
  expect(f.analysis.toggle).not.toHaveBeenCalled()
})

test('analysis actions preserve basic translation and do not stop pronunciation', () => {
  const f = fixture()
  f.controller.select('word', { x: 0, y: 0 })
  f.succeed()
  f.speech.stop.mockClear()
  f.translation.close.mockClear()
  f.controller.toggleAnalysis()
  f.controller.cancelAnalysis()
  expect(f.analysis.cancel).toHaveBeenCalledTimes(1)
  expect(f.translation.state.result).toBe('基础译文')
  expect(f.translation.close).not.toHaveBeenCalled()
  expect(f.speech.stop).not.toHaveBeenCalled()
})

test('selection changes and closing invalidate the previous analysis', () => {
  const f = fixture()
  f.controller.select('first', { x: 0, y: 0 })
  f.controller.select('second', { x: 20, y: 30 })
  expect(f.analysis.prepare.mock.calls).toEqual([['first'], ['second']])
  f.controller.close()
  expect(f.analysis.close).toHaveBeenCalledTimes(1)
  f.controller.toggleAnalysis()
  expect(f.analysis.toggle).not.toHaveBeenCalled()
})

test('settings and disposal also clear the independent analysis cache', () => {
  const f = fixture()
  f.controller.select('word', { x: 0, y: 0 })
  f.controller.openSettings()
  expect(f.analysis.invalidateCache).toHaveBeenCalledTimes(1)
  f.controller.dispose()
  f.controller.dispose()
  expect(f.analysis.dispose).toHaveBeenCalledTimes(1)
})
