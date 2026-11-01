import { serverApi } from '@/lib/api/server'
import { ReportsList } from '@/components/analytics/reports-list'
import type { SavedReport } from '@/lib/api/analytics-client'

export default async function ReportsPage() {
  const [reports, catalog] = await Promise.all([
    serverApi<SavedReport[]>('/analytics/reports').catch(() => [] as SavedReport[]),
    serverApi<{ key: string; supportedFilters: string[] }[]>('/analytics/catalog').catch(() => []),
  ])
  return <ReportsList initial={reports} catalog={catalog} />
}
