'use client'

import { Fragment, useCallback, useId, useMemo, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { useCombobox } from './use-combobox'
import { CountryFlag } from '@/components/ui/country-flag'
import type {
  CountryGroup,
  SupportedCountry,
} from '@/lib/use-supported-countries'

// Display order + labels for the picker groups. Priority is pinned with NO
// header (the four launch corridors sit at the very top). Order here only
// affects visual section order; within each section the API already ordered
// the items (priority fixed; schengen/other alphabetical).
const GROUP_ORDER: readonly CountryGroup[] = ['priority', 'schengen', 'other']
/**
 * Message key per group, or null for the pinned corridors which show no header.
 *
 * These were hardcoded English and rendered as such on every translated page —
 * an Urdu form with "SCHENGEN COUNTRIES" above the list. The names themselves
 * had the same problem and are fixed in `lib/localize-country-name.ts`.
 */
const GROUP_LABEL_KEYS: Record<CountryGroup, string | null> = {
  priority: null,
  schengen: 'countryGroupSchengen',
  other: 'countryGroupOther',
}

export interface CountryComboboxProps {
  /** Selected country ISO code (e.g. 'DE'), or null when nothing is chosen. */
  value: string | null
  /** Fires with the canonical country code (or null when cleared). */
  onChange: (code: string | null) => void
  /** Supported countries, already name-sorted by the hook. */
  countries: SupportedCountry[]
  /** Hook loading flag — disables input and announces a busy state. */
  loading?: boolean
  /** Hook error string — renders inline and wires aria-describedby/aria-invalid. */
  error?: string | null
  /** Input id (label association + form wiring). */
  id: string
  /** Form field name. */
  name?: string
  placeholder?: string
  disabled?: boolean
}

/**
 * Accessible, searchable country picker — a single control that replaces the
 * old separate search <Input> + native <select>.
 *
 * Implements the WAI-ARIA 1.2 "Editable Combobox With List Autocomplete"
 * pattern (hand-rolled; no headless lib is installed in apps/web):
 *   - role="combobox" input with aria-expanded / aria-controls /
 *     aria-activedescendant; listbox role="listbox" with role="option" items
 *     and aria-selected on the chosen one.
 *   - Keyboard: type to filter, ArrowUp/Down to move, Enter to select,
 *     Escape to close (then clear), Home/End to jump, focus stays on the input.
 *   - aria-invalid + aria-describedby wired to the error message.
 *   - Loading announced via aria-busy + a visually-hidden polite status.
 *   - Empty result announces "no matches" (the listbox carries aria-live).
 *   - Visible focus ring inherited from the .input token styles; touch-sized
 *     options; active option shown for both keyboard and pointer (no
 *     hover-only affordance).
 *
 * `value` is the country CODE; the visible text is the matched country NAME.
 */
export function CountryCombobox({
  value,
  onChange,
  countries,
  loading = false,
  error = null,
  id,
  name,
  // Both call sites pass a translated placeholder; this English default is the
  // last resort for a caller that does not, and is deliberately not a message
  // lookup so the component still renders outside an i18n provider in tests.
  placeholder = 'Search destination country…',
  disabled = false,
}: CountryComboboxProps) {
  const t = useTranslations('application')
  const reactId = useId()
  const listboxId = `${id}-listbox`
  const statusId = `${id}-status`
  const errorId = `${id}-error`
  const emptyId = `${id}-empty`

  const inputRef = useRef<HTMLInputElement>(null)
  const listboxRef = useRef<HTMLUListElement>(null)

  const [open, setOpen] = useState(false)
  // `query` is only meaningful while the popup is open (the user is typing). When
  // closed, the input text is DERIVED from the selected country — see
  // `displayValue` below. This avoids syncing state in an effect.
  const [query, setQuery] = useState('')
  // -1 = no active option (none highlighted yet).
  const [activeIndex, setActiveIndex] = useState(-1)

  const selectedCountry = useMemo(
    () => countries.find((c) => c.code === value) ?? null,
    [countries, value],
  )

  // Displayed text: live query while open; the committed selection while closed.
  const displayValue = open ? query : selectedCountry ? selectedCountry.name : ''

  // The query drives filtering only while the user is actively typing/open.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return countries
    return countries.filter(
      (c) =>
        c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q),
    )
  }, [countries, query])

  // Group the visible options into ordered sections, keeping each option's FLAT
  // index into `filtered` so keyboard nav / aria-activedescendant stay correct.
  // Empty groups (e.g. "Other Countries" when none are supported yet) are dropped.
  const sections = useMemo(() => {
    const withIndex = filtered.map((country, index) => ({ country, index }))
    return GROUP_ORDER.map((key) => ({
      key,
      label: GROUP_LABEL_KEYS[key] ? t(GROUP_LABEL_KEYS[key]!) : null,
      items: withIndex.filter(
        (x) => (x.country.group ?? 'other') === key,
      ),
    })).filter((section) => section.items.length > 0)
  }, [filtered, t])

  const isDisabled = disabled || loading || !!error

  const optionId = useCallback(
    (index: number) => `${id}-${reactId}-opt-${index}`,
    [id, reactId],
  )

  const openList = useCallback(() => {
    if (isDisabled || open) return
    // Seed the editable query from the committed selection so the user can
    // refine or clear it; an empty selection opens to the full list.
    setQuery(selectedCountry ? selectedCountry.name : '')
    setActiveIndex(-1)
    setOpen(true)
  }, [isDisabled, open, selectedCountry])

  const closeList = useCallback(() => {
    // displayValue falls back to the committed selection once `open` is false,
    // so no query reset is required here.
    setOpen(false)
    setActiveIndex(-1)
  }, [])

  const selectOption = useCallback(
    (country: SupportedCountry | undefined) => {
      if (!country) return
      onChange(country.code)
      setOpen(false)
      setActiveIndex(-1)
      inputRef.current?.focus()
    },
    [onChange],
  )

  // DUP-002: arrow/Home/End/Enter/Escape/Tab, aria-activedescendant and
  // scroll-into-view come from the shared hook. The second-Escape step below is
  // this component's own — it clears a committed country once the popup is
  // already closed, which searchable-select has no equivalent of.
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
    onEscapeWhenClosed: () => {
      if (value !== null) {
        onChange(null)
        setQuery('')
      }
    },
    disabled: isDisabled,
  })

  function handleInputChange(next: string) {
    setQuery(next)
    setOpen(true)
    setActiveIndex(-1)
    // Typing a fresh query invalidates the current selection until re-picked.
    if (value !== null) onChange(null)
  }

  function handleBlur(e: React.FocusEvent<HTMLDivElement>) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      closeList()
    }
  }


  // Left flag adornment: shown only while the input text IS the committed
  // selection's name (closed, or open-but-untyped). The moment the user types a
  // different query the flag is dropped so it never contradicts the text. Purely
  // visual — decorative (the selected name is in the input) — and outside the
  // input element (an <input> can't contain an <img>), mirroring the right-side
  // chevron affordance. No ARIA/keyboard behavior is touched.
  const showSelectedFlag =
    !!selectedCountry && displayValue === selectedCountry.name

  const showEmpty =
    open && !loading && !error && query.trim() !== '' && filtered.length === 0

  const describedBy =
    [error ? errorId : null, showEmpty ? emptyId : null]
      .filter(Boolean)
      .join(' ') || undefined

  return (
    <div
      className="combobox"
      data-open={open}
      data-has-flag={showSelectedFlag || undefined}
      onBlur={handleBlur}
    >
      {/* Left flag adornment for the committed selection. aria-hidden +
          pointer-events:none so a tap still lands on the input. */}
      {showSelectedFlag && (
        <span className="combobox__flag" aria-hidden="true">
          <CountryFlag code={selectedCountry.code} name={selectedCountry.name} size="sm" />
        </span>
      )}
      {/*
        WAI-ARIA 1.2: the input itself is role="combobox" (the older 1.0
        wrapper pattern is deprecated). aria-controls points at the listbox.
      */}
      <input
        ref={inputRef}
        id={id}
        name={name}
        type="text"
        role="combobox"
        className={cn('input', 'combobox__input')}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        // role="combobox" with a popup listbox uses aria-expanded, never
        // aria-haspopup="menu"; "listbox" is the correct popup kind.
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={activeDescendant}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        aria-busy={loading || undefined}
        placeholder={loading ? t('loadingCountries') : placeholder}
        value={displayValue}
        disabled={isDisabled}
        onChange={(e) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={openList}
        onClick={openList}
      />

      <span className="combobox__affordance" aria-hidden="true">
        {loading ? (
          <span className="combobox__spinner" />
        ) : (
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
        )}
      </span>

      {open && !error && filtered.length > 0 && (
        <ul
          ref={listboxRef}
          id={listboxId}
          role="listbox"
          className="combobox__listbox"
          aria-label={t('countryListLabel')}
        >
          {sections.map((section) => (
            <Fragment key={section.key}>
              {section.label && (
                // Presentational group header: removed from the listbox's option
                // set (role=presentation + aria-hidden) so it never disrupts
                // option indexing or aria-activedescendant.
                <li
                  role="presentation"
                  aria-hidden="true"
                  className="combobox__group-label"
                >
                  {section.label}
                </li>
              )}
              {section.items.map(({ country, index }) => {
                const isActive = index === activeIndex
                const isSelected = country.code === value
                return (
                  <li
                    key={country.code}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    className={cn(
                      'combobox__option',
                      isActive && 'combobox__option--active',
                    )}
                    // onMouseDown (not onClick) so selection fires before the
                    // input's blur closes the list.
                    onMouseDown={(e) => {
                      e.preventDefault()
                      selectOption(country)
                    }}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="combobox__option-label">
                      {/* Decorative: the country name is the visible text. */}
                      <CountryFlag code={country.code} name={country.name} size="sm" />
                      <span>{country.name}</span>
                    </span>
                    <span className="combobox__option-code">{country.code}</span>
                  </li>
                )
              })}
            </Fragment>
          ))}
        </ul>
      )}

      {showEmpty && (
        <div className="combobox__listbox" aria-hidden="true">
          <p id={emptyId} className="combobox__empty">
            {t('noCountriesMatch', { query: query.trim() })}
          </p>
        </div>
      )}

      {/* Polite live region: announces loading + empty results to screen readers. */}
      <span id={statusId} role="status" aria-live="polite" className="sr-only">
        {loading
          ? t('loadingCountries')
          : showEmpty
            ? t('noCountriesMatch', { query: query.trim() })
            : ''}
      </span>

      {error && (
        <p
          id={errorId}
          className="field-help"
          role="alert"
          style={{ color: 'var(--color-rose)' }}
        >
          {error}
        </p>
      )}
    </div>
  )
}
