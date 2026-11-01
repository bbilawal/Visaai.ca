import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import { Link } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { humanizeStatus } from '@/lib/utils'
import type { Application, ApplicationStatus } from '@visaai/types'
import { loadAllProgress } from '@/lib/progress'
import { ResumeBanner } from '@/components/dashboard/resume-banner'
import { ProgressRing } from '@/components/dashboard/progress-ring'
import { CountryFlag } from '@/components/ui/country-flag'
import { localeAlternates } from '@/lib/seo/alternates'

// Canonical is this locale's own root ('/' for en, '/fr' for fr), never the
// English root for every locale.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  return { alternates: localeAlternates('/', locale) }
}

const COUNTRY_LABELS: Record<string, string> = {
  US: 'United States', CA: 'Canada', GB: 'United Kingdom', AU: 'Australia',
  NZ: 'New Zealand', IE: 'Ireland', DE: 'Germany', FR: 'France', IT: 'Italy',
  ES: 'Spain', PT: 'Portugal', NL: 'Netherlands', BE: 'Belgium', CH: 'Switzerland',
  AT: 'Austria', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
  PL: 'Poland', CZ: 'Czechia', GR: 'Greece', JP: 'Japan', KR: 'South Korea',
  SG: 'Singapore', HK: 'Hong Kong', CN: 'China', IN: 'India', AE: 'United Arab Emirates',
  SA: 'Saudi Arabia', QA: 'Qatar', TR: 'Türkiye', IL: 'Israel', ZA: 'South Africa',
  BR: 'Brazil', MX: 'Mexico', AR: 'Argentina', CL: 'Chile',
}

function titleFor(app: Application, fallback: string): string {
  if (!app.destination_country) return fallback
  const country = COUNTRY_LABELS[app.destination_country] ?? app.destination_country
  return app.destination_state ? `${country} — ${app.destination_state}` : country
}

function badgeVariantFor(status: ApplicationStatus) {
  switch (status) {
    case 'draft': return 'neutral' as const
    case 'ready': return 'accent' as const
    case 'submitted': return 'cyan' as const
    case 'decided': return 'emerald' as const
  }
}

export default async function DashboardPage() {
  const t = await getTranslations('dashboard')
  const ts = await getTranslations('status')
  const supabase = await createClient()
  // A failed read must not render as "you have no applications". supabase-js
  // resolves a failure as `{ data: null, error }`, so `?? []` turned an outage
  // into the empty-state CTA — telling an applicant mid-process that they have
  // nothing on file. Throwing renders the error boundary instead.
  const { data: applications, error: appsError } = await supabase
    .from('applications')
    .select('*')
    .order('created_at', { ascending: false })
  if (appsError) {
    throw new Error(`Could not load your applications: ${appsError.message}`)
  }

  const apps = (applications as Application[] | null) ?? []
  const progressMap = await loadAllProgress(apps.map(a => a.id))

  return (
    <div>
      <header className="page-head">
        <div className="page-head__intro">
          <span className="eyebrow">{t('workspace')}</span>
          <h1 className="type-h1" style={{ margin: '0 auto 44px' }}>{t('applications')}</h1>
          <p className="lede">{t('lede')}</p>
        </div>
        <Link href="/applications/new">
          <Button>+ {t('newApplication')}</Button>
        </Link>
      </header>

      {(() => {
        const candidate = apps.find(
          a => a.status !== 'decided' && (progressMap.get(a.id)?.overallPct ?? 0) < 100,
        )
        const cp = candidate ? progressMap.get(candidate.id) : undefined
        return candidate && cp ? <ResumeBanner progress={cp} title={titleFor(candidate, t('visaApplication'))} /> : null
      })()}

      {apps.length === 0 ? (
        <Card className="anim-fade-up anim-visible" style={{ textAlign: 'center', padding: '64px 32px' }}>
          <span className="eyebrow" style={{ display: 'block', marginBottom: 12 }}>
            {t('emptyEyebrow')}
          </span>
          <h2 className="type-h2" style={{ marginBottom: 8 }}>
            {t('emptyTitle')}
          </h2>
          <p className="lede" style={{ margin: '0 auto 24px' }}>
            {t('emptyLede')}
          </p>
          <Link href="/applications/new">
            <Button size="lg">{t('beginIntake')}</Button>
          </Link>
        </Card>
      ) : (
        <div className="flex flex-col gap-3">
          {apps.map(app => (
            <Link key={app.id} href={progressMap.get(app.id)?.nextAction.href ?? `/intake/${app.id}`} className="app-row">
              <div>
                <p className="app-row__title inline-flex items-center gap-2">
                  {/* Decorative: the country title text follows. */}
                  {app.destination_country && (
                    <CountryFlag code={app.destination_country} size="sm" />
                  )}
                  {titleFor(app, t('visaApplication'))}
                </p>
                <p className="app-row__meta">
                  {t('createdMeta', { date: new Date(app.created_at).toLocaleDateString(), id: app.id.slice(0, 8) })}
                </p>
              </div>
              <div className="app-row__right">
                {progressMap.get(app.id) && (
                  <ProgressRing pct={progressMap.get(app.id)!.overallPct} />
                )}
                {app.vri_score !== null && (
                  <span className="pill">{t('vriScore', { score: app.vri_score })}</span>
                )}
                <Badge variant={badgeVariantFor(app.status)}>
                  {ts.has(app.status) ? ts(app.status) : humanizeStatus(app.status)}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
