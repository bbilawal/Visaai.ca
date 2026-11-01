import { useCallback, useEffect, type Dispatch, type KeyboardEvent, type RefObject, type SetStateAction } from 'react'

/**
 * The WAI-ARIA 1.2 editable-combobox keyboard contract, in one place.
 *
 * DUP-002: `country-combobox` and `searchable-select` each hand-rolled this —
 * 21 duplicated blocks covering wrap-around arrow navigation, Home/End, Enter,
 * Escape, Tab, `aria-activedescendant` and scroll-into-view. The two copies
 * were identical line for line apart from Escape. That is the dangerous kind of
 * duplication: a keyboard fix applied to one silently leaves the other broken,
 * and neither was canonical.
 *
 * The COMPONENTS are deliberately NOT merged. They render different things —
 * country flags and Schengen grouping versus generic options — and collapsing
 * them would produce exactly the oversized shared component the audit spec
 * warns against. Only the behaviour is shared.
 *
 * `activeIndex` stays OWNED BY THE CALLER. Each component already clears it in
 * its own `openList` / `closeList` / `selectOption`, and moving that here would
 * mean the hook needed those callbacks while they needed the hook's setter — a
 * cycle whose only escape is a reset effect, which is both a `setState` in an
 * effect and a behaviour change. Passing the state pair in keeps this hook pure
 * behaviour and leaves every existing reset exactly where it was.
 */
export interface UseComboboxOptions {
  /** Whether the popup is currently open. */
  open: boolean
  /** Number of options currently rendered (post-filter). */
  count: number
  activeIndex: number
  setActiveIndex: Dispatch<SetStateAction<number>>
  /** Stable DOM id for the option at `index` — used for aria-activedescendant. */
  optionId: (index: number) => string
  /** The element with role="listbox", so the active option can be scrolled into view. */
  listboxRef: RefObject<HTMLElement | null>
  openList: () => void
  closeList: () => void
  /** Commit the option at `index`. */
  onSelect: (index: number) => void
  /**
   * Escape pressed while the popup is ALREADY closed. `country-combobox` uses
   * this for its second-Escape-clears-selection step; `searchable-select` has
   * no such step and omits it.
   */
  onEscapeWhenClosed?: () => void
  disabled?: boolean
}

export function useCombobox({
  open,
  count,
  activeIndex,
  setActiveIndex,
  optionId,
  listboxRef,
  openList,
  closeList,
  onSelect,
  onEscapeWhenClosed,
  disabled = false,
}: UseComboboxOptions) {
  // Keep the active option visible as the user arrows past the fold.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const node = listboxRef.current?.querySelector<HTMLElement>(
      `#${CSS.escape(optionId(activeIndex))}`,
    )
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, optionId, listboxRef])

  /** Move by `delta`, wrapping at both ends (ARIA 1.2 for an open listbox). */
  const moveActive = useCallback(
    (delta: number) => {
      if (count === 0) return
      setActiveIndex((prev) => {
        const start = prev === -1 ? (delta > 0 ? -1 : 0) : prev
        let next = start + delta
        if (next < 0) next = count - 1
        if (next > count - 1) next = 0
        return next
      })
    },
    [count, setActiveIndex],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (disabled) return
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          if (!open) {
            openList()
            setActiveIndex(count > 0 ? 0 : -1)
          } else {
            moveActive(1)
          }
          break
        case 'ArrowUp':
          e.preventDefault()
          if (!open) {
            openList()
            setActiveIndex(count > 0 ? count - 1 : -1)
          } else {
            moveActive(-1)
          }
          break
        case 'Home':
          if (open && count > 0) {
            e.preventDefault()
            setActiveIndex(0)
          }
          break
        case 'End':
          if (open && count > 0) {
            e.preventDefault()
            setActiveIndex(count - 1)
          }
          break
        case 'Enter':
          if (open && activeIndex >= 0) {
            e.preventDefault()
            onSelect(activeIndex)
          }
          break
        case 'Escape':
          e.preventDefault()
          if (open) closeList()
          else onEscapeWhenClosed?.()
          break
        case 'Tab':
          // Never trap focus: let it move, just close the popup.
          if (open) closeList()
          break
        default:
          break
      }
    },
    [
      disabled,
      open,
      count,
      activeIndex,
      moveActive,
      openList,
      closeList,
      onSelect,
      onEscapeWhenClosed,
      setActiveIndex,
    ],
  )

  const activeDescendant = open && activeIndex >= 0 ? optionId(activeIndex) : undefined

  return { moveActive, handleKeyDown, activeDescendant }
}
