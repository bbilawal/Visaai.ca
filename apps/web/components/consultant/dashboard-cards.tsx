import { Card } from '@/components/ui/card'
import type { ConsultantDashboard } from '@visaai/types'

export interface DashboardLabels {
  assigned: string
  newRequests: string
  awaitingReview: string
  highPriority: string
  today: string
  week: string
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <div className="mono text-muted" style={{ fontSize: '0.72rem' }}>{label}</div>
      <div className="type-h2" style={{ marginTop: 4 }}>{value}</div>
    </Card>
  )
}

/** Pure presentational dashboard grid — data + already-translated labels in. */
export function DashboardCards({
  data,
  labels,
}: {
  data: ConsultantDashboard
  labels: DashboardLabels
}) {
  const { counts, workload } = data
  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
      }}
    >
      <Stat label={labels.assigned} value={counts.assigned} />
      <Stat label={labels.newRequests} value={counts.newRequests} />
      <Stat label={labels.awaitingReview} value={counts.awaitingReview} />
      <Stat label={labels.highPriority} value={counts.highPriority} />
      <Stat label={labels.today} value={workload.today} />
      <Stat label={labels.week} value={workload.week} />
    </div>
  )
}
