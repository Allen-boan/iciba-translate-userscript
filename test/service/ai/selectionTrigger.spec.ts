import { createTranslationController } from '~/service/ai/translation'
import { createAnalysisController } from '~/service/ai/analysis'
import { createAiPopupController } from '~/view/AiPopup/controller'
import { createSelectionTrigger, placeSelectionTrigger, SELECTION_TRIGGER_SIZE } from '~/view/AiPopup/selectionTrigger'
import { AiCompletion } from '~/service/ai/types'

const click = { isTrusted: true }
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const fixture = () => {
  const key = Math.random().toString(36)
  const credentials = jest.fn(async () => ({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: key }))
  const cancel = jest.fn()
  const complete = jest.fn(() => ({ promise: Promise.resolve({ text: JSON.stringify({ sourceLanguage: 'en', translation: '译文' }), finishReason: 'stop' }), cancel }))
  const translation = createTranslationController({ credentials, complete })
  const analysis = createAnalysisController({ credentials, complete })
  const speech = { speak: jest.fn(() => true), stop: jest.fn(), dispose: jest.fn() }
  const popup = createAiPopupController({ translation, analysis, speech, openSettings: jest.fn() })
  const trigger = createSelectionTrigger(popup.select)
  const select = (text: string) => {
    popup.close()
    trigger.show(text, { x: 100, y: 150 }, 800, 600)
  }
  return { credentials, complete, cancel, translation, analysis, speech, popup, trigger, select }
}

beforeEach(() => { jest.useFakeTimers() })
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers() })

test('selection alone shows only a circle, with zero credential lookups or AI requests', async () => {
  const f = fixture()
  f.select('copy this phrase')
  jest.advanceTimersByTime(60000)
  await flush()
  expect(f.trigger.state.visible).toBe(true)
  expect(f.popup.state.visible).toBe(false)
  expect(f.credentials).not.toHaveBeenCalled()
  expect(f.complete).not.toHaveBeenCalled()
  expect(f.speech.speak).not.toHaveBeenCalled()
})

test('clicking opens the card using the saved snapshot even if the webpage selection disappeared', async () => {
  const f = fixture()
  f.select('saved phrase')
  const selection = jest.spyOn(window, 'getSelection').mockReturnValue(null)
  f.trigger.activate(click)
  f.trigger.activate(click)
  expect(f.popup.state.visible).toBe(true)
  expect(f.popup.state.text).toBe('saved phrase')
  expect(f.trigger.state.visible).toBe(false)
  jest.advanceTimersByTime(250)
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(selection).not.toHaveBeenCalled()
  selection.mockRestore()
})

test('synthetic or missing activation events never spend tokens', async () => {
  const f = fixture()
  f.select('selected text')
  f.trigger.activate({ isTrusted: false })
  f.trigger.activate()
  jest.advanceTimersByTime(1000)
  await flush()
  expect(f.popup.state.visible).toBe(false)
  expect(f.complete).not.toHaveBeenCalled()
})

test('copy-style dismissal clears the circle without translating', async () => {
  const f = fixture()
  f.select('copy me')
  f.trigger.close()
  f.trigger.activate(click)
  jest.advanceTimersByTime(1000)
  await flush()
  expect(f.trigger.state.visible).toBe(false)
  expect(f.complete).not.toHaveBeenCalled()
})

test('rapid selection changes only translate the most recently saved text', async () => {
  const f = fixture()
  f.select('old')
  f.select('new')
  f.trigger.activate(click)
  jest.advanceTimersByTime(250)
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.translation.state.text).toBe('new')
})

test('a new candidate cancels the previous translation and waits for its own click', async () => {
  const f = fixture()
  let resolve!: (result: AiCompletion) => void
  f.complete.mockReturnValueOnce({ promise: new Promise<AiCompletion>((rs) => { resolve = rs }), cancel: f.cancel })
  f.select('old')
  f.trigger.activate(click)
  jest.advanceTimersByTime(250)
  await flush()
  f.select('new')
  expect(f.cancel).toHaveBeenCalledTimes(1)
  resolve({ text: 'late old result', finishReason: 'stop' })
  await flush()
  jest.advanceTimersByTime(1000)
  expect(f.translation.state.result).toBe('')
  expect(f.complete).toHaveBeenCalledTimes(1)
  expect(f.popup.state.visible).toBe(false)
})

test('pronunciation and explicit detailed analysis still work after the circle is clicked', async () => {
  const f = fixture()
  f.select('phrase')
  f.trigger.activate(click)
  jest.advanceTimersByTime(250)
  await flush()
  f.popup.speak('en-US')
  f.popup.speak('en-GB')
  expect(f.speech.speak.mock.calls).toEqual([['phrase', 'en-US'], ['phrase', 'en-GB']])
  expect(f.complete).toHaveBeenCalledTimes(1)
  f.popup.toggleAnalysis()
  await flush()
  expect(f.complete).toHaveBeenCalledTimes(2)
  expect(f.translation.state.result).toBe('译文')
  expect(f.analysis.state.status).toBe('success')
})

test('successful basic results still use cache after a new explicit click', async () => {
  const f = fixture()
  f.select('word')
  f.trigger.activate(click)
  jest.advanceTimersByTime(250)
  await flush()
  f.select('word')
  expect(f.popup.state.visible).toBe(false)
  f.trigger.activate(click)
  jest.advanceTimersByTime(250)
  await flush()
  expect(f.translation.state.cached).toBe(true)
  expect(f.complete).toHaveBeenCalledTimes(1)
})

test('invalid text and closed or disposed circles cannot open a card', () => {
  const open = jest.fn()
  const trigger = createSelectionTrigger(open)
  for (const text of ['', '  ', 'x'.repeat(2001)]) {
    trigger.show(text, { x: 0, y: 0 }, 800, 600)
    expect(trigger.state.visible).toBe(false)
  }
  trigger.show('valid', { x: 0, y: 0 }, 800, 600)
  trigger.close()
  trigger.activate(click)
  trigger.dispose()
  trigger.show('ignored', { x: 0, y: 0 }, 800, 600)
  trigger.activate(click)
  expect(open).not.toHaveBeenCalled()
})

test.each([{ x: 0, y: 0 }, { x: 799, y: 599 }, { x: -100, y: -100 }, { x: NaN, y: Infinity }])(
  '22px circle stays inside the viewport for %j', (anchor) => {
    const point = placeSelectionTrigger(anchor, 800, 600)
    expect(point.x).toBeGreaterThanOrEqual(0)
    expect(point.y).toBeGreaterThanOrEqual(0)
    expect(point.x + SELECTION_TRIGGER_SIZE).toBeLessThanOrEqual(800)
    expect(point.y + SELECTION_TRIGGER_SIZE).toBeLessThanOrEqual(600)
  },
)

test('circle avoids the selected text and leaves a gap from the pointer', () => {
  const bounds = { left: 20, top: 40, right: 170, bottom: 90 }
  const point = placeSelectionTrigger({ x: 100, y: 70, selectionBounds: bounds }, 800, 600)
  expect(point.x >= bounds.right || point.x + 22 <= bounds.left || point.y >= bounds.bottom || point.y + 22 <= bounds.top).toBe(true)
  expect(Math.abs(point.x - 100) >= 12 || Math.abs(point.y - 70) >= 12).toBe(true)
})

test('clamping near the bottom-right corner never puts the circle under the pointer', () => {
  const point = placeSelectionTrigger({ x: 780, y: 580 }, 800, 600)
  expect(point.x >= 792 || point.x + 22 <= 768 || point.y >= 592 || point.y + 22 <= 568).toBe(true)
})
