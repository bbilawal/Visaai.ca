import { serverApi } from '@/lib/api/server'
import { AlertsList } from '@/components/analytics/alerts-list'
import type { AlertRule } from '@/lib/api/alerts-client'

export default async function AlertsPage() {
  const [rules, catalog] = await Promise.all([
    serverApi<AlertRule[]>('/analytics/alerts').catch(() => [] as AlertRule[]),
    serverApi<{ key: string; supportedFilters: string[] }[]>('/analytics/catalog').catch(() => []),
  ])
  return <AlertsList initial={rules} catalog={catalog} />
}
