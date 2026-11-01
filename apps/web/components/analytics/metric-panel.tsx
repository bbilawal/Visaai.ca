import type { MetricResult } from '@visaai/types'
import { Card, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'

export function MetricPanel({
  title,
  result,
  children,
}: {
  title: string
  result: MetricResult | { error: string }
  children: (r: MetricResult) => React.ReactNode
}) {
  if ('error' in result) {
    return (
      <Card>
        <CardTitle>{title}</CardTitle>
        <p style={{ color: 'var(--color-rose, #b53030)' }}>{result.error}</p>
      </Card>
    )
  }
  const empty = result.total === 0 && result.series.every((s) => s.value === 0)
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {empty ? <EmptyState title="No data yet" /> : children(result)}
    </Card>
  )
}
