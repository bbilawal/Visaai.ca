export function DeltaBadge({ delta }: { delta?: { baseline: number; pct: number } | null }) {
  if (!delta) return null
  const up = delta.pct >= 0
  const color = up ? 'var(--color-emerald, #1a6b40)' : 'var(--color-rose, #b53030)'
  return (
    <span style={{ color }} className="text-sm font-medium">
      {up ? '+' : ''}
      {(delta.pct * 100).toFixed(1)}%
    </span>
  )
}
