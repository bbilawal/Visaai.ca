'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { approveApplication, rejectApplication } from '@/lib/api/consultant-client'

type Decision = 'approved' | 'rejected'

/**
 * Consultant decision controls (UI). Wires Approve/Reject to the live
 * application-scope endpoints. Optimistically reflects the decision, then
 * `router.refresh()` re-runs the server component to show authoritative state.
 * On failure it rolls the optimistic state back and surfaces an error toast.
 * Authorization is enforced server-side (role + active assignment).
 */
export function DecisionActions({ applicationId }: { applicationId: string }) {
  const t = useTranslations('consultant')
  const router = useRouter()
  const { toast } = useToast()
  const [decision, setDecision] = useState<Decision | null>(null) // optimistic final state
  const [busy, setBusy] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')

  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const {
      data: { session },
    } = await getSession()
    if (!session) throw new Error(t('sessionExpired'))
    return fn(session.access_token)
  }

  async function onApprove() {
    if (busy || decision) return
    if (!window.confirm(t('confirmApprove'))) return
    const prev = decision
    setDecision('approved') // optimistic
    setBusy(true)
    try {
      await withToken(token => approveApplication(token, applicationId))
      toast(t('toastApproved'), 'success')
      router.refresh()
    } catch (err) {
      setDecision(prev) // rollback
      toast(err instanceof Error ? err.message : t('approveFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (busy || decision) return
    const trimmed = reason.trim()
    if (!trimmed) {
      toast(t('reasonRequired'), 'error')
      return
    }
    const prev = decision
    setDecision('rejected') // optimistic
    setBusy(true)
    try {
      await withToken(token => rejectApplication(token, applicationId, trimmed))
      toast(t('toastRejected'), 'success')
      setShowReject(false)
      router.refresh()
    } catch (err) {
      setDecision(prev) // rollback
      toast(err instanceof Error ? err.message : t('rejectFailed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const locked = busy || decision !== null

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          onClick={() => void onApprove()}
          disabled={locked}
          aria-busy={busy && decision === 'approved'}
        >
          {busy && decision === 'approved' ? t('approving') : t('approve')}
        </button>
        <button
          className="btn btn-outline"
          onClick={() => setShowReject(s => !s)}
          disabled={locked}
          aria-expanded={showReject}
        >
          {t('reject')}
        </button>
      </div>

      {showReject && !decision && (
        <div style={{ marginTop: 12, display: 'grid', gap: 8, maxWidth: 480 }}>
          <label htmlFor="reject-reason" className="mono" style={{ fontSize: '0.75rem' }}>
            {t('rejectReasonLabel')}
          </label>
          <textarea
            id="reject-reason"
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            disabled={busy}
            className="sans"
            style={{
              width: '100%',
              padding: 8,
              border: '1px solid var(--color-hairline-2, rgba(0,0,0,.15))',
              borderRadius: 8,
            }}
            placeholder={t('rejectPlaceholder')}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-danger"
              onClick={() => void onReject()}
              disabled={busy || !reason.trim()}
              aria-busy={busy && decision === 'rejected'}
            >
              {busy && decision === 'rejected' ? t('rejecting') : t('confirmReject')}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                setShowReject(false)
                setReason('')
              }}
              disabled={busy}
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      )}

      {decision && (
        <p className="mono text-muted" role="status" style={{ fontSize: '0.75rem', marginTop: 12 }}>
          {t('decisionRecorded', { decision })}
        </p>
      )}
    </div>
  )
}
