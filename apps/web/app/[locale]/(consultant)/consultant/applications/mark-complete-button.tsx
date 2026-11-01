'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { selfComplete } from '@/lib/api/assignment-client'

/**
 * "Mark complete" — the assigned consultant signals their review is done, which
 * stops the SLA clock so the application is not swept back to the queue. Thin
 * transport: calls the API, then router.refresh() to re-pull authoritative
 * state (the row shows "Completed"). English-only label, consistent with the
 * rest of the assignment UI.
 */
export function MarkCompleteButton({ applicationId }: { applicationId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)

  async function onClick() {
    if (busy) return
    if (!window.confirm('Mark this application review complete? This stops the review timer.'))
      return
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
    <button
      className="btn btn-outline btn-sm"
      onClick={() => void onClick()}
      disabled={busy}
      aria-busy={busy}
    >
      {busy ? 'Saving…' : 'Mark complete'}
    </button>
  )
}
