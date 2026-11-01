export function AlertStateBadge({ state }: { state: 'ok' | 'breached' }) {
  const breached = state === 'breached'
  const color = breached ? 'var(--color-rose, #b53030)' : 'var(--color-emerald, #1a6b40)'
  return (
    <span className="text-xs px-2 py-0.5 rounded" style={{ color, border: `1px solid ${color}` }}>
      {state}
    </span>
  )
}
