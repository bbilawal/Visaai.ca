'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { createServiceOrderCheckout } from '@/lib/api/marketplace-client'
import type { ConsultantServiceType } from '@/lib/api/marketplace'

/**
 * Buys one consultant service. This is the call that had no caller anywhere in
 * the app — the whole marketplace pay-in path was reachable only by hitting the
 * API directly.
 *
 * Sends no amount: the server resolves the price and the commission split, so
 * nothing here can change what is charged.
 */
export function HireButton({
  consultantId,
  serviceType,
  applicationId,
  label,
}: {
  consultantId: string
  serviceType: ConsultantServiceType
  applicationId?: string
  label: string
}) {
  const t = useTranslations('marketplace')
  const router = useRouter()
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

      const origin = window.location.origin
      const res = await createServiceOrderCheckout(session.access_token, {
        consultantId,
        serviceType,
        ...(applicationId ? { applicationId } : {}),
        successUrl: `${origin}/my-applications?service_order=success`,
        cancelUrl: `${origin}/consultants/${consultantId}?service_order=cancel`,
      })

      if (res.url) {
        window.location.href = res.url
        return
      }
      // A subscription credit covered it — no payment step at all.
      toast(t('coveredByCredit'), 'success')
      router.refresh()
      setBusy(false)
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err
          ? (err as { status: number }).status
          : 0
      // 503 is the payments_enabled kill switch, not a fault worth a stack trace.
      const msg =
        status === 503
          ? t('paymentsDisabled')
          : err instanceof Error
            ? err.message
            : t('hireFailed')
      toast(msg, 'error')
      setBusy(false)
    }
  }

  return (
    <button
      className="btn btn-primary btn-sm"
      onClick={() => void onClick()}
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? t('starting') : label}
    </button>
  )
}
