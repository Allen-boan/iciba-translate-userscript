import { AI_MAX_INPUT_LENGTH } from '~/service/ai/prompts'
import type { SelectionAnchor } from '~/service/selection'

export const SELECTION_TRIGGER_SIZE = 22

export const createSelectionTriggerState = () => ({ visible: false, x: 8, y: 8 })

export const placeSelectionTrigger = (anchor: SelectionAnchor, width: number, height: number) => {
  const size = SELECTION_TRIGGER_SIZE
  const gap = 12
  const margin = 8
  const clamp = (value: number, extent: number) => Math.max(0, Math.min(value, extent - size))
  const x = Number.isFinite(anchor.x) ? anchor.x : margin
  const y = Number.isFinite(anchor.y) ? anchor.y : margin
  const bound = (point: { x: number, y: number }) => ({
    x: clamp(Math.max(margin, Math.min(point.x, width - size - margin)), width),
    y: clamp(Math.max(margin, Math.min(point.y, height - size - margin)), height),
  })
  const candidates = [
    { x: x + gap, y: y + gap },
    { x: x + gap, y: y - gap - size },
    { x: x - gap - size, y: y + gap },
    { x: x - gap - size, y: y - gap - size },
  ]
  const rect = anchor.selectionBounds
  if (rect) {
    candidates.push({ x: x + gap, y: rect.bottom + margin }, { x: x + gap, y: rect.top - size - margin })
  }
  const positions = candidates.map(bound)
  const awayFromPointer = (point: { x: number, y: number }) => point.x >= x + gap || point.x + size <= x - gap
    || point.y >= y + gap || point.y + size <= y - gap
  return positions.find((point) => awayFromPointer(point) && (!rect || point.x >= rect.right || point.x + size <= rect.left
    || point.y >= rect.bottom || point.y + size <= rect.top)) ?? positions.find(awayFromPointer) ?? positions[0]
}

// Selection is only a candidate. The saved snapshot is consumed by an explicit click.
export const createSelectionTrigger = (
  open: (text: string, anchor: SelectionAnchor) => void,
  state = createSelectionTriggerState(),
) => {
  let snapshot: { text: string, anchor: SelectionAnchor } | null = null
  let disposed = false

  const close = () => {
    state.visible = false
    snapshot = null
  }

  const show = (text: string, anchor: SelectionAnchor, width: number, height: number) => {
    if (disposed) return
    close()
    const normalized = text.trim()
    if (!normalized || Array.from(normalized).length > AI_MAX_INPUT_LENGTH) return
    snapshot = {
      text: normalized,
      anchor: { ...anchor, selectionBounds: anchor.selectionBounds ? { ...anchor.selectionBounds } : undefined },
    }
    Object.assign(state, placeSelectionTrigger(anchor, width, height))
    state.visible = true
  }

  const activate = (event?: Pick<Event, 'isTrusted'>) => {
    if (disposed || !event?.isTrusted || !state.visible || !snapshot) return
    const selected = snapshot
    close()
    open(selected.text, selected.anchor)
  }

  const dispose = () => {
    disposed = true
    close()
  }

  return { state, show, activate, close, dispose }
}
