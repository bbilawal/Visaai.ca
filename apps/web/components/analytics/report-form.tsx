'use client'
import { useState } from 'react'

export function ReportForm({
  catalog,
  onCreate,
}: {
  catalog: { key: string; supportedFilters: string[] }[]
  onCreate: (body: { name: string; metricKey: string; metric: string; query: unknown }) => void
}) {
  const [name, setName] = useState('')
  const [metricKey, setMetricKey] = useState(catalog[0]?.key ?? 'financial')
  const [metric, setMetric] = useState('mrr_trend')
  const [preset, setPreset] = useState('mtd')
  return (
    <div className="p-4 border rounded flex flex-wrap gap-2 items-end" aria-label="New report">
      <label>
        Name <input aria-label="name" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Metric{' '}
        <select aria-label="metric key" value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
          {catalog.map((c) => (
            <option key={c.key} value={c.key}>
              {c.key}
            </option>
          ))}
        </select>
      </label>
      <label>
        Sub-metric <input aria-label="sub metric" value={metric} onChange={(e) => setMetric(e.target.value)} />
      </label>
      <label>
        Range{' '}
        <select aria-label="range preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {['last_7d', 'last_30d', 'mtd', 'wtd', 'last_quarter'].map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        onClick={() => onCreate({ name, metricKey, metric, query: { rangePreset: preset, grain: 'day' } })}
      >
        Create report
      </button>
    </div>
  )
}
