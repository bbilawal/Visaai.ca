import type { MetricResult } from '@visaai/types'
import { Card } from '@/components/ui/card'
import { Link } from '@/i18n/navigation'
import { formatMetricValue } from '@/lib/analytics/format'
import { DeltaBadge } from './delta-badge'
import { StaleBadge } from './stale-badge'
import { Sparkline } from './charts/sparkline'

export function MetricTile({ label, result, href }: { label: string; result: MetricResult; href?: string }) {
  const body = (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-muted text-sm">{label}</span>
        <StaleBadge stale={result.meta.stale} />
      </div>
      <div className="text-2xl font-semibold mt-1">{formatMetricValue(result.total, result.unit)}</div>
      <div className="flex items-center justify-between mt-2">
        <DeltaBadge delta={result.delta} />
        <Sparkline series={result.series} />
      </div>
    </Card>
  )
  return href ? (
    <Link href={href} className="block">
      {body}
    </Link>
  ) : (
    body
  )
}
