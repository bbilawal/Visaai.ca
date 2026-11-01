import { getTranslations } from 'next-intl/server'
import { ConsultantSignupForm } from './signup-form'

/**
 * Consultant self-onboarding.
 *
 * Lives under (dashboard), NOT (consultant): that group calls
 * requireRole(['consultant']), and someone applying to become a consultant
 * still has appRole 'user' — putting it there would lock out exactly the people
 * it exists for. The API agrees: /marketplace/profile is JwtGuard-only and
 * relies on RLS owner-write rather than role.
 */
export default async function BecomeAConsultantPage() {
  const t = await getTranslations('consultantSignup')

  return (
    <div style={{ display: 'grid', gap: 32 }}>
      <section>
        <h1 className="type-h2" style={{ marginBottom: 8 }}>
          {t('title')}
        </h1>
        <p className="text-muted">{t('subtitle')}</p>
      </section>

      <ConsultantSignupForm />
    </div>
  )
}
