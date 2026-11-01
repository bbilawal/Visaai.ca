export function BarChart({ data, ariaLabel }: { data: { key: string; value: number }[]; ariaLabel?: string }) {
  const rows = [...data].sort((a, b) => b.value - a.value)
  const max = Math.max(...rows.map((r) => r.value), 1)
  const rowH = 28
  const gap = 6
  const w = 600
  const h = rows.length * (rowH + gap)
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={ariaLabel} className="w-full" style={{ height: h }}>
        {rows.map((r, i) => {
          const bw = (r.value / max) * (w - 160)
          const y = i * (rowH + gap)
          return (
            <g key={r.key}>
              <text x={0} y={y + rowH / 2 + 4} fontSize={12} fill="var(--color-pale-stone, #4e4d4d)">
                {r.key}
              </text>
              <rect x={120} y={y} width={Math.max(bw, 1)} height={rowH} fill="var(--color-atmosphere-wash, #cfdaf5)" />
              <text x={124 + bw} y={y + rowH / 2 + 4} fontSize={12} fill="var(--color-ink, #000)">
                {r.value}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
