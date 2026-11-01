'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { getDashboardLink, getOnboardingLink } from '@/lib/api/payouts-client'

type Action = 'onboard' | 'dashboard'

/**
 * Sends the consultant to a Stripe-hosted page. Both links are short-lived and
 * single-use, so they are minted on click rather than embedded in the server
 * render — a link baked into HTML would already be dead by the time it is used.
 *
 * `onboard` starts (or resumes) hosted KYC; Stripe returns the consultant to
 * /consultant/payouts?onboarded=1. `dashboard` opens the Express dashboard,
 * which 400s until onboarding has produced a Connect account.
 */
export function PayoutActions({
  action,
  variant = 'primary',
}: {
  action: Action
  variant?: 'primary' | 'secondary'
}) {
  const t = useTranslations('consultant.payouts')
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    if (busy) return
    setBusy(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error(t('sessionExpired'))
      const { url } =
        action === 'onboard'
          ? await getOnboardingLink(session.access_token)
          : await getDashboardLink(session.access_token)
      // Full navigation, not a new tab: Stripe returns here via return_url.
      window.location.href = url
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('linkFailed')
      toast(msg, 'error')
      setBusy(false)
    }
  }

  return (
    <button
      className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'}`}
      onClick={() => void onClick()}
      disabled={busy}
      aria-busy={busy}
    >
      {busy
        ? t('opening')
        : action === 'onboard'
          ? t('startOnboarding')
          : t('openDashboard')}
    </button>
  )
}
