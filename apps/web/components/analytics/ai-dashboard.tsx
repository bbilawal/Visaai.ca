import type { MetricResult } from '@visaai/types'
import { MetricPanel } from './metric-panel'
import { MetricTile } from './metric-tile'
import { LineChart } from './charts/line-chart'
import { ExportButton } from './export-button'

type R = MetricResult | { error: string }
export function AiDashboard({ cost, labels, query }: { cost: R; labels: Record<string, string>; query: any }) {
  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {!('error' in cost) && <MetricTile label={labels.cost} result={cost} />}
      <MetricPanel title={labels.cost} result={cost}>
        {(r) => (
          <>
            <LineChart series={r.series} ariaLabel={labels.cost} />
            <ExportButton metricKey="ai" query={query} />
          </>
        )}
      </MetricPanel>
    </div>
  )
}
