'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { selfComplete } from '@/lib/api/assignment-client'
import { InlineConfirm } from '@/components/ui/inline-confirm'

/**
 * "Mark complete" — the assigned consultant signals their review is done, which
 * stops the SLA clock so the application is not swept back to the queue. Thin
 * transport: calls the API, then router.refresh() to re-pull authoritative
 * state (the row shows "Completed"). The button and its in-page confirmation
 * (which replaced window.confirm) are translated; the toasts are still
 * English-only, like the rest of the assignment UI.
 */
export function MarkCompleteButton({ applicationId }: { applicationId: string }) {
  const t = useTranslations('consultant')
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    if (busy) return
    // Confirmed in the page by InlineConfirm below, not window.confirm.
    setBusy(true)
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error('Your session expired — sign in again.')
      await selfComplete(session.access_token, applicationId)
      toast('Marked complete', 'success')
      router.refresh()
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not mark complete', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <InlineConfirm
      triggerClassName="btn btn-outline btn-sm"
      confirmClassName="btn btn-primary btn-sm"
      cancelClassName="btn btn-ghost btn-sm"
      label={busy ? t('markingComplete') : t('markComplete')}
      question={t('confirmMarkComplete')}
      confirmLabel={t('confirmMarkCompleteYes')}
      cancelLabel={t('cancel')}
      onConfirm={() => void onClick()}
      busy={busy}
    />
  )
}
