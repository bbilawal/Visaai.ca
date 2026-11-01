import type { MetricResult } from '@visaai/types'
import { MetricPanel } from './metric-panel'
import { MetricTile } from './metric-tile'
import { LineChart } from './charts/line-chart'
import { ExportButton } from './export-button'

type R = MetricResult | { error: string }
export function FinancialDashboard({
  mrr,
  revenue,
  churn,
  margin,
  ltv,
  query,
  labels,
}: {
  mrr: R
  revenue: R
  churn: R
  margin: R
  ltv: R
  query: any
  labels: Record<string, string>
}) {
  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      <MetricPanel title={labels.mrr} result={mrr}>
        {(r) => (
          <>
            <LineChart series={r.series} ariaLabel={labels.mrr} />
            <ExportButton metricKey="financial" query={{ ...query, metric: 'mrr_trend' }} />
          </>
        )}
      </MetricPanel>
      <MetricPanel title={labels.revenue} result={revenue}>
        {(r) => (
          <>
            <LineChart series={r.series} ariaLabel={labels.revenue} />
            <ExportButton metricKey="financial" query={{ ...query, metric: 'revenue' }} />
          </>
        )}
      </MetricPanel>
      <MetricPanel title={labels.churn} result={churn}>
        {(r) => <LineChart series={r.series} ariaLabel={labels.churn} />}
      </MetricPanel>
      <div className="grid grid-cols-2 gap-4">
        {'error' in margin ? null : <MetricTile label={labels.margin} result={margin} />}
        {'error' in ltv ? null : <MetricTile label={labels.ltv} result={ltv} />}
      </div>
    </div>
  )
}
