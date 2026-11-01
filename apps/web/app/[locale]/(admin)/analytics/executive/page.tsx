import { getTranslations } from 'next-intl/server'
import { fetchSummary } from '@/lib/api/analytics'
import { ExecutiveDashboard } from '@/components/analytics/executive-dashboard'

function defaultRange() {
  const to = new Date()
  const from = new Date()
  from.setUTCDate(to.getUTCDate() - 29)
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), grain: 'day' as const }
}

export default async function ExecutivePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const dflt = defaultRange()
  const range = { from: sp.from ?? dflt.from, to: sp.to ?? dflt.to, grain: (sp.grain as any) ?? 'day' }
  const summary = await fetchSummary(range)
  const t = await getTranslations('analytics')
  const labels = {
    financial: t('kpi.mrr'),
    growth: t('kpi.dau'),
    retention: t('kpi.churn'),
    visa: t('kpi.approval'),
    consultant: t('kpi.takeRate'),
    ai: t('kpi.aiCost'),
    journey: t('kpi.activation'),
  }
  return <ExecutiveDashboard summary={summary} labels={labels} />
}
