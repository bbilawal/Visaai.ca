import { serverApi } from '@/lib/api/server'
import { RunSnapshot } from '@/components/analytics/run-snapshot'

export default async function RunPage({ params }: { params: Promise<{ id: string; runId: string }> }) {
  const { id, runId } = await params
  const runs = await serverApi<any[]>(`/analytics/reports/${id}/runs`).catch(() => [])
  const run = runs.find((r) => r.id === runId)
  return <RunSnapshot result={run?.resultSnapshot ?? null} title={run ? `Run ${runId.slice(0, 8)}` : 'Run'} />
}
