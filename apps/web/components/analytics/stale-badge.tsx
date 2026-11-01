export function StaleBadge({ stale }: { stale?: boolean }) {
  if (!stale) return null
  return (
    <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--color-hairline-2, rgba(0,0,0,.15))' }}>
      stale
    </span>
  )
}
