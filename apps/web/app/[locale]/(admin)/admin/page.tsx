import { getTranslations } from 'next-intl/server'
import { getAdminDashboard } from '@/lib/api/admin'
import { DashboardShell } from '@/components/admin/dashboard-shell'
import type { DashboardRange } from '@visaai/types'

function coerceRange(v: string | string[] | undefined): DashboardRange {
  return v === '7d' || v === '90d' ? v : '30d'
}

export default async function AdminDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string | string[] }>
}) {
  const range = coerceRange((await searchParams).range)
  const [data, t] = await Promise.all([
    getAdminDashboard(range),
    getTranslations('adminDashboard'),
  ])
  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section>
        <h1 className="type-h2" style={{ marginBottom: 16 }}>{t('title')}</h1>
        <DashboardShell
          data={data}
          range={range}
          cardLabels={{
            users: t('users'),
            consultants: t('consultants'),
            inProgress: t('inProgress'),
            aiTokens: t('aiTokens'),
            revenue: t('revenue'),
            logins: t('logins'),
            lockouts: t('lockouts'),
            notAvailable: t('notAvailable'),
          }}
          controlLabels={{
            r7: t('range7d'),
            r30: t('range30d'),
            r90: t('range90d'),
            widgets: t('widgets'),
            rangeLabel: t('rangeLabel'),
          }}
        />
      </section>
    </div>
  )
}
