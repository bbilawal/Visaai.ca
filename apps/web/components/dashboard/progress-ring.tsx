interface ProgressRingProps {
  pct: number
  size?: number
  stroke?: number
}

export function ProgressRing({ pct, size = 44, stroke = 4 }: ProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, pct))
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (clamped / 100) * c

  return (
    <span className="progress-ring" role="img" aria-label={`${clamped}% complete`}>
      <svg width={size} height={size}>
        <circle className="progress-ring__track" cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" />
        <circle
          className="progress-ring__fill"
          cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span className="progress-ring__label">{clamped}%</span>
    </span>
  )
}
