import type { MetricResult } from '@visaai/types'
import { MetricPanel } from './metric-panel'
import { LineChart } from './charts/line-chart'

export function RunSnapshot({ result, title }: { result: MetricResult | null; title: string }) {
  if (!result) return <p>No snapshot available.</p>
  return (
    <MetricPanel title={title} result={result}>
      {(r) => <LineChart series={r.series} ariaLabel={title} />}
    </MetricPanel>
  )
}
