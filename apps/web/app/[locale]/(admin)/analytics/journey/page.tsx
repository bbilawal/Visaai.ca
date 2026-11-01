import { getTranslations } from 'next-intl/server'
import { fetchMetric } from '@/lib/api/analytics'
import { JourneyDashboard } from '@/components/analytics/journey-dashboard'

export default async function JourneyPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const to = sp.to ?? new Date().toISOString().slice(0, 10)
  const from =
    sp.from ??
    (() => {
      const d = new Date()
      d.setUTCMonth(d.getUTCMonth() - 1)
      return d.toISOString().slice(0, 10)
    })()
  const base = { from, to, grain: (sp.grain as any) ?? 'month' }
  const activation = await fetchMetric('journey', { ...base, metric: 'activation_funnel' }).catch((e) => ({ error: e.message }))
  const t = await getTranslations('analytics')
  return <JourneyDashboard activation={activation as any} labels={{ activation: t('kpi.activationFunnel'), degraded: t('note.degraded') }} />
}
