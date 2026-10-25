export interface SelectionAnchor {
  x: number
  y: number
  selectionBounds?: { left: number, top: number, right: number, bottom: number }
}

export interface SelectionObserverOptions {
  document?: Document
  window?: Window
  isOwnEvent: (event: Event) => boolean
  isOwnNode: (node: Node) => boolean
  isUserGesture?: (event: Event) => boolean
  preferPointer?: boolean
  suppressUnchangedClick?: boolean
  onSelection: (text: string, anchor: SelectionAnchor) => void
  onClear: () => void
  onPassiveClear?: () => void
  onStart?: () => void
}

const navigationKeys = new Set([
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown',
])

const isEditable = (node: Node | null): boolean => {
  let current = node
  while (current) {
    if (current.nodeType === 1) {
      const element = current as HTMLElement
      const tag = element.tagName.toLowerCase()
      const editable = element.getAttribute('contenteditable')
      if (['input', 'textarea', 'select', 'option'].includes(tag)
        || element.isContentEditable
        || (editable !== null && editable.toLowerCase() !== 'false')) {
        return true
      }
    }
    current = current.parentNode ?? (current as ShadowRoot).host ?? null
  }
  return false
}

// Selection is read only; input values and editable content are never inspected.
export const createSelectionObserver = (options: SelectionObserverOptions) => {
  const ownerDocument = options.document ?? (typeof document === 'undefined' ? undefined : document)
  const ownerWindow = options.window ?? ownerDocument?.defaultView ?? undefined
  let started = false
  let disposed = false
  let pointerDown = false
  let suppressChanges = false
  let ignorePointerUp = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastAnchor: SelectionAnchor = { x: 16, y: 16 }
  let committedSelection: Array<unknown> | null = null
  let pointerGesture = false
  let pointerStartSelection: Array<unknown> | null = null
  let pointerSelectionChanged = false

  const clearTimer = () => {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
  }

  const passiveClear = () => {
    const clear = options.onPassiveClear ?? options.onClear
    clear()
  }

  const ownEvent = (event: Event) => {
    try {
      return options.isOwnEvent(event)
    } catch {
      return true
    }
  }

  const ownNode = (node: Node | null) => !!node && options.isOwnNode(node)

  const userGesture = (event: Event) => {
    try {
      return options.isUserGesture ? options.isUserGesture(event) : event.isTrusted
    } catch {
      return false
    }
  }

  const selectionIdentity = (selection: Selection) => [
    selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset, selection.rangeCount,
  ]

  const unchangedSelection = (selection: Selection) => {
    const identity = selectionIdentity(selection)
    const committed = committedSelection
    return committed !== null && identity.every((value, index) => value === committed[index])
  }

  const intersectsEditable = (range: Range) => {
    if (!ownerDocument) {
      return true
    }
    const editors = ownerDocument.querySelectorAll('input, textarea, select, [contenteditable]')
    for (const editor of Array.from(editors)) {
      if (ownNode(editor)) {
        continue
      }
      const editable = editor.getAttribute('contenteditable')
      if (!['input', 'textarea', 'select'].includes(editor.tagName.toLowerCase())
        && (editable === null || editable.toLowerCase() === 'false')) {
        continue
      }
      if (typeof range.intersectsNode !== 'function' || range.intersectsNode(editor)) {
        return true
      }
    }
    return false
  }

  const blockedEvent = (event: Event) => {
    try {
      const path = event.composedPath()
      return path.some((target) => !!target && typeof (target as Node).nodeType === 'number' && isEditable(target as Node))
    } catch {
      return true
    }
  }

  const readSelection = () => {
    if (!started || disposed || pointerDown || suppressChanges || !ownerDocument || !ownerWindow) {
      return
    }
    let text = ''
    let anchor = lastAnchor
    let identity: Array<unknown> | null = null
    try {
      const active = ownerDocument.activeElement
      if (ownNode(active)) {
        return
      }
      if (isEditable(active)) {
        options.onClear()
        return
      }
      const selection = ownerWindow.getSelection()
      if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) {
        options.onClear()
        return
      }
      const pointerStart = pointerStartSelection
      if (options.suppressUnchangedClick && pointerGesture && pointerStart && !pointerSelectionChanged
        && selectionIdentity(selection).every((value, index) => value === pointerStart[index])) {
        options.onClear()
        return
      }
      if (ownNode(selection.anchorNode) || ownNode(selection.focusNode)) {
        return
      }
      if (isEditable(selection.anchorNode) || isEditable(selection.focusNode)) {
        options.onClear()
        return
      }
      const range = selection.getRangeAt(0)
      if (ownNode(range.commonAncestorContainer) || ownNode(range.startContainer) || ownNode(range.endContainer)) {
        return
      }
      if (isEditable(range.commonAncestorContainer) || isEditable(range.startContainer) || isEditable(range.endContainer)) {
        options.onClear()
        return
      }
      // A range can contain an editor while both endpoints remain in ordinary paragraphs.
      if (intersectsEditable(range)) {
        options.onClear()
        return
      }
      text = selection.toString().trim()
      identity = selectionIdentity(selection)
      if (text && typeof range.getBoundingClientRect === 'function') {
        const rect = range.getBoundingClientRect()
        if (Number.isFinite(rect.left) && Number.isFinite(rect.bottom) && (rect.width > 0 || rect.height > 0)) {
          anchor = { x: rect.left, y: rect.bottom }
          if (options.preferPointer) {
            const top = Number.isFinite(rect.top) ? rect.top : rect.bottom - rect.height
            const right = Number.isFinite(rect.right) ? rect.right : rect.left + rect.width
            if (pointerGesture) anchor = { ...lastAnchor }
            anchor.selectionBounds = { left: rect.left, top, right, bottom: rect.bottom }
          }
        }
      }
    } catch {
      options.onClear()
      return
    }
    if (text) {
      committedSelection = identity
      options.onSelection(text, { ...anchor })
    } else {
      options.onClear()
    }
  }

  const scheduleRead = () => {
    clearTimer()
    timer = setTimeout(() => {
      timer = undefined
      readSelection()
    }, 0)
  }

  const onMouseDown = (event: MouseEvent) => {
    if (!userGesture(event)) {
      return
    }
    clearTimer()
    if (ownEvent(event)) {
      ignorePointerUp = true
      suppressChanges = true
      pointerDown = false
      return
    }
    if (blockedEvent(event)) {
      ignorePointerUp = true
      suppressChanges = true
      pointerDown = false
      options.onClear()
      return
    }
    if (event.button !== 0) {
      return
    }
    suppressChanges = false
    ignorePointerUp = false
    pointerDown = true
    pointerSelectionChanged = false
    pointerStartSelection = null
    try {
      const selection = ownerWindow?.getSelection()
      if (selection && !selection.isCollapsed) pointerStartSelection = selectionIdentity(selection)
    } catch {
      pointerStartSelection = null
    }
    options.onStart?.()
  }

  const onMouseUp = (event: MouseEvent) => {
    if (!userGesture(event)) {
      return
    }
    if (ignorePointerUp || ownEvent(event) || blockedEvent(event)) {
      ignorePointerUp = false
      clearTimer()
      pointerDown = false
      suppressChanges = true
      return
    }
    if (event.button !== 0) {
      return
    }
    pointerDown = false
    suppressChanges = false
    pointerGesture = true
    lastAnchor = { x: event.clientX, y: event.clientY }
    scheduleRead()
  }

  const onSelectionChange = () => {
    if (pointerDown) {
      pointerSelectionChanged = true
      return
    }
    if (suppressChanges) {
      return
    }
    try {
      const selection = ownerWindow?.getSelection()
      if (ownNode(ownerDocument?.activeElement ?? null)
        || ownNode(selection?.anchorNode ?? null) || ownNode(selection?.focusNode ?? null)) {
        return
      }
      if (selection && unchangedSelection(selection)) {
        return
      }
    } catch {
      passiveClear()
      return
    }
    // Browser and webpage-script changes are indistinguishable here. Only a
    // trusted mouseup or navigation keyup may schedule a new paid translation.
    // Keep a read already scheduled by that gesture; this event only invalidates.
    passiveClear()
  }

  const onKeyUp = (event: KeyboardEvent) => {
    if (!userGesture(event)) {
      return
    }
    if (ownEvent(event) || blockedEvent(event)) {
      return
    }
    if (event.key === 'Escape') {
      clearTimer()
      suppressChanges = true
      options.onClear()
      return
    }
    if (!navigationKeys.has(event.key) && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) {
      return
    }
    if (options.onPassiveClear && !event.shiftKey
      && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a')) {
      options.onPassiveClear()
      return
    }
    suppressChanges = false
    pointerGesture = false
    options.onStart?.()
    scheduleRead()
  }

  const onBlur = () => {
    clearTimer()
    pointerDown = false
    suppressChanges = true
    options.onClear()
  }

  const start = () => {
    if (started || disposed || !ownerDocument || !ownerWindow) {
      return
    }
    started = true
    ownerDocument.addEventListener('mousedown', onMouseDown, true)
    ownerDocument.addEventListener('mouseup', onMouseUp, true)
    ownerDocument.addEventListener('selectionchange', onSelectionChange)
    ownerDocument.addEventListener('keyup', onKeyUp, true)
    ownerWindow.addEventListener('blur', onBlur)
  }

  const dispose = () => {
    if (disposed) {
      return
    }
    disposed = true
    clearTimer()
    ownerDocument?.removeEventListener('mousedown', onMouseDown, true)
    ownerDocument?.removeEventListener('mouseup', onMouseUp, true)
    ownerDocument?.removeEventListener('selectionchange', onSelectionChange)
    ownerDocument?.removeEventListener('keyup', onKeyUp, true)
    ownerWindow?.removeEventListener('blur', onBlur)
    started = false
    committedSelection = null
  }

  return { start, dispose }
}
