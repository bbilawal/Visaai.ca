export function presetToCron({
  freq,
  day,
  time,
}: {
  freq: 'daily' | 'weekly' | 'monthly'
  day?: number
  time: string
}): string {
  const [h, m] = time.split(':').map((n) => parseInt(n, 10))
  if (freq === 'daily') return `${m} ${h} * * *`
  if (freq === 'weekly') return `${m} ${h} * * ${day ?? 1}`
  return `${m} ${h} ${day ?? 1} * *`
}
