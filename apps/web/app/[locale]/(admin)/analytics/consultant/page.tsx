import { getTranslations } from 'next-intl/server'
import { fetchMetric } from '@/lib/api/analytics'
import { ConsultantDashboard } from '@/components/analytics/consultant-dashboard'

export default async function ConsultantPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
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
  const [takeRate, payout, leaderboard] = await Promise.all([
    fetchMetric('consultant', { ...base, metric: 'take_rate' }).catch((e) => ({ error: e.message })),
    fetchMetric('consultant', { ...base, metric: 'payout' }).catch((e) => ({ error: e.message })),
    fetchMetric('consultant', { ...base, metric: 'leaderboard' }).catch((e) => ({ error: e.message })),
  ])
  const t = await getTranslations('analytics')
  return (
    <ConsultantDashboard
      takeRate={takeRate as any}
      payout={payout as any}
      leaderboard={leaderboard as any}
      labels={{ takeRate: t('kpi.takeRate'), payout: t('kpi.payout'), leaderboard: t('kpi.leaderboard'), cor1: t('note.cor1') }}
      query={base}
    />
  )
}
