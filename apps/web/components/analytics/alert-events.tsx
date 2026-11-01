export function AlertEvents({
  events,
}: {
  events: { id: string; kind: 'breach' | 'recovery'; message: string; firedAt: string }[]
}) {
  if (events.length === 0) return <p className="text-muted text-sm">No alerts fired yet.</p>
  return (
    <ul className="grid gap-1 text-sm">
      {events.map((e) => (
        <li key={e.id}>
          <span className="text-muted">{new Date(e.firedAt).toLocaleString()}</span> — {e.message}
        </li>
      ))}
    </ul>
  )
}
