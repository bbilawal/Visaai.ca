import { getTranslations } from 'next-intl/server'
import { getOpsMetrics, getFailedDeliveries } from '@/lib/api/admin-notif-ops'
import { NotifOpsScreen } from './notif-ops-client'
import type { NotificationOpsRange } from '@visaai/types'

function coerceRange(v: string | string[] | undefined): NotificationOpsRange {
  if (v === '24h' || v === '30d') return v
  return '7d'
}

export default async function NotificationOpsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>
}) {
  const range = coerceRange((await searchParams).range)

  const [metrics, failedPage, t] = await Promise.all([
    getOpsMetrics(range),
    getFailedDeliveries(),
    getTranslations('adminNotifOps'),
  ])

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section>
        <h1 className="type-h2" style={{ marginBottom: 16 }}>
          {t('title')}
        </h1>
        <NotifOpsScreen metrics={metrics} failedPage={failedPage} range={range} />
      </section>
    </div>
  )
}
