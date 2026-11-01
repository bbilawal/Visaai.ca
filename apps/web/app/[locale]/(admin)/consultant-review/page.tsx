import { getTranslations } from 'next-intl/server'
import { ConsultantReviewQueue } from './review-queue'

/** Admin review of consultant marketplace profiles (approve / suspend / send back). */
export default async function ConsultantReviewPage() {
  const t = await getTranslations('consultantReview')

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <section>
        <h1 className="type-h2" style={{ marginBottom: 8 }}>
          {t('title')}
        </h1>
        <p className="text-muted">{t('subtitle')}</p>
      </section>

      <ConsultantReviewQueue />
    </div>
  )
}
