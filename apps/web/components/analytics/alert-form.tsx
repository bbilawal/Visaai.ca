'use client'
import { useState } from 'react'

type Row = { kind: 'total' | 'delta_pct'; op: string; value: string }

export function AlertForm({
  catalog,
  onSubmit,
}: {
  catalog: { key: string; supportedFilters: string[] }[]
  onSubmit: (body: any) => void
}) {
  const [name, setName] = useState('')
  const [metricKey, setMetricKey] = useState(catalog[0]?.key ?? 'financial')
  const [metric, setMetric] = useState('mrr_trend')
  const [combine, setCombine] = useState<'all' | 'any'>('all')
  const [rows, setRows] = useState<Row[]>([{ kind: 'total', op: 'lt', value: '' }])

  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  return (
    <div className="p-4 border rounded flex flex-col gap-2" aria-label="Alert form">
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
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2">
          <select aria-label={`target ${i}`} value={r.kind} onChange={(e) => setRow(i, { kind: e.target.value as any })}>
            <option value="total">total</option>
            <option value="delta_pct">delta_pct</option>
          </select>
          <select aria-label={`op ${i}`} value={r.op} onChange={(e) => setRow(i, { op: e.target.value })}>
            {['gt', 'lt', 'gte', 'lte', 'eq'].map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          <input
            aria-label={i === 0 ? 'value' : `value ${i}`}
            value={r.value}
            onChange={(e) => setRow(i, { value: e.target.value })}
          />
          {rows.length > 1 && (
            <button type="button" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
              x
            </button>
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" onClick={() => setRows((rs) => [...rs, { kind: 'total', op: 'lt', value: '' }])}>
          Add condition
        </button>
        <select aria-label="combine" value={combine} onChange={(e) => setCombine(e.target.value as any)}>
          <option value="all">all</option>
          <option value="any">any</option>
        </select>
      </div>
      <button
        type="button"
        onClick={() =>
          onSubmit({
            name,
            metricKey,
            metric,
            combine,
            query: { rangePreset: 'mtd', grain: 'day' },
            conditions: rows.map((r) => ({ target: { kind: r.kind }, op: r.op, value: Number(r.value) })),
          })
        }
      >
        Save alert
      </button>
    </div>
  )
}
