import { getTranslations } from 'next-intl/server'
import { fetchMetric } from '@/lib/api/analytics'
import { VisaDashboard } from '@/components/analytics/visa-dashboard'

export default async function VisaPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const to = sp.to ?? new Date().toISOString().slice(0, 10)
  const from =
    sp.from ??
    (() => {
      const d = new Date()
      d.setUTCMonth(d.getUTCMonth() - 3)
      return d.toISOString().slice(0, 10)
    })()
  const base = { from, to, grain: (sp.grain as any) ?? 'month' }
  const [approval, application] = await Promise.all([
    fetchMetric('visa', { ...base, metric: 'approval_funnel' }).catch((e) => ({ error: e.message })),
    fetchMetric('visa', { ...base, metric: 'application_funnel' }).catch((e) => ({ error: e.message })),
  ])
  const t = await getTranslations('analytics')
  return (
    <VisaDashboard
      approval={approval as any}
      application={application as any}
      labels={{ approval: t('kpi.approvalFunnel'), application: t('kpi.applicationFunnel') }}
    />
  )
}
