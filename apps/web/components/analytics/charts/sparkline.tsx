type Pt = { bucket: string; value: number }

export function Sparkline({ series }: { series: Pt[] }) {
  if (series.length === 0) return null
  const w = 100
  const h = 24
  const pad = 2
  const max = Math.max(...series.map((s) => s.value), 1)
  const min = Math.min(...series.map((s) => s.value), 0)
  const span = max - min || 1
  const xs = (i: number) => (series.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (series.length - 1))
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad)
  const d = series.map((s, i) => `${i === 0 ? 'M' : 'L'}${xs(i).toFixed(1)},${y(s.value).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-24" aria-hidden preserveAspectRatio="none">
      <path d={d} fill="none" stroke="var(--color-pale-stone, #4e4d4d)" strokeWidth={1.5} />
    </svg>
  )
}
