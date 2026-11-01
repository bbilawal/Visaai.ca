'use client'
import type { DashboardRange } from '@visaai/types'

export interface DashboardControlsLabels {
  r7: string
  r30: string
  r90: string
  widgets: string
  /** Accessible name for the date-range button group. */
  rangeLabel: string
}

const RANGES: { value: DashboardRange; key: keyof DashboardControlsLabels }[] = [
  { value: '7d', key: 'r7' },
  { value: '30d', key: 'r30' },
  { value: '90d', key: 'r90' },
]

/**
 * Presentational admin-dashboard controls: a date-range selector and a set of
 * widget-visibility checkboxes. Stateless — the parent owns `range`/`widgets`
 * and the persistence/navigation side effects.
 */
export function DashboardControls({
  range,
  onRangeChange,
  widgets,
  widgetLabels,
  onToggleWidget,
  labels,
}: {
  range: DashboardRange
  onRangeChange: (r: DashboardRange) => void
  widgets: Record<string, boolean>
  /** Translated display name per widget key — the SAME strings the cards use. */
  widgetLabels: Record<string, string>
  onToggleWidget: (key: string) => void
  labels: DashboardControlsLabels
}) {
  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
      <div role="group" aria-label={labels.rangeLabel} style={{ display: 'flex', gap: 8 }}>
        {RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            aria-pressed={range === r.value}
            onClick={() => onRangeChange(r.value)}
            className="mono"
          >
            {labels[r.key]}
          </button>
        ))}
      </div>
      <fieldset style={{ display: 'flex', gap: 8, border: 0, margin: 0, padding: 0 }}>
        <legend className="mono text-muted" style={{ fontSize: '0.72rem' }}>
          {labels.widgets}
        </legend>
        {/* UI-001: this rendered the raw widget key, so a production admin saw
            the camelCase internals — "inProgress", "aiTokens" — next to the
            translated card they toggle ("Applications in progress", "AI
            tokens"), and `aria-label={key}` announced the same to screen
            readers in English regardless of locale. The translated strings
            already reach this component's sibling as `cardLabels`; they are
            passed through here now. Falls back to the key so a widget added
            without a matching label still renders something. */}
        {Object.keys(widgets).map((key) => {
          const label = widgetLabels[key] ?? key
          return (
            <label key={key} style={{ display: 'inline-flex', gap: 4, fontSize: '0.8rem' }}>
              <input
                type="checkbox"
                checked={widgets[key]}
                onChange={() => onToggleWidget(key)}
              />
              {label}
            </label>
          )
        })}
      </fieldset>
    </div>
  )
}
