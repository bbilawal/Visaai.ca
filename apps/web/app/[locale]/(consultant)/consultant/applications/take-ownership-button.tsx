'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { selfAssign } from '@/lib/api/assignment-client'

/**
 * "Take Ownership" — claims an eligible unassigned application for the current
 * consultant. Optimistically disables, calls the API, then router.refresh() to
 * re-pull authoritative server state (the row leaves the queue). On failure
 * (e.g. 409 someone else claimed it first) it re-enables and toasts the error.
 */
export function TakeOwnershipButton({ applicationId }: { applicationId: string }) {
  const t = useTranslations('consultant')
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  async function onClick() {
    if (busy || done) return
    if (!window.confirm(t('confirmTake')))
      return
    setBusy(true)
    setDone(true) // optimistic
    try {
      const {
        data: { session },
      } = await getSession()
      if (!session) throw new Error(t('sessionExpired'))
      await selfAssign(session.access_token, applicationId)
      toast(t('toastAssignedToYou'), 'success')
      router.refresh()
    } catch (err) {
      setDone(false) // rollback
      const msg =
        err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 409
          ? t('alreadyClaimed')
          : err instanceof Error
            ? err.message
            : t('couldNotTake')
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      className="btn btn-primary btn-sm"
      onClick={() => void onClick()}
      disabled={busy || done}
      aria-busy={busy}
    >
      {busy ? t('claiming') : done ? t('claimed') : t('takeOwnership')}
    </button>
  )
}
