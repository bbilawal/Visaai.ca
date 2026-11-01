'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { useRouter } from 'next/navigation'
import { getSession } from '@/lib/supabase/client'
import { useToast } from '@/components/providers/toast-provider'
import { approveApplication, getConsultantApproval, rejectApplication } from '@/lib/api/consultant-client'
import { consultantActionError } from '@/lib/api/consultant-action-error'
import { InlineConfirm } from '@/components/ui/inline-confirm'
import {
  getActivePreflight,
  getPreflightMappings,
  validatePreflightLock,
} from '@/lib/api/preflight-client'
import { onPreflightChanged, onPreflightLockChanged, onReviewItemDecided } from '@/lib/preflight-events'

type Decision = 'approved' | 'rejected'
/** Whether approval is possible given the pre-submission review lock. */
type LockGate = 'checking' | 'ok' | 'needs_lock'

/**
 * Same test as the API's approval gate: the server-derived mappings, the
 * active review, and validateLock. Errors resolve to 'ok' — the API enforces
 * the lock, so an unreachable check must not block the button by itself.
 */
async function resolveLockGate(applicationId: string): Promise<LockGate> {
  try {
    const { data: { session } } = await getSession()
    if (!session) return 'ok'
    const token = session.access_token
    const [m, r] = await Promise.all([
      getPreflightMappings(token, applicationId),
      getActivePreflight(token, applicationId),
    ])
    if (m.length === 0) return 'ok' // no portal fill: nothing to lock
    if (r?.status !== 'completed' || !r.locked_diff_hash) return 'needs_lock'
    const v = await validatePreflightLock(token, applicationId, r.id, m)
    return v.valid ? 'ok' : 'needs_lock'
  } catch {
    return 'ok'
  }
}

/**
 * Is the application approved now, per the server rollup (the same answer the
 * applicant's side reads)? Errors resolve to false: the button stays usable and
 * the API decides.
 */
async function resolveApproved(applicationId: string): Promise<boolean> {
  try {
    const { data: { session } } = await getSession()
    if (!session) return false
    return (await getConsultantApproval(session.access_token, applicationId)).applicationApproved === true
  } catch {
    return false
  }
}

/**
 * Consultant decision controls (UI). Wires Approve/Reject to the live
 * application-scope endpoints. Optimistically reflects the decision, then
 * `router.refresh()` re-runs the server component to show authoritative state.
 * On failure it rolls the optimistic state back and shows the server's reason
 * inline (and as a toast) — never a silent no-op.
 * Authorization is enforced server-side (role + active assignment).
 */
export function DecisionActions({
  applicationId,
  canDecide = true,
}: {
  applicationId: string
  /**
   * False when the viewer is not an active assignee (an admin overseeing the
   * case): the API answers 403 to both decisions, so the buttons are disabled
   * with the reason instead of failing on click (owner, 2026-10-20).
   */
  canDecide?: boolean
}) {
  const t = useTranslations('consultant')
  const router = useRouter()
  const { toast } = useToast()
  const [decision, setDecision] = useState<Decision | null>(null) // optimistic final state
  const [busy, setBusy] = useState(false)
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState('')
  const [lockGate, setLockGate] = useState<LockGate>('checking')
  const [error, setError] = useState<string | null>(null)
  // Live 2026-10-20: after a reload the button offered "Approve application"
  // again on an approved application, and it was approved twice.
  const [alreadyApproved, setAlreadyApproved] = useState(false)

  async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const {
      data: { session },
    } = await getSession()
    if (!session) throw new Error(t('sessionExpired'))
    return fn(session.access_token)
  }

  // Approval turns auto-fill on, so the API refuses it while a route with a
  // portal fill has no currently valid pre-submission lock (live 2026-10-19).
  // Mirror that here; re-check whenever the review panel locks or a value moves.
  useEffect(() => {
    let live = true
    const check = () => {
      void resolveLockGate(applicationId).then(g => { if (live) setLockGate(g) })
    }
    check()
    const offValue = onPreflightChanged(applicationId, check)
    const offLock = onPreflightLockChanged(applicationId, check)
    return () => { live = false; offValue(); offLock() }
  }, [applicationId])

  // A refusal names what blocked approval (e.g. an open document request).
  // Once the consultant decides a document it may no longer be true, so drop
  // it rather than leave it reading as the current state.
  useEffect(() => onReviewItemDecided(applicationId, () => setError(null)), [applicationId])

  // A later document request, field rejection or new lock un-approves it, so
  // re-read on every decision made on this screen. Only the newest read may
  // land: two quick decisions can resolve out of order.
  useEffect(() => {
    let live = true
    let seq = 0
    const check = () => {
      const id = ++seq
      void resolveApproved(applicationId).then(a => {
        if (!live || id !== seq) return
        setAlreadyApproved(a)
        // An approval made earlier in this session no longer stands: offer
        // Approve again instead of leaving the buttons locked.
        if (!a) setDecision(d => (d === 'approved' ? null : d))
      })
    }
    check()
    const offItem = onReviewItemDecided(applicationId, check)
    const offValue = onPreflightChanged(applicationId, check)
    const offLock = onPreflightLockChanged(applicationId, check)
    return () => { live = false; offItem(); offValue(); offLock() }
  }, [applicationId])

  async function onApprove() {
    if (!canDecide || busy || decision || alreadyApproved || lockGate !== 'ok') return
    // Confirmed in the page by InlineConfirm below, not window.confirm.
    const prev = decision
    setDecision('approved') // optimistic
    setBusy(true)
    setError(null)
    try {
      await withToken(token => approveApplication(token, applicationId))
      toast(t('toastApproved'), 'success')
      router.refresh()
    } catch (err) {
      setDecision(prev) // rollback
      const msg = consultantActionError(err, t('approveFailed'))
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function onReject() {
    if (!canDecide || busy || decision) return
    const trimmed = reason.trim()
    if (!trimmed) {
      toast(t('reasonRequired'), 'error')
      return
    }
    const prev = decision
    setDecision('rejected') // optimistic
    setBusy(true)
    setError(null)
    try {
      await withToken(token => rejectApplication(token, applicationId, trimmed))
      toast(t('toastRejected'), 'success')
      setShowReject(false)
      router.refresh()
    } catch (err) {
      setDecision(prev) // rollback
      const msg = consultantActionError(err, t('rejectFailed'))
      setError(msg)
      toast(msg, 'error')
    } finally {
      setBusy(false)
    }
  }

  const locked = !canDecide || busy || decision !== null

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <InlineConfirm
          label={busy && decision === 'approved' ? t('approving') : t('approve')}
          question={t('confirmApprove')}
          confirmLabel={t('confirmApproveYes')}
          cancelLabel={t('cancel')}
          onConfirm={() => void onApprove()}
          disabled={locked || alreadyApproved || lockGate !== 'ok'}
          busy={busy && decision === 'approved'}
        />
        <button
          className="btn btn-outline"
          onClick={() => setShowReject(s => !s)}
          disabled={locked}
          aria-expanded={showReject}
        >
          {t('reject')}
        </button>
      </div>

      {error && !decision && (
        <p className="mono" role="alert" style={{ fontSize: '0.75rem', marginTop: 8, color: 'var(--color-rose, #b53030)' }}>
          {error}
        </p>
      )}

      {!canDecide && (
        <p className="mono text-muted" role="note" style={{ fontSize: '0.75rem', marginTop: 8 }}>
          {t('decisionAssigneeOnly')}
        </p>
      )}

      {alreadyApproved && !decision && (
        <p className="mono" role="status" style={{ fontSize: '0.75rem', marginTop: 8, color: 'var(--color-emerald, #1a6b40)' }}>
          {t('toastApproved')}
        </p>
      )}

      {lockGate === 'needs_lock' && !decision && !alreadyApproved && canDecide && (
        <p className="mono text-muted" role="note" style={{ fontSize: '0.75rem', marginTop: 8 }}>
          {t('approveNeedsLock')}
        </p>
      )}

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
