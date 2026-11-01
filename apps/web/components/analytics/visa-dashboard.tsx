import type { MetricResult } from '@visaai/types'
import { MetricPanel } from './metric-panel'
import { FunnelChart } from './charts/funnel-chart'

type R = MetricResult | { error: string }
type Steps = { steps: { step: string; entered: number; converted: number; rate: number }[] }

export function VisaDashboard({
  approval,
  application,
  labels,
}: {
  approval: R
  application: R
  labels: Record<string, string>
}) {
  const panel = (title: string, r: R) => (
    <MetricPanel title={title} result={r}>
      {(res) => <FunnelChart steps={(res.extra as Steps)?.steps ?? []} ariaLabel={title} />}
    </MetricPanel>
  )
  return (
    <div className="grid gap-4 grid-cols-1 lg:grid-cols-2">
      {panel(labels.approval, approval)}
      {panel(labels.application, application)}
    </div>
  )
}
