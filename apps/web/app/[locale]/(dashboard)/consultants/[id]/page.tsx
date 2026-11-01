import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import {
  CONSULTANT_SERVICES,
  getConsultant,
  getConsultantReviews,
  type ConsultantReview,
} from '@/lib/api/marketplace'
import { HireButton } from './hire-button'
import { BookConsultation } from './book-consultation'

/**
 * Consultant profile + the four purchasable services.
 *
 * The service cards are the missing pay-in surface: before this, nothing in the
 * app called POST /billing/checkout/service-order, so a customer could not buy
 * consultant work at all and the payout sweep had nothing to sweep.
 */
export default async function ConsultantDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ applicationId?: string; service_order?: string }>
}) {
  const [{ id }, query, t, tc] = await Promise.all([
    params,
    searchParams,
    getTranslations('marketplace'),
    getTranslations('consultations'),
  ])

  const consultant = await getConsultant(id).catch(() => null)
  if (!consultant) notFound()

  let reviews: ConsultantReview[] = []
  try {
    reviews = await getConsultantReviews(id)
  } catch {
    // Reviews are supplementary — a failure here must not blank the profile.
    reviews = []
  }

  const bookable = consultant.active_status === 'active'

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      {query.service_order === 'cancel' && (
        <div className="alert alert-info">{t('checkoutCancelled')}</div>
      )}

      <section>
        <h1 className="type-h2" style={{ marginBottom: 8 }}>
          {consultant.full_name ?? t('unnamed')}
        </h1>
        {consultant.headline && (
          <p className="text-muted">{consultant.headline}</p>
        )}
        {/* Corridors and languages live on `skills`, not the profile row, and
            skills can legitimately be null for a profile that never filled it. */}
        <div
          style={{
            display: 'flex',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 12,
          }}
        >
          {(consultant.skills?.countries_supported ?? []).map((code) => (
            <span key={code} className="badge badge-neutral">
              {code}
            </span>
          ))}
          {(consultant.skills?.languages ?? []).map((l) => (
            <span key={l} className="badge badge-accent">
              {l}
            </span>
          ))}
        </div>
      </section>

      {consultant.bio && (
        <section>
          <h2 className="type-h3" style={{ marginBottom: 8 }}>
            {t('about')}
          </h2>
          <p>{consultant.bio}</p>
        </section>
      )}

      <section>
        <h2 className="type-h3" style={{ marginBottom: 4 }}>
          {t('servicesHeading')}
        </h2>
        <p className="text-muted" style={{ marginBottom: 16 }}>
          {t('servicesNote')}
        </p>

        {!bookable && (
          <div className="alert alert-warning" style={{ marginBottom: 16 }}>
            {t('notAcceptingWork')}
          </div>
        )}

        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          }}
        >
          {CONSULTANT_SERVICES.map((svc) => (
            <div
              key={svc.serviceType}
              className="card"
              style={{ display: 'grid', gap: 8, alignContent: 'start' }}
            >
              <strong>{t(svc.labelKey)}</strong>
              <div className="type-h3">{svc.price}</div>
              <p className="text-muted">{t(svc.descKey)}</p>
              {bookable && (
                <HireButton
                  consultantId={consultant.id}
                  serviceType={svc.serviceType}
                  applicationId={query.applicationId}
                  label={t('hire')}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {bookable && (
        <section>
          <h2 className="type-h3" style={{ marginBottom: 4 }}>
            {tc('sectionHeading')}
          </h2>
          <p className="text-muted" style={{ marginBottom: 16 }}>
            {tc('sectionNote')}
          </p>
          <BookConsultation
            consultantId={consultant.id}
            applicationId={query.applicationId}
          />
        </section>
      )}

      <section>
        <h2 className="type-h3" style={{ marginBottom: 16 }}>
          {t('reviewsHeading')}
        </h2>
        {reviews.length === 0 ? (
          <p className="text-muted">{t('noReviews')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {reviews.map((r) => (
              <div key={r.id} className="card card-snug">
                <div>
                  {'★'.repeat(Math.max(0, Math.min(5, Math.round(r.rating))))}
                </div>
                {r.feedback && <p>{r.feedback}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
