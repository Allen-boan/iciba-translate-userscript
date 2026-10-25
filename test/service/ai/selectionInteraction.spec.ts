import { readFileSync } from 'fs'
import { join } from 'path'
import * as Vue from 'vue'
import { compile } from '@vue/compiler-dom'
import AiPopup from '~/view/AiPopup/AiPopup'
import { createChatCompletion } from '~/service/ai/client'
import { createBrowserSpeechService } from '~/service/speech'
import { icibaRoot, shadowRoot } from '~/service/shadowRoot'
import { viewService } from '~/service/view'

jest.mock('~/service/shadowRoot', () => {
  const host = document.createElement('div')
  return { icibaRoot: host, shadowRoot: host.attachShadow({ mode: 'open' }) }
})
jest.mock('~/service/selection', () => {
  const actual = jest.requireActual('~/service/selection')
  return { ...actual, createSelectionObserver: (options: unknown) => actual.createSelectionObserver({
    ...(options as object), isUserGesture: () => true,
  }) }
})
jest.mock('~/service/ai/client', () => ({
  createChatCompletion: jest.fn(() => ({
    promise: Promise.resolve({ text: JSON.stringify({ sourceLanguage: 'en', translation: '模拟译文' }), finishReason: 'stop' }), cancel: jest.fn(),
  })),
}))
jest.mock('~/service/store/ai', () => ({
  getSavedAiCredentials: jest.fn(async () => ({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'preview-' + Math.random().toString(36) })),
}))
jest.mock('~/service/speech', () => {
  const actual = jest.requireActual('~/service/speech')
  return { ...actual, createBrowserSpeechService: jest.fn((options) => {
    Object.assign(options.state, { supported: true, usAvailable: true, gbAvailable: true })
    return { state: options.state, speak: jest.fn(() => true), stop: jest.fn(), dispose: jest.fn() }
  }) }
})

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); await Vue.nextTick() }
const source = readFileSync(join(__dirname, '../../../src/view/AiPopup/AiPopup.vue'), 'utf8')
const template = source.match(/<template>([\s\S]*?)<\/template>/)![1]
const render = new Function('Vue', compile(template, { mode: 'function', prefixIdentifiers: true }).code)(Vue)
let app: Vue.App
let instance: { m: { activateSelection: (event: { isTrusted: boolean }) => void } }
let selection: Selection | null
let warnings: jest.SpyInstance
const request = createChatCompletion as jest.MockedFunction<typeof createChatCompletion>

const mouse = (type: 'mousedown' | 'mouseup', element: Element) => {
  const event = new MouseEvent(type, { bubbles: true, composed: true, cancelable: true, button: 0, clientX: 100, clientY: 90 })
  element.dispatchEvent(event)
  return event
}
const selectText = async (text: string) => {
  const paragraph = document.querySelector('#reading')!
  mouse('mousedown', paragraph)
  const node = paragraph.firstChild!
  selection = {
    anchorNode: node, focusNode: node, anchorOffset: 0, focusOffset: text.length,
    isCollapsed: false, rangeCount: 1, toString: () => text,
    getRangeAt: () => ({ startContainer: node, endContainer: node, commonAncestorContainer: node,
      intersectsNode: () => false,
      getBoundingClientRect: () => ({ left: 30, top: 70, right: 180, bottom: 100, width: 150, height: 30 }),
    }),
  } as unknown as Selection
  document.dispatchEvent(new Event('selectionchange'))
  mouse('mouseup', paragraph)
  jest.advanceTimersByTime(0)
  await flush()
}

beforeEach(async () => {
  jest.useFakeTimers()
  jest.clearAllMocks()
  warnings = jest.spyOn(console, 'warn').mockImplementation(() => {})
  viewService.state.setting = false
  document.body.innerHTML = '<p id="reading">A phrase for reading and copying.</p>'
  shadowRoot.innerHTML = ''
  document.body.appendChild(icibaRoot)
  selection = null
  jest.spyOn(window, 'getSelection').mockImplementation(() => selection)
  const mount = document.createElement('div')
  shadowRoot.appendChild(mount)
  app = Vue.createApp({ ...AiPopup, render })
  instance = app.mount(mount) as unknown as typeof instance
  await flush()
})
afterEach(() => {
  app.unmount()
  const calls = [...warnings.mock.calls]
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
  expect(calls).toHaveLength(0)
})

test('the real component renders only the circle on mouse selection and sends zero AI requests', async () => {
  await selectText('a phrase')
  jest.advanceTimersByTime(1000)
  await flush()
  expect(shadowRoot.querySelector('.ai-selection-trigger')).not.toBeNull()
  expect(shadowRoot.querySelector('.ai-popup')).toBeNull()
  expect(request).not.toHaveBeenCalled()
})

test('a recognized Indonesian source shows its own speech button and no English accents', async () => {
  request.mockReturnValueOnce({ promise: Promise.resolve({ text: JSON.stringify({ sourceLanguage: 'id', translation: '早上好' }), finishReason: 'stop' }), cancel: jest.fn() })
  await selectText('Selamat pagi')
  instance.m.activateSelection({ isTrusted: true })
  jest.advanceTimersByTime(250)
  await flush()
  const speech = (createBrowserSpeechService as jest.Mock).mock.results[0].value
  speech.state.availableLanguages = ['id-id']
  await flush()
  expect(shadowRoot.textContent).not.toContain('美式发音')
  expect(shadowRoot.textContent).not.toContain('英式发音')
  const button = Array.from(shadowRoot.querySelectorAll<HTMLButtonElement>('.ai-popup button')).find(b => b.textContent?.includes('朗读原文'))!
  expect(button.disabled).toBe(false)
  button.click()
  expect(speech.speak).toHaveBeenCalledWith('Selamat pagi', 'id-ID')
  expect(request).toHaveBeenCalledTimes(1)
})

test('missing source metadata keeps clean translation but never assumes English speech', async () => {
  request.mockReturnValueOnce({ promise: Promise.resolve({ text: JSON.stringify({ translation: '你好' }), finishReason: 'stop' }), cancel: jest.fn() })
  await selectText('Hello')
  instance.m.activateSelection({ isTrusted: true })
  jest.advanceTimersByTime(250)
  await flush()
  expect(shadowRoot.textContent).toContain('原文语言未能确认')
  expect(shadowRoot.querySelector('.result')!.textContent).toBe('你好')
  expect(shadowRoot.textContent).not.toContain('美式发音')
  expect(shadowRoot.textContent).not.toContain('translation')
  expect(request).toHaveBeenCalledTimes(1)
})

test('native mousedown is prevented only on the circle; activation survives selection loss and dispatches once', async () => {
  await selectText('saved words')
  const circle = shadowRoot.querySelector('.ai-selection-trigger')!
  expect(mouse('mousedown', circle).defaultPrevented).toBe(true)
  selection = null
  document.dispatchEvent(new Event('selectionchange'))
  mouse('mouseup', circle)
  // jsdom cannot create trusted events; exercise the real handler with its trusted-event contract.
  instance.m.activateSelection({ isTrusted: true })
  instance.m.activateSelection({ isTrusted: true })
  jest.advanceTimersByTime(250)
  await flush()
  expect(shadowRoot.querySelector('.ai-selection-trigger')).toBeNull()
  expect(shadowRoot.querySelector('.ai-popup')).not.toBeNull()
  expect(request).toHaveBeenCalledTimes(1)
  expect(JSON.parse(request.mock.calls[0][0].messages[1].content).text).toBe('saved words')
})

test('copy and Escape dismiss circles without interfering with the page or sending requests', async () => {
  await selectText('copied phrase')
  const copy = new Event('copy', { bubbles: true, cancelable: true })
  document.dispatchEvent(copy)
  await flush()
  expect(copy.defaultPrevented).toBe(false)
  expect(shadowRoot.querySelector('.ai-selection-trigger')).toBeNull()
  expect(selection!.toString()).toBe('copied phrase')
  await selectText('escape phrase')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flush()
  jest.advanceTimersByTime(1000)
  expect(shadowRoot.querySelector('.ai-selection-trigger')).toBeNull()
  expect(request).not.toHaveBeenCalled()
})

test('outside clicks with an unchanged selection do not reshow the old circle', async () => {
  await selectText('outside phrase')
  mouse('mousedown', document.body)
  mouse('mouseup', document.body)
  jest.advanceTimersByTime(0)
  await flush()
  expect(shadowRoot.querySelector('.ai-selection-trigger')).toBeNull()
  expect(shadowRoot.querySelector('.ai-popup')).toBeNull()
  expect(request).not.toHaveBeenCalled()
})

test('keyboard ranges offer a circle, and script-generated circle clicks do not activate translation', async () => {
  await selectText('keyboard phrase')
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
  jest.advanceTimersByTime(0)
  await flush()
  const circle = shadowRoot.querySelector<HTMLButtonElement>('.ai-selection-trigger')!
  circle.click()
  jest.advanceTimersByTime(1000)
  await flush()
  expect(shadowRoot.querySelector('.ai-popup')).toBeNull()
  expect(request).not.toHaveBeenCalled()
})

test('the activated card keeps US, GB and opt-in detailed analysis controls', async () => {
  await selectText('learning phrase')
  instance.m.activateSelection({ isTrusted: true })
  jest.advanceTimersByTime(250)
  await flush()
  const buttons = Array.from(shadowRoot.querySelectorAll<HTMLButtonElement>('.ai-popup button'))
  buttons.find((button) => button.textContent?.includes('美式发音'))!.click()
  buttons.find((button) => button.textContent?.includes('英式发音'))!.click()
  const speech = (createBrowserSpeechService as jest.Mock).mock.results[0].value
  expect(speech.speak.mock.calls).toEqual([['learning phrase', 'en-US'], ['learning phrase', 'en-GB']])
  expect(request).toHaveBeenCalledTimes(1)
  buttons.find((button) => button.textContent?.includes('深入解析'))!.click()
  await flush()
  expect(request).toHaveBeenCalledTimes(2)
  expect(shadowRoot.querySelector('.translation')!.textContent).toContain('模拟译文')
})

const openCard = async () => {
  await selectText('reading phrase')
  instance.m.activateSelection({ isTrusted: true })
  jest.advanceTimersByTime(250)
  await flush()
  return shadowRoot.querySelector<HTMLElement>('.ai-popup')!
}

const mockCardSize = (card: HTMLElement) => {
  jest.spyOn(card, 'getBoundingClientRect').mockImplementation(() => {
    const left = parseFloat(card.style.left)
    const top = parseFloat(card.style.top)
    return { x: left, y: top, left, top, right: left + 360, bottom: top + 280, width: 360, height: 280 } as DOMRect
  })
}

test('page scroll, wheel and passive selection changes never close an open card or resend AI requests', async () => {
  const card = await openCard()
  const position = card.getAttribute('style')
  window.dispatchEvent(new Event('scroll'))
  document.body.dispatchEvent(new Event('scroll', { bubbles: true }))
  document.body.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: 200 }))
  document.body.dispatchEvent(new Event('mousewheel', { bubbles: true }))
  selection = null
  document.dispatchEvent(new Event('selectionchange'))
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'PageDown', bubbles: true }))
  await flush()
  jest.advanceTimersByTime(1000)
  await flush()
  expect(shadowRoot.querySelector('.ai-popup')).toBe(card)
  expect(card.getAttribute('style')).toBe(position)
  expect(request).toHaveBeenCalledTimes(1)
})

test('body scroll and clicks on translated text preserve the card and native copying', async () => {
  const card = await openCard()
  const body = card.querySelector<HTMLElement>('.popup-body')!
  expect(mouse('mousedown', body).defaultPrevented).toBe(false)
  mouse('mouseup', body)
  body.dispatchEvent(new Event('scroll'))
  const wheel = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100 })
  body.dispatchEvent(wheel)
  document.dispatchEvent(new Event('copy', { bubbles: true }))
  await flush()
  expect(wheel.defaultPrevented).toBe(false)
  expect(shadowRoot.querySelector('.ai-popup')).toBe(card)
  expect(card.classList.contains('is-dragging')).toBe(false)
  expect(request).toHaveBeenCalledTimes(1)
})

test('clicking outside closes the card while the close button remains independent of dragging', async () => {
  await openCard()
  mouse('mousedown', document.body)
  await flush()
  expect(shadowRoot.querySelector('.ai-popup')).toBeNull()
  const card = await openCard()
  const close = card.querySelector<HTMLButtonElement>('[aria-label="关闭翻译窗口"]')!
  mouse('mousedown', close)
  expect(card.classList.contains('is-dragging')).toBe(false)
  close.click()
  await flush()
  expect(shadowRoot.querySelector('.ai-popup')).toBeNull()
})

test('title-bar drag moves in viewport coordinates and release over the webpage does not close or translate', async () => {
  const card = await openCard()
  mockCardSize(card)
  const x = parseFloat(card.style.left)
  const y = parseFloat(card.style.top)
  const header = card.querySelector('.toolbar')!
  expect(mouse('mousedown', header).defaultPrevented).toBe(true)
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 220, clientY: 170, buttons: 1 }))
  await flush()
  expect(parseFloat(card.style.left)).toBe(x + 120)
  expect(parseFloat(card.style.top)).toBe(y + 80)
  mouse('mouseup', document.body)
  jest.advanceTimersByTime(0)
  await flush()
  const position = card.getAttribute('style')
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 400, buttons: 1 }))
  await flush()
  expect(shadowRoot.querySelector('.ai-popup')).toBe(card)
  expect(card.getAttribute('style')).toBe(position)
  expect(card.classList.contains('is-dragging')).toBe(false)
  expect(request).toHaveBeenCalledTimes(1)
})

test('dragging to viewport edges and then resizing keeps the card inside without another request', async () => {
  const card = await openCard()
  mockCardSize(card)
  mouse('mousedown', card.querySelector('.toolbar')!)
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: 9000, clientY: 9000, buttons: 1 }))
  await flush()
  expect(parseFloat(card.style.left) + 360).toBeLessThanOrEqual(window.innerWidth)
  expect(parseFloat(card.style.top) + 280).toBeLessThanOrEqual(window.innerHeight)
  window.dispatchEvent(new MouseEvent('mousemove', { clientX: -9000, clientY: -9000, buttons: 1 }))
  await flush()
  expect(parseFloat(card.style.left)).toBeGreaterThanOrEqual(0)
  expect(parseFloat(card.style.top)).toBeGreaterThanOrEqual(0)
  mouse('mouseup', card)
  const width = window.innerWidth
  const height = window.innerHeight
  try {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 400 })
    window.dispatchEvent(new Event('resize'))
    await flush()
    expect(shadowRoot.querySelector('.ai-popup')).toBe(card)
    expect(parseFloat(card.style.left) + 360).toBeLessThanOrEqual(500)
    expect(parseFloat(card.style.top) + 280).toBeLessThanOrEqual(400)
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height })
  }
  expect(request).toHaveBeenCalledTimes(1)
})

test('long analysis stays complete in the scrolling body and the header remains outside it', async () => {
  const card = await openCard()
  const longText = '长篇学习解析。\n'.repeat(2000) + '最后一行仍可阅读'
  request.mockReturnValueOnce({ promise: Promise.resolve({ text: longText, finishReason: 'stop' }), cancel: jest.fn() })
  Array.from(card.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('深入解析'))!.click()
  await flush()
  const body = card.querySelector<HTMLElement>('.popup-body')!
  expect(body.querySelector('.analysis-content')!.textContent).toContain(longText)
  expect(body.querySelector('.toolbar')).toBeNull()
  body.scrollTop = 10000
  body.dispatchEvent(new Event('scroll'))
  await flush()
  expect(shadowRoot.querySelector('.ai-popup')).toBe(card)
  expect(body.textContent).toContain('最后一行仍可阅读')
  expect(request).toHaveBeenCalledTimes(2)
})
