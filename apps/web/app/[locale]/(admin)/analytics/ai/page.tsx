import { getTranslations } from 'next-intl/server'
import { fetchMetric } from '@/lib/api/analytics'
import { AiDashboard } from '@/components/analytics/ai-dashboard'

export default async function AiPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const to = sp.to ?? new Date().toISOString().slice(0, 10)
  const from =
    sp.from ??
    (() => {
      const d = new Date()
      d.setUTCDate(d.getUTCDate() - 29)
      return d.toISOString().slice(0, 10)
    })()
  const base = { from, to, grain: (sp.grain as any) ?? 'day' }
  const cost = await fetchMetric('ai', base).catch((e) => ({ error: e.message }))
  const t = await getTranslations('analytics')
  return <AiDashboard cost={cost as any} labels={{ cost: t('kpi.aiCostPerApp') }} query={base} />
}
