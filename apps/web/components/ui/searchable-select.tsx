'use client'

import { useCallback, useId, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { useCombobox } from './use-combobox'

export interface SearchableOption {
  /** Canonical value reported via onChange. */
  value: string
  /** Visible, searchable text. */
  label: string
  /** Optional secondary text shown on the trailing edge (e.g. a code). */
  meta?: string
  /** Optional leading adornment (e.g. a flag). */
  leading?: ReactNode
}

export interface SearchableSelectProps {
  /** Currently selected option value, or null when nothing is chosen. */
  value: string | null
  /** Fires with the picked option value. */
  onChange: (value: string) => void
  options: SearchableOption[]
  /** Input id (label association + form wiring). */
  id: string
  name?: string
  placeholder?: string
  disabled?: boolean
  /** Compact (mono, 0.78rem) styling for inline table controls. */
  compact?: boolean
  /** Accessible name for the input + listbox. */
  ariaLabel?: string
  className?: string
}

/**
 * Generic searchable combobox (type-to-filter). A framework-agnostic sibling of
 * <CountryCombobox> for any { value, label } option list — the consultant
 * picker, the role selector, etc.
 *
 * Implements the WAI-ARIA 1.2 "Editable Combobox With List Autocomplete"
 * pattern (hand-rolled; matches CountryCombobox):
 *   - role="combobox" input with aria-expanded / aria-controls /
 *     aria-activedescendant; listbox role="listbox" with role="option" items
 *     and aria-selected on the chosen one.
 *   - Keyboard: type to filter, ArrowUp/Down to move, Enter to select,
 *     Escape to close, Home/End to jump; focus stays on the input.
 *
 * Reuses the existing .combobox* token styles from globals.css.
 */
export function SearchableSelect({
  value,
  onChange,
  options,
  id,
  name,
  placeholder = 'Search…',
  disabled = false,
  compact = false,
  ariaLabel,
  className,
}: SearchableSelectProps) {
  const reactId = useId()
  const listboxId = `${id}-listbox`
  const emptyId = `${id}-empty`

  const inputRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)

  const [open, setOpen] = useState(false)
  // `query` is only meaningful while the popup is open; closed text is derived
  // from the committed selection (see displayValue).
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value],
  )

  const displayValue = open ? query : selected ? selected.label : ''

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.meta?.toLowerCase().includes(q) ?? false),
    )
  }, [options, query])

  const optionId = useCallback(
    (index: number) => `${id}-${reactId}-opt-${index}`,
    [id, reactId],
  )

  const openList = useCallback(() => {
    if (disabled || open) return
    setQuery(selected ? selected.label : '')
    setActiveIndex(-1)
    setOpen(true)
  }, [disabled, open, selected])

  const closeList = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
  }, [])

  const selectOption = useCallback(
    (option: SearchableOption | undefined) => {
      if (!option) return
      onChange(option.value)
      setOpen(false)
      setActiveIndex(-1)
      inputRef.current?.focus()
    },
    [onChange],
  )

  // DUP-002: arrow/Home/End/Enter/Escape/Tab, aria-activedescendant and
  // scroll-into-view come from the shared hook; this component keeps only what
  // is specific to it.
  const { handleKeyDown, activeDescendant } = useCombobox({
    open,
    count: filtered.length,
    activeIndex,
    setActiveIndex,
    optionId,
    listboxRef,
    openList,
    closeList,
    onSelect: (index) => selectOption(filtered[index]),
    disabled,
  })

  function handleInputChange(next: string) {
    setQuery(next)
    setOpen(true)
    setActiveIndex(-1)
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      closeList()
    }
  }


  const showEmpty =
    open && query.trim() !== '' && filtered.length === 0

  return (
    <div
      className={cn('combobox', className)}
      data-open={open}
      onBlur={handleBlur}
      style={compact ? { display: 'inline-block', minWidth: 200 } : undefined}
    >
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        className={cn('input', 'combobox__input', compact && 'mono')}
        style={compact ? { fontSize: '0.78rem' } : undefined}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        aria-label={ariaLabel}
        placeholder={placeholder}
        value={displayValue}
        disabled={disabled}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={openList}
        onClick={openList}
      />

      <span className="combobox__affordance" aria-hidden="true">
        <svg
          className="combobox__chevron"
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="4,6 8,10 12,6" />
        </svg>
      </span>

      {open && filtered.length > 0 && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="combobox__listbox"
          aria-label={ariaLabel}
        >
          {filtered.map((option, index) => {
            const isActive = index === activeIndex
            const isSelected = option.value === value
            return (
              <li
                key={option.value}
                id={optionId(index)}
                role="option"
                aria-selected={isSelected}
                className={cn(
                  'combobox__option',
                  isActive && 'combobox__option--active',
                )}
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectOption(option)
                }}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <span className="combobox__option-label">
                  {option.leading}
                  <span>{option.label}</span>
                </span>
                {option.meta && (
                  <span className="combobox__option-code">{option.meta}</span>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {showEmpty && (
        <div className="combobox__listbox" aria-hidden="true">
          <p id={emptyId} className="combobox__empty">
            No matches for “{query.trim()}”.
          </p>
        </div>
      )}
    </div>
  )
}
