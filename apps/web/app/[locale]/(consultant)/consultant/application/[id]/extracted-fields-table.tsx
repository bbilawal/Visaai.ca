'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import type { ConsultantReviewField } from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/providers/toast-provider'
import { consultantActionError } from '@/lib/api/consultant-action-error'
import { editPreflightField } from '@/lib/api/preflight-client'
import { approveField, markFieldNotApplicable, rejectField } from '@/lib/api/consultant-client'
import { notifyPreflightChanged } from '@/lib/preflight-events'

/**
 * Extracted fields (field_provenance current versions) with the consultant's
 * per-field decision.
 *
 * What the decisions DO (server-side, not decoration):
 *  - APPROVE binds to the value's current hash. If the value later changes the
 *    approval goes stale, and a stale approval blocks completing the
 *    pre-submission lock and blocks execution.
 *  - REJECT means "this value must not be used": a rejected field blocks portal
 *    auto-fill (execution) until it is approved again.
 *  - NOT APPLICABLE means "this field does not apply here" (OCR junk such as a
 *    sponsor job title read off someone else's letter). The value is left out
 *    of portal auto-fill and, unlike reject, nothing is blocked.
 *  - CORRECT writes a new consultant-entered version (the OCR value stays in
 *    history). When the key is also on the applicant's saved form or is an
 *    auto-fill field, the correction lands there too — the same endpoint the
 *    pre-submission review uses — so it is what auto-fill writes.
 */

const border = '1px solid var(--color-hairline-2, rgba(0,0,0,.15))'
const cell: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: border,
  verticalAlign: 'top',
  fontSize: '0.82rem',
}
const decisionTone: Record<string, string> = {
  approved: 'var(--color-emerald, #1a6b40)',
  rejected: 'var(--color-rose, #b53030)',
  revoked: 'var(--color-rose, #b53030)',
}
const decisionLabel = (d: string) => (d === 'not_applicable' ? 'not applicable' : d)
const linkBtn: React.CSSProperties = {
  fontSize: '0.72rem',
  textDecoration: 'underline',
  background: 'none',
  border: 0,
  cursor: 'pointer',
  padding: 0,
  marginRight: 10,
}

type Mode = { key: string; kind: 'correct' | 'reject' | 'not_applicable' } | null

export default function ExtractedFieldsTable({
  applicationId,
  fields,
  canDecide = true,
}: {
  applicationId: string
  fields: ConsultantReviewField[]
  /** False for a viewer who is not an active assignee: the API refuses field decisions (403). */
  canDecide?: boolean
}) {
  const router = useRouter()
  const { toast } = useToast()
  const tc = useTranslations('consultant')
  const [mode, setMode] = useState<Mode>(null)
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(key: string, fn: (token: string) => Promise<unknown>, done: string) {
    setBusy(key); setError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('Not authenticated')
      await fn(session.access_token)
      setMode(null)
      toast(done, 'success')
      // Any of these can change what the pre-submission review shows (a
      // correction un-ticks a check; not-applicable drops a mapped field).
      notifyPreflightChanged(applicationId)
      router.refresh()
    } catch (err) {
      setError(consultantActionError(err, tc('actionFailed')))
    } finally { setBusy(null) }
  }

  function open(f: ConsultantReviewField, kind: 'correct' | 'reject' | 'not_applicable') {
    setMode({ key: f.fieldKey, kind })
    setValue(kind === 'correct' ? f.value ?? '' : '')
    setReason('')
    setError(null)
  }

  return (
    <div>
      <p className="mono text-muted" style={{ fontSize: '0.75rem', marginBottom: 8 }}>
        Values read from documents and intake. Correct anything wrong, approve what
        is right. Approval is tied to the value — if it changes later the approval
        goes stale and must be given again. Rejecting a value blocks portal auto-fill
        until it is approved; marking it not applicable just leaves it out of auto-fill.
      </p>
      {error && (
        <p className="mono" role="alert" style={{ fontSize: '0.75rem', color: 'var(--color-rose, #b53030)', marginBottom: 8 }}>
          {error}
        </p>
      )}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ ...cell, textAlign: 'left' }} className="mono">Field</th>
              <th style={{ ...cell, textAlign: 'left' }} className="mono">Value</th>
              <th style={{ ...cell, textAlign: 'left' }} className="mono">Origin</th>
              <th style={{ ...cell, textAlign: 'left' }} className="mono">Decision</th>
              <th style={{ ...cell, textAlign: 'left' }} className="mono">Actions</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((f) => {
              const active = mode?.key === f.fieldKey ? mode.kind : null
              const isBusy = busy === f.fieldKey
              return (
                <tr key={f.fieldKey}>
                  <td style={cell} className="mono">{f.fieldKey}</td>
                  <td style={cell} className="sans">
                    {active === 'correct' ? (
                      <span style={{ display: 'grid', gap: 4 }}>
                        <input
                          aria-label={`Corrected value for ${f.fieldKey}`}
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          className="mono"
                          style={{ fontSize: '0.78rem', padding: '2px 6px' }}
                          autoFocus
                        />
                        <input
                          aria-label={`Reason for ${f.fieldKey}`}
                          placeholder="Reason (optional)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="mono"
                          style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                        />
                      </span>
                    ) : (
                      f.value ?? '—'
                    )}
                  </td>
                  <td style={cell} className="mono text-muted">
                    {f.origin === 'user_entered' ? 'corrected' : f.origin ?? '—'}
                    {f.confidence != null && ` · ${Math.round(f.confidence * 100)}%`}
                  </td>
                  <td style={{ ...cell, color: decisionTone[f.decision] }} className="mono">
                    {decisionLabel(f.decision)}{f.stale ? ' (stale)' : ''}
                  </td>
                  <td style={cell} className="mono">
                    {active === 'correct' && (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <Button
                          size="sm"
                          disabled={isBusy}
                          onClick={() =>
                            void run(
                              f.fieldKey,
                              (t) => editPreflightField(t, applicationId, f.fieldKey, value, reason.trim() || undefined),
                              tc('toastValueCorrected'),
                            )
                          }
                        >
                          {isBusy ? 'Saving…' : 'Save'}
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setMode(null)} disabled={isBusy}>
                          Cancel
                        </Button>
                      </span>
                    )}
                    {active === 'reject' && (
                      <span style={{ display: 'grid', gap: 4 }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--color-rose, #b53030)' }}>
                          Rejecting blocks portal auto-fill until this field is approved.
                        </span>
                        <input
                          aria-label={`Reject reason for ${f.fieldKey}`}
                          placeholder="Reason (required)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="mono"
                          style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                          autoFocus
                        />
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label="Confirm reject"
                            disabled={isBusy || !reason.trim()}
                            onClick={() =>
                              void run(f.fieldKey, (t) => rejectField(t, applicationId, f.fieldKey, reason.trim()), tc('toastFieldRejected'))
                            }
                          >
                            {isBusy ? 'Rejecting…' : 'Reject'}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setMode(null)} disabled={isBusy}>
                            Cancel
                          </Button>
                        </span>
                      </span>
                    )}
                    {active === 'not_applicable' && (
                      <span style={{ display: 'grid', gap: 4 }}>
                        <span style={{ fontSize: '0.7rem' }}>
                          This value will be left out of portal auto-fill. It does not block auto-fill.
                        </span>
                        <input
                          aria-label={`Not applicable reason for ${f.fieldKey}`}
                          placeholder="Reason (optional)"
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                          className="mono"
                          style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                          autoFocus
                        />
                        <span style={{ display: 'inline-flex', gap: 6 }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            aria-label="Confirm not applicable"
                            disabled={isBusy}
                            onClick={() =>
                              void run(
                                f.fieldKey,
                                (t) => markFieldNotApplicable(t, applicationId, f.fieldKey, reason.trim() || undefined),
                                tc('toastMarkedNotApplicable'),
                              )
                            }
                          >
                            {isBusy ? 'Saving…' : 'Not applicable'}
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setMode(null)} disabled={isBusy}>
                            Cancel
                          </Button>
                        </span>
                      </span>
                    )}
                    {active == null && (
                      <>
                        <button type="button" style={linkBtn} className="mono" aria-label={`Correct ${f.fieldKey}`} disabled={busy != null} onClick={() => open(f, 'correct')}>
                          Correct
                        </button>
                        <button
                          type="button"
                          style={linkBtn}
                          className="mono"
                          aria-label={`Approve ${f.fieldKey}`}
                          disabled={!canDecide || busy != null || !f.valueHash || f.approved}
                          title={f.approved ? 'Already approved' : undefined}
                          onClick={() =>
                            void run(f.fieldKey, (t) => approveField(t, applicationId, f.fieldKey, f.valueHash as string), tc('toastFieldApproved'))
                          }
                        >
                          Approve
                        </button>
                        <button type="button" style={linkBtn} className="mono" aria-label={`Reject ${f.fieldKey}`} disabled={!canDecide || busy != null} onClick={() => open(f, 'reject')}>
                          Reject
                        </button>
                        <button
                          type="button"
                          style={linkBtn}
                          className="mono"
                          aria-label={`Not applicable ${f.fieldKey}`}
                          disabled={!canDecide || busy != null || f.decision === 'not_applicable'}
                          title={f.decision === 'not_applicable' ? 'Already marked not applicable' : 'Leave this value out of auto-fill without blocking it'}
                          onClick={() => open(f, 'not_applicable')}
                        >
                          Not applicable
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
