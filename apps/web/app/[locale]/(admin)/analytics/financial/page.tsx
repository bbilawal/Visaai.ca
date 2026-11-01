import { getTranslations } from 'next-intl/server'
import { fetchMetric } from '@/lib/api/analytics'
import { FinancialDashboard } from '@/components/analytics/financial-dashboard'

export default async function FinancialPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const to = sp.to ?? new Date().toISOString().slice(0, 10)
  const from =
    sp.from ??
    (() => {
      const d = new Date()
      d.setUTCMonth(d.getUTCMonth() - 6)
      return d.toISOString().slice(0, 10)
    })()
  const grain = (sp.grain as any) ?? 'month'
  const base = { from, to, grain }
  const [mrr, revenue, churn, margin, ltv] = await Promise.all([
    fetchMetric('financial', { ...base, metric: 'mrr_trend' }).catch((e) => ({ error: e.message })),
    fetchMetric('financial', { ...base, metric: 'revenue' }).catch((e) => ({ error: e.message })),
    fetchMetric('retention', { ...base, metric: 'churn' }).catch((e) => ({ error: e.message })),
    fetchMetric('financial', { ...base, metric: 'margin' }).catch((e) => ({ error: e.message })),
    fetchMetric('retention', { ...base, metric: 'ltv' }).catch((e) => ({ error: e.message })),
  ])
  const t = await getTranslations('analytics')
  const labels = {
    mrr: t('kpi.mrrTrend'),
    revenue: t('kpi.revenue'),
    churn: t('kpi.churn'),
    margin: t('kpi.margin'),
    ltv: t('kpi.ltv'),
  }
  return (
    <FinancialDashboard
      mrr={mrr as any}
      revenue={revenue as any}
      churn={churn as any}
      margin={margin as any}
      ltv={ltv as any}
      query={base}
      labels={labels}
    />
  )
}
