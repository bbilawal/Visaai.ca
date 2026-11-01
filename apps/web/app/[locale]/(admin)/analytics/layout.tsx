import { getTranslations } from 'next-intl/server'
import { AnalyticsNav } from '@/components/analytics/analytics-nav'

export default async function AnalyticsLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations('analytics')
  const labels = {
    executive: t('nav.executive'),
    financial: t('nav.financial'),
    visa: t('nav.visa'),
    ai: t('nav.ai'),
    consultant: t('nav.consultant'),
    journey: t('nav.journey'),
    reports: t('nav.reports'),
    alerts: t('nav.alerts'),
  }
  return (
    <div>
      <AnalyticsNav labels={labels} />
      {children}
    </div>
  )
}
