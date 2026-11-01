type Pt = { bucket: string; value: number }

function pathFor(series: Pt[], w: number, h: number, pad = 4): string | null {
  if (series.length === 0) return null
  const xs = series.map((_, i) =>
    series.length === 1 ? w / 2 : pad + (i * (w - 2 * pad)) / (series.length - 1),
  )
  const max = Math.max(...series.map((s) => s.value), 1)
  const min = Math.min(...series.map((s) => s.value), 0)
  const span = max - min || 1
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad)
  return series.map((s, i) => `${i === 0 ? 'M' : 'L'}${xs[i].toFixed(1)},${y(s.value).toFixed(1)}`).join(' ')
}

export function LineChart({ series, ariaLabel }: { series: Pt[]; ariaLabel?: string }) {
  const w = 600
  const h = 180
  const d = pathFor(series, w, h)
  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={ariaLabel}
        className="w-full h-[180px]"
        preserveAspectRatio="none"
      >
        {d && <path d={d} fill="none" stroke="var(--color-ink, #000)" strokeWidth={2} />}
      </svg>
    </div>
  )
}
