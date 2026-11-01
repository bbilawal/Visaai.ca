import type { MetricResult } from '@visaai/types'
import { MetricPanel } from './metric-panel'
import { FunnelChart } from './charts/funnel-chart'

type R = MetricResult | { error: string }
type Steps = { steps: { step: string; entered: number; converted: number; rate: number }[] }

export function JourneyDashboard({ activation, labels }: { activation: R; labels: Record<string, string> }) {
  const degraded = !('error' in activation) && (activation.meta.stale || activation.total === 0)
  return (
    <div className="grid gap-4">
      {degraded && (
        <div className="p-3 rounded text-sm" style={{ background: 'var(--color-atmosphere-wash, #cfdaf5)' }}>
          {labels.degraded}
        </div>
      )}
      <MetricPanel title={labels.activation} result={activation}>
        {(r) => <FunnelChart steps={(r.extra as Steps)?.steps ?? []} ariaLabel={labels.activation} />}
      </MetricPanel>
    </div>
  )
}
