import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { listConsultants } from '@/lib/api/marketplace'
import type { ConsultantCard } from '@visaai/types'
import { SITE_DEFAULT_COUNTRY } from '@/lib/site-config'

/** Browse licensed consultants. Filters mirror the API's discovery query. */
export default async function ConsultantsPage({
  searchParams,
}: {
  searchParams: Promise<{ visa_type?: string; country?: string; language?: string }>
}) {
  const [params, t] = await Promise.all([
    searchParams,
    getTranslations('marketplace'),
  ])

  let consultants: ConsultantCard[] = []
  let failed = false
  try {
    consultants = await listConsultants({
      visa_type: params.visa_type,
      // Canada site: only Canadian consultants are browsable.
      country: SITE_DEFAULT_COUNTRY ?? params.country,
      language: params.language,
    })
  } catch {
    failed = true
  }

  const filtered = Boolean(params.visa_type || params.country || params.language)

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section>
        <h1 className="type-h2" style={{ marginBottom: 8 }}>
          {t('title')}
        </h1>
        <p className="text-muted">{t('subtitle')}</p>
      </section>

      {failed ? (
        <div className="alert alert-error">{t('loadFailed')}</div>
      ) : consultants.length === 0 ? (
        <p className="text-muted">
          {filtered ? t('noneMatch') : t('noneYet')}
        </p>
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}
        >
          {consultants.map((c) => (
            <Link
              key={c.id}
              href={`/consultants/${c.id}`}
              className="card card-hover"
              style={{ display: 'grid', gap: 8, textDecoration: 'none' }}
            >
              <strong>{c.full_name ?? t('unnamed')}</strong>
              {c.headline && <span className="text-muted">{c.headline}</span>}

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {c.countries_supported.slice(0, 4).map((code) => (
                  <span key={code} className="badge badge-neutral">
                    {code}
                  </span>
                ))}
              </div>

              <div className="text-muted">
                {c.rating_count > 0
                  ? t('ratingWithCount', {
                      rating: c.rating_avg.toFixed(1),
                      count: c.rating_count,
                    })
                  : t('noReviews')}
                {c.years_experience
                  ? ` · ${t('yearsExp', { years: c.years_experience })}`
                  : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
