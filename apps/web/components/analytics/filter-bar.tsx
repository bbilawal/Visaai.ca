'use client'
type Val = { from: string; to: string; grain: string }
export function FilterBar({
  value,
  grains = ['day', 'week', 'month'],
  onChange,
}: {
  value: Val
  grains?: string[]
  onChange: (next: Val) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mb-4">
      <input
        type="date"
        value={value.from}
        onChange={(e) => onChange({ ...value, from: e.target.value })}
        aria-label="From"
      />
      <input
        type="date"
        value={value.to}
        onChange={(e) => onChange({ ...value, to: e.target.value })}
        aria-label="To"
      />
      <div role="group" aria-label="Grain" className="flex gap-1">
        {grains.map((g) => (
          <button
            key={g}
            type="button"
            aria-pressed={value.grain === g}
            onClick={() => onChange({ ...value, grain: g })}
            className={value.grain === g ? 'font-semibold underline' : ''}
          >
            {g}
          </button>
        ))}
      </div>
    </div>
  )
}
