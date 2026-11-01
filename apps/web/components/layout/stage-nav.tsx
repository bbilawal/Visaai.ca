'use client'

import { useTranslations } from 'next-intl'
import { usePathname, Link } from '@/i18n/navigation'
import type { Route } from 'next'
import type { StageState } from '@visaai/types'
import { cn } from '@/lib/utils'
import { useAuthGate } from '@/components/auth/auth-gate-provider'

// Stages a guest can reach without an account. Everything after intake is gated.
const GUEST_OPEN_STAGES = new Set(['intake'])

// `labelKey` indexes the `stages` i18n namespace; `slug` is the route segment.
// Order must match STAGE_ORDER in @visaai/types — that array drives which
// stage `computeProgress` reports as current, and a nav in a different order
// would number the steps differently from the progress bar.
const STAGES = [
  { slug: 'intake', labelKey: 'intake' },
  { slug: 'documents', labelKey: 'documents' },
  { slug: 'narrative', labelKey: 'generate' },
  { slug: 'prefill', labelKey: 'prefill' },
  { slug: 'readiness', labelKey: 'readiness' },
  { slug: 'submission', labelKey: 'submit' },
] as const

type StageSlug = (typeof STAGES)[number]['slug']
const STAGE_SLUGS = STAGES.map(s => s.slug) as readonly string[]

export function StageNav({ stages }: { stages?: Partial<Record<string, StageState>> } = {}) {
  const t = useTranslations('stages')
  const pathname = usePathname()
  const { isGated, openAuthModal } = useAuthGate()
  const segments = pathname.split('/').filter(Boolean)
  const [stage, applicationId] = segments

  if (!stage || !applicationId || !STAGE_SLUGS.includes(stage)) return null

  const currentIndex = STAGES.findIndex(s => s.slug === stage)

  return (
    <nav aria-label={t('ariaStages')} className="stage-nav">
      <Link href="/" className="stage-nav__back">
        <span className="inline-block rtl:-scale-x-100" aria-hidden>←</span> {t('allApplications')}
      </Link>

      <ol className="stage-nav__list">
        {STAGES.map((s, i) => {
          const realState = stages?.[s.slug]
          const isCurrent = s.slug === (stage as StageSlug)
          const isDone = realState ? realState === 'complete' : i < currentIndex
          const isLocked = realState === 'locked'
          const href = `/${s.slug}/${applicationId}` as Route
          // Guests/logged-out: every stage past intake opens the auth modal
          // instead of navigating (the backend gate would 403/redirect anyway).
          const isAuthGated = isGated && !GUEST_OPEN_STAGES.has(s.slug)

          return (
            <li key={s.slug} className="flex items-center">
              {isAuthGated ? (
                <button
                  type="button"
                  onClick={() => openAuthModal(href)}
                  className={cn('stage-nav__step', 'stage-nav__step--gate')}
                  title={t('signInToUnlock')}
                >
                  <span className="stage-nav__index" aria-hidden>🔒</span>
                  {t(s.labelKey)}
                </button>
              ) : (
                <Link
                  href={href}
                  aria-current={isCurrent ? 'step' : undefined}
                  aria-disabled={isLocked || undefined}
                  className={cn('stage-nav__step', isDone && 'is-done', isLocked && 'is-locked')}
                  title={isLocked ? t('finishEarlierFirst') : undefined}
                >
                  <span className="stage-nav__index" aria-hidden>
                    {isDone ? '✓' : isLocked ? '🔒' : i + 1}
                  </span>
                  {t(s.labelKey)}
                </Link>
              )}
              {i < STAGES.length - 1 && <span aria-hidden className="stage-nav__divider" />}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
