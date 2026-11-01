export function FunnelChart({
  steps,
  ariaLabel,
}: {
  steps: { step: string; entered: number; converted: number; rate: number }[]
  ariaLabel?: string
}) {
  const max = Math.max(...steps.map((s) => s.converted), 1)
  return (
    <div className="w-full" role="group" aria-label={ariaLabel}>
      {steps.map((s) => (
        <div key={s.step} className="mb-2">
          <div className="flex justify-between text-sm">
            <span>{s.step}</span>
            <span className="text-muted">
              {s.converted} · {(s.rate * 100).toFixed(0)}%
            </span>
          </div>
          <div className="h-3" style={{ background: 'var(--color-hairline-2, rgba(0,0,0,.15))' }}>
            <div
              className="h-3"
              style={{ width: `${(s.converted / max) * 100}%`, background: 'var(--color-atmosphere-wash, #cfdaf5)' }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
