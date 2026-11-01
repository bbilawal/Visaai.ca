import { getTranslations } from 'next-intl/server'
import { ConsultationsClient } from './consultations-client'

/**
 * The applicant's consultations.
 *
 * Rendered client-side rather than server-side on purpose: every time here is
 * displayed in the VIEWER's timezone, which only the browser knows. Formatting
 * on the server would pick the server's zone and quietly show a UTC time to
 * someone who booked at 2pm local.
 */
export default async function ConsultationsPage() {
  const t = await getTranslations('consultations')

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <header>
        <h1 className="type-h2" style={{ marginBottom: 8 }}>
          {t('pageHeading')}
        </h1>
        <p className="text-muted">{t('pageLede')}</p>
      </header>

      <ConsultationsClient />
    </div>
  )
}
