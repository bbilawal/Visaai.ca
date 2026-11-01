import type { MetricResult } from '@visaai/types'
import { Card } from '@/components/ui/card'
import { MetricTile } from './metric-tile'

const DOMAIN_HREF: Record<string, string> = {
  financial: '/analytics/financial',
  growth: '/analytics/executive',
  retention: '/analytics/financial',
  visa: '/analytics/visa',
  consultant: '/analytics/consultant',
  ai: '/analytics/ai',
  journey: '/analytics/journey',
}

export function ExecutiveDashboard({
  summary,
  labels,
}: {
  summary: Record<string, MetricResult | { error: string }>
  labels: Record<string, string>
}) {
  return (
    <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {Object.entries(summary).map(([key, r]) =>
        'error' in r ? (
          <Card key={key}>
            <span className="text-muted text-sm">{labels[key] ?? key}</span>
            <p className="text-sm">unavailable</p>
          </Card>
        ) : (
          <MetricTile key={key} label={labels[key] ?? key} result={r} href={DOMAIN_HREF[key]} />
        ),
      )}
    </div>
  )
}
