import type { MetricResult } from '@visaai/types'
import { MetricPanel } from './metric-panel'
import { MetricTile } from './metric-tile'
import { LineChart } from './charts/line-chart'
import { BarChart } from './charts/bar-chart'

type R = MetricResult | { error: string }
export function ConsultantDashboard({
  takeRate,
  payout,
  leaderboard,
  labels,
}: {
  takeRate: R
  payout: R
  leaderboard: R
  labels: Record<string, string>
  query?: any
}) {
  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {!('error' in takeRate) && <MetricTile label={labels.takeRate} result={takeRate} />}
      <MetricPanel title={labels.payout} result={payout}>
        {(r) => <LineChart series={r.series} ariaLabel={labels.payout} />}
      </MetricPanel>
      <MetricPanel title={labels.leaderboard} result={leaderboard}>
        {(r) => <BarChart data={r.byDimension ?? []} ariaLabel={labels.leaderboard} />}
      </MetricPanel>
      <p className="text-xs text-muted col-span-full">{labels.cor1}</p>
    </div>
  )
}
