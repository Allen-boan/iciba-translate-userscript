import { createSelectionObserver } from '~/service/selection'

let selected: Selection | null
let observer: ReturnType<typeof createSelectionObserver> | undefined
let onSelection: jest.Mock
let onClear: jest.Mock
let onStart: jest.Mock

const isOwnNode = (node: Node) => {
  const element = node.nodeType === 1 ? node as Element : node.parentElement
  return !!element?.closest('#own-root')
}

const choose = (text = 'hello', element = document.body, hasRect = true) => {
  const node = element.firstChild || element
  selected = {
    anchorNode: node,
    focusNode: node,
    rangeCount: 1,
    isCollapsed: !text,
    toString: () => text,
    getRangeAt: () => ({
      commonAncestorContainer: node,
      startContainer: node,
      endContainer: node,
      intersectsNode: () => false,
      getBoundingClientRect: hasRect ? () => ({ left: 40, bottom: 90, width: 50, height: 20 }) : undefined,
    }),
  } as unknown as Selection
}

const mouse = (type: 'mousedown' | 'mouseup', element = document.body, button = 0) => {
  element.dispatchEvent(new MouseEvent(type, { bubbles: true, button, clientX: 70, clientY: 80 }))
}

beforeEach(() => {
  jest.useFakeTimers()
  document.body.innerHTML = '<p id="reading">Reading content</p><div id="own-root"><button>US</button></div>'
  selected = null
  onSelection = jest.fn()
  onClear = jest.fn()
  onStart = jest.fn()
  jest.spyOn(window, 'getSelection').mockImplementation(() => selected)
  observer = createSelectionObserver({
    document,
    window,
    isOwnEvent: event => event.composedPath().some(target => (
      !!target && typeof (target as Node).nodeType === 'number' && isOwnNode(target as Node)
    )),
    isOwnNode,
    isUserGesture: () => true,
    onSelection,
    onClear,
    onStart,
  })
})

afterEach(() => {
  observer?.dispose()
  observer = undefined
  jest.clearAllTimers()
  jest.useRealTimers()
  jest.restoreAllMocks()
  document.body.innerHTML = ''
})

test('is lazy and start is idempotent', () => {
  choose()
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  observer!.start()
  observer!.start()
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledTimes(1)
})

test('cancels previous work on pointer down and waits until selection is complete', () => {
  observer!.start()
  mouse('mousedown')
  choose('part')
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onStart).toHaveBeenCalledTimes(1)
  expect(onSelection).not.toHaveBeenCalled()
  choose('complete phrase')
  mouse('mouseup')
  expect(onSelection).not.toHaveBeenCalled()
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledWith('complete phrase', { x: 40, y: 90 })
})

test('merges selectionchange and keyboard events without changing selection', () => {
  observer!.start()
  choose('a full sentence.')
  document.dispatchEvent(new Event('selectionchange'))
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledTimes(1)
  expect(selected!.toString()).toBe('a full sentence.')
})

test('uses pointer position when a range has no rectangle implementation', () => {
  observer!.start()
  choose('word', document.body, false)
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledWith('word', { x: 70, y: 80 })
})

test('does not read a delayed stale selection from before mouseup', () => {
  observer!.start()
  choose('old')
  mouse('mouseup')
  choose('new')
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledWith('new', { x: 40, y: 90 })
})

test('does not treat clicking a pronunciation button as a new webpage selection', () => {
  observer!.start()
  choose('hello')
  const button = document.querySelector('#own-root button') as HTMLElement
  mouse('mousedown', button)
  mouse('mouseup', button)
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).not.toHaveBeenCalled()
  expect(onStart).not.toHaveBeenCalled()
})

test('ignores selected plugin content even without a plugin mouse event', () => {
  observer!.start()
  choose('translation text', document.querySelector('#own-root') as HTMLElement)
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onStart).not.toHaveBeenCalled()
})

test.each(['input', 'textarea', 'select', 'div[contenteditable]'])('never translates an editable target: %s', (kind) => {
  observer!.start()
  const element = document.createElement(kind.startsWith('div') ? 'div' : kind)
  if (kind.startsWith('div')) element.setAttribute('contenteditable', 'true')
  element.textContent = 'private material'
  document.body.appendChild(element)
  choose('private material', element)
  mouse('mousedown', element)
  mouse('mouseup', element)
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalled()
})

test('password input values are never read, even with an old document selection', () => {
  observer!.start()
  choose('previous selection')
  const input = document.createElement('input')
  input.type = 'password'
  document.body.appendChild(input)
  const valueGetter = jest.spyOn(input, 'value', 'get')
  input.focus()
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(valueGetter).not.toHaveBeenCalled()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalled()
})

test('ignores editable range endpoints when event target is the document', () => {
  observer!.start()
  const editable = document.createElement('div')
  editable.setAttribute('contenteditable', 'plaintext-only')
  editable.textContent = 'private'
  document.body.appendChild(editable)
  choose('private', editable)
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalled()
})

test('empty or unavailable selection closes previous work', () => {
  observer!.start()
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  choose('  ')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalledTimes(2)
})

test('DOM selection exceptions fail closed', () => {
  observer!.start()
  jest.spyOn(window, 'getSelection').mockImplementation(() => { throw new Error('unavailable') })
  mouse('mouseup')
  expect(() => jest.runOnlyPendingTimers()).not.toThrow()
  expect(onClear).toHaveBeenCalled()
  expect(onSelection).not.toHaveBeenCalled()
})

test('Escape clears pending selection and prevents a queued change from reopening it', () => {
  observer!.start()
  choose()
  mouse('mouseup')
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', bubbles: true }))
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalledTimes(1)
})

test('window blur stops pending selection work', () => {
  observer!.start()
  choose()
  mouse('mouseup')
  window.dispatchEvent(new Event('blur'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalledTimes(1)
})

test('right-click does not start or submit an automatic translation', () => {
  observer!.start()
  choose()
  mouse('mousedown', document.body, 2)
  mouse('mouseup', document.body, 2)
  jest.runOnlyPendingTimers()
  expect(onStart).not.toHaveBeenCalled()
  expect(onSelection).not.toHaveBeenCalled()
})

test('dispose clears delayed work and unregisters all listeners', () => {
  observer!.start()
  choose()
  mouse('mouseup')
  observer!.dispose()
  observer!.dispose()
  observer!.start()
  jest.runOnlyPendingTimers()
  mouse('mousedown')
  mouse('mouseup')
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onStart).not.toHaveBeenCalled()
})

test('programmatic selectionchange alone cannot submit selected text', () => {
  observer!.start()
  choose('script-selected material')
  const readText = jest.spyOn(selected!, 'toString')
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(readText).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalledTimes(1)
})

test('synthetic mouse and keyboard events cannot submit with the production default', () => {
  observer!.dispose()
  observer = createSelectionObserver({ document, window, isOwnEvent: () => false, isOwnNode, onSelection, onClear })
  observer.start()
  choose('script-selected material')
  const readText = jest.spyOn(selected!, 'toString')
  mouse('mousedown')
  mouse('mouseup')
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(readText).not.toHaveBeenCalled()
})

test('selectionchange does not erase a pending read authorized by mouseup', () => {
  observer!.start()
  choose('user-selected phrase')
  mouse('mouseup')
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledTimes(1)
  expect(onSelection).toHaveBeenCalledWith('user-selected phrase', { x: 40, y: 90 })
})

test('a late unchanged selectionchange does not close the newly opened popup', () => {
  observer!.start()
  choose('user-selected phrase')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  document.dispatchEvent(new Event('selectionchange'))
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledTimes(1)
  expect(onClear).not.toHaveBeenCalled()
})

test.each(['input', 'textarea', 'select', 'div'])('rejects a range spanning an embedded editor before reading text: %s', (tag) => {
  observer!.start()
  const before = document.createElement('p')
  before.textContent = 'before'
  const editor = document.createElement(tag)
  if (tag === 'div') editor.setAttribute('contenteditable', 'true')
  editor.textContent = 'private draft'
  const after = document.createElement('p')
  after.textContent = 'after'
  document.body.append(before, editor, after)
  const range = document.createRange()
  range.setStart(before.firstChild!, 0)
  range.setEnd(after.firstChild!, 5)
  const readText = jest.fn(() => 'before private draft after')
  selected = {
    anchorNode: before.firstChild,
    anchorOffset: 0,
    focusNode: after.firstChild,
    focusOffset: 5,
    rangeCount: 1,
    isCollapsed: false,
    getRangeAt: () => range,
    toString: readText,
  } as unknown as Selection
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(readText).not.toHaveBeenCalled()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalled()
})

test.each(['missing', 'throws'])('fails closed when editor intersection cannot be checked: %s', (mode) => {
  observer!.start()
  const editor = document.createElement('textarea')
  document.body.appendChild(editor)
  choose('selected text')
  const range = selected!.getRangeAt(0)
  Object.defineProperty(range, 'intersectsNode', {
    value: mode === 'missing' ? undefined : () => { throw new Error('detached range') },
  })
  const readText = jest.spyOn(selected!, 'toString')
  selected!.getRangeAt = () => range
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(readText).not.toHaveBeenCalled()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalled()
})

test('plugin editor controls do not block a webpage selection', () => {
  observer!.start()
  const input = document.createElement('input')
  document.querySelector('#own-root')!.appendChild(input)
  choose('reading text')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledWith('reading text', { x: 40, y: 90 })
})

test('multiple ranges fail closed instead of reading an unchecked second range', () => {
  observer!.start()
  choose('multiple ranges')
  Object.defineProperty(selected!, 'rangeCount', { value: 2 })
  const readText = jest.spyOn(selected!, 'toString')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(readText).not.toHaveBeenCalled()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onClear).toHaveBeenCalled()
})

const startCircleObserver = () => {
  observer?.dispose()
  observer = createSelectionObserver({
    document,
    window,
    isOwnEvent: (event) => event.composedPath().some((target) => (
      !!target && typeof (target as Node).nodeType === 'number' && isOwnNode(target as Node)
    )),
    isOwnNode,
    isUserGesture: () => true,
    preferPointer: true,
    suppressUnchangedClick: true,
    onSelection,
    onClear,
    onStart,
  })
  observer.start()
}

test('circle mode uses the release pointer and includes selection bounds for avoiding text', () => {
  startCircleObserver()
  mouse('mousedown')
  choose('word')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledWith('word', {
    x: 70, y: 80, selectionBounds: { left: 40, top: 70, right: 90, bottom: 90 },
  })
})

test('circle mode uses the selection rectangle for keyboard selection', () => {
  startCircleObserver()
  choose('keyboard phrase')
  document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', shiftKey: true, bubbles: true }))
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledWith('keyboard phrase', {
    x: 40, y: 90, selectionBounds: { left: 40, top: 70, right: 90, bottom: 90 },
  })
})

test('an outside click that leaves an old range unchanged dismisses without redisplaying the circle', () => {
  startCircleObserver()
  choose('old range')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  onSelection.mockClear()
  mouse('mousedown')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onStart).toHaveBeenCalled()
  expect(onClear).toHaveBeenCalled()
  expect(onSelection).not.toHaveBeenCalled()
})

test('reselecting the same range after an intermediate change still offers a new circle', () => {
  startCircleObserver()
  choose('same word')
  mouse('mousedown')
  document.dispatchEvent(new Event('selectionchange'))
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledTimes(1)
})

test('a double-click word selection commits once after the second mouseup', () => {
  startCircleObserver()
  mouse('mousedown')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  mouse('mousedown')
  choose('double-clicked')
  document.dispatchEvent(new Event('selectionchange'))
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  expect(onSelection).toHaveBeenCalledTimes(1)
  expect(onSelection.mock.calls[0][0]).toBe('double-clicked')
})

test('copy shortcuts neither reselect nor prevent the page copy operation', () => {
  startCircleObserver()
  choose('copied text')
  mouse('mouseup')
  jest.runOnlyPendingTimers()
  onSelection.mockClear()
  const key = new KeyboardEvent('keyup', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true })
  document.body.dispatchEvent(key)
  const copy = new Event('copy', { bubbles: true, cancelable: true })
  document.dispatchEvent(copy)
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(key.defaultPrevented).toBe(false)
  expect(copy.defaultPrevented).toBe(false)
  expect(selected!.toString()).toBe('copied text')
})

test('releasing a drag outside the plugin does not submit the old webpage selection', () => {
  observer!.start()
  choose('old webpage selection')
  const inside = document.querySelector<HTMLButtonElement>('#own-root button')!
  mouse('mousedown', inside)
  mouse('mouseup', document.body)
  jest.runOnlyPendingTimers()
  expect(onSelection).not.toHaveBeenCalled()
  expect(onStart).not.toHaveBeenCalled()
  expect(onClear).not.toHaveBeenCalled()
})
