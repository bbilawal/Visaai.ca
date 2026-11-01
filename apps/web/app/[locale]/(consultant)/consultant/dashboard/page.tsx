import { getTranslations } from 'next-intl/server'
import { getConsultantDashboard } from '@/lib/api/assignment'
import { DashboardCards } from '@/components/consultant/dashboard-cards'

export default async function ConsultantDashboardPage() {
  const [data, t] = await Promise.all([
    getConsultantDashboard(),
    getTranslations('consultant.dashboard'),
  ])

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section>
        <h1 className="type-h2" style={{ marginBottom: 16 }}>{t('title')}</h1>
        <DashboardCards
          data={data}
          labels={{
            assigned: t('assigned'),
            newRequests: t('newRequests'),
            awaitingReview: t('awaitingReview'),
            highPriority: t('highPriority'),
            today: t('today'),
            week: t('week'),
          }}
        />
      </section>
    </div>
  )
}
