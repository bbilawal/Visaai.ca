'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  PreflightCategory,
  PreflightCheckKey,
  PreflightMappingInput,
  PreflightReview,
} from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/providers/toast-provider'
import {
  completePreflight,
  editPreflightField,
  getActivePreflight,
  getPreflightMappings,
  recordPreflightCheck,
  startPreflight,
  validatePreflightLock,
} from '@/lib/api/preflight-client'
import { onPreflightChanged } from '@/lib/preflight-events'

/**
 * Pre-submission review. The consultant sees exactly the fields that portal
 * auto-fill would write, ticks off each category, and completes the review —
 * which locks a hash over those mappings. That lock is the trust anchor the
 * whole execution path re-derives against, so nothing here invents data: the
 * mappings are fetched from the server and passed back untouched.
 *
 * Values are editable until the lock. An edit goes to the server (PUT
 * fields/:key), which writes the applicant's saved form — the source the
 * mappings are derived from — and un-ticks the category that covered the
 * value. The panel then shows the server's re-derived mappings, never a
 * locally patched copy. Once locked, values are frozen: "Start a new review"
 * retires the lock and reopens editing.
 */

const CATEGORIES: { key: PreflightCategory; check: PreflightCheckKey; label: string }[] = [
  { key: 'passport', check: 'passport_reviewed', label: 'Passport & identity' },
  { key: 'dates', check: 'dates_reviewed', label: 'Dates' },
  { key: 'travel_history', check: 'travel_history_reviewed', label: 'Travel history' },
  { key: 'addresses', check: 'addresses_reviewed', label: 'Addresses' },
  { key: 'employment', check: 'employment_reviewed', label: 'Employment' },
]

async function withToken<T>(fn: (token: string) => Promise<T>): Promise<T> {
  const { data: { session } } = await getSession()
  if (!session) throw new Error('Not authenticated')
  return fn(session.access_token)
}

const LOCK_REASON_TEXT: Record<string, string> = {
  provenance_or_mapping_changed:
    'a value it covers changed since this review was locked',
  stale_approval: 'a field approval is stale',
  verification_drift: 'verified data drifted',
  consultant_reassigned: 'the application was reassigned',
  no_active_consultant: 'no consultant is assigned',
}

export default function PreflightPanel({ applicationId }: { applicationId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [draftReason, setDraftReason] = useState('')
  const [mappings, setMappings] = useState<PreflightMappingInput[] | null>(null)
  const [review, setReview] = useState<PreflightReview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lockReasons, setLockReasons] = useState<string[] | null>(null)

  const load = useCallback(async () => {
    try {
      const [m, r] = await withToken(async (t) =>
        Promise.all([
          getPreflightMappings(t, applicationId),
          getActivePreflight(t, applicationId),
        ]),
      )
      setMappings(m)
      setReview(r)
      // A lock can be broken after the fact (the applicant edits their form).
      // Say so up front instead of waiting for someone to press "Re-check".
      if (r?.status === 'completed' && r.locked_diff_hash) {
        const v = await withToken((t) => validatePreflightLock(t, applicationId, r.id, m))
        setLockReasons(v.valid ? [] : v.reasons)
      } else {
        setLockReasons(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the review')
    }
  }, [applicationId])

  // `whole`: the value feeds several portal controls (a date → year / month /
  // day), so the row shows a fragment; the edit takes the whole source value.
  function beginEdit(f: PreflightMappingInput, whole = false) {
    setEditing(f.fieldKey)
    setDraft(whole ? '' : String(f.mappedValue ?? ''))
    setDraftReason('')
    setError(null)
  }

  async function handleSaveEdit(fieldKey: string) {
    setBusy(`edit:${fieldKey}`); setError(null)
    try {
      const reason = draftReason.trim() || undefined
      const out = await withToken((t) =>
        editPreflightField(t, applicationId, fieldKey, draft, reason),
      )
      setMappings(out.mappings)
      setReview(out.review)
      setEditing(null)
      toast('Saved. The category was un-ticked — re-check it before locking.', 'success')
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save that change')
    } finally { setBusy(null) }
  }

  async function handleNewReview() {
    if (!mappings) return
    if (!window.confirm('Start a new review? The current lock is retired and the applicant cannot run auto-fill until you lock again.')) return
    setBusy('start'); setError(null)
    try {
      setReview(await withToken((t) => startPreflight(t, applicationId, mappings)))
      setLockReasons(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start a new review')
    } finally { setBusy(null) }
  }

  useEffect(() => { void load() }, [load])

  // A correction in the Fields table or the Documents & forms panel resets a
  // check on the server. Re-read so the boxes show what the server will
  // enforce, instead of a stale tick next to a disabled "Complete & lock".
  useEffect(() => onPreflightChanged(applicationId, () => { void load() }), [applicationId, load])

  async function handleStart() {
    if (!mappings) return
    setBusy('start'); setError(null)
    try {
      setReview(await withToken((t) => startPreflight(t, applicationId, mappings)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the review')
    } finally { setBusy(null) }
  }

  async function handleCheck(check: PreflightCheckKey, value: boolean) {
    if (!review) return
    setBusy(check); setError(null)
    try {
      setReview(await withToken((t) =>
        recordPreflightCheck(t, applicationId, review.id, check, value),
      ))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record that check')
    } finally { setBusy(null) }
  }

  async function handleComplete() {
    if (!review || !mappings) return
    setBusy('complete'); setError(null)
    try {
      setReview(await withToken((t) =>
        completePreflight(t, applicationId, review.id, mappings),
      ))
      toast('Review locked. If you have not yet, press “Approve application” above — auto-fill stays off until the application is approved.', 'success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the review')
      // The server refuses to lock values that moved since this page loaded
      // (409). Show the current values and the reset checks.
      void load()
    } finally { setBusy(null) }
  }

  async function handleValidate() {
    if (!review || !mappings) return
    setBusy('validate'); setError(null)
    try {
      const v = await withToken((t) =>
        validatePreflightLock(t, applicationId, review.id, mappings),
      )
      setLockReasons(v.valid ? [] : v.reasons)
      toast(v.valid ? 'Lock is still valid.' : 'Lock is no longer valid.', v.valid ? 'success' : 'error')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not validate the lock')
    } finally { setBusy(null) }
  }

  if (error && !mappings) {
    return <Card><p className="mono" style={{ color: 'var(--color-rose, #b53030)' }}>{error}</p></Card>
  }
  if (!mappings) {
    return <Card><p className="mono">Loading pre-submission review…</p></Card>
  }

  // No registered portal mapping for this destination — there is nothing that
  // auto-fill could write, so there is nothing to review.
  if (mappings.length === 0) {
    return (
      <Card>
        <h3 className="type-h4">Pre-submission review</h3>
        <p className="mono" style={{ fontSize: '0.8rem' }}>
          This destination has no portal fill mapping, so no fields can be
          auto-filled. Nothing to review.
        </p>
      </Card>
    )
  }

  const locked = review?.status === 'completed' && Boolean(review.locked_diff_hash)
  const allChecked =
    review != null && CATEGORIES.every((c) => review[c.check]) && review.final_approval
  // Say what is still missing rather than leaving a silently disabled button.
  const missingChecks =
    review && !locked
      ? [
          ...CATEGORIES.filter((c) => !review[c.check]).map((c) => c.label),
          ...(review.final_approval ? [] : ['“I have reviewed every field above”']),
        ]
      : []

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <h3 className="type-h4">Pre-submission review</h3>
        {locked ? <Badge>Locked</Badge> : review ? <Badge>In review</Badge> : <Badge>Not started</Badge>}
      </div>

      <p className="mono" style={{ fontSize: '0.75rem', marginTop: 8 }}>
        These {mappings.length} fields are exactly what portal auto-fill will
        write, taken from the applicant&apos;s saved application form.
        {locked
          ? ' They are locked; start a new review to change any of them.'
          : ' Correct anything wrong with Edit — the change is saved to the form and the category must be re-checked.'}
        {' '}Completing the review locks them; the applicant cannot run the fill
        until it is locked, and any later change to the data breaks the lock.
      </p>

      {CATEGORIES.map((cat) => {
        const fields = mappings.filter((m) => m.category === cat.key)
        const writesPerKey = new Map<string, number>()
        const firstTarget = new Map<string, string>()
        for (const m of mappings) {
          writesPerKey.set(m.fieldKey, (writesPerKey.get(m.fieldKey) ?? 0) + 1)
          if (!firstTarget.has(m.fieldKey)) firstTarget.set(m.fieldKey, m.targetField)
        }
        const isFirst = (m: PreflightMappingInput) => firstTarget.get(m.fieldKey) === m.targetField
        const isSplit = (m: PreflightMappingInput) => (writesPerKey.get(m.fieldKey) ?? 0) > 1
        const isDatePart = (m: PreflightMappingInput) => / — (year|month|day)$/.test(m.label ?? '')
        // Every category is rendered, even with no fields: the API requires
        // each category's check before it will lock, so hiding an empty one
        // left a checkbox nobody could tick and the lock unreachable.
        const checked = review?.[cat.check] ?? false
        return (
          <section key={cat.key} style={{ marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={checked}
                disabled={!review || locked || busy != null}
                onChange={(e) => void handleCheck(cat.check, e.target.checked)}
                aria-busy={busy === cat.check}
              />
              <span className="type-body" style={{ fontWeight: 600 }}>{cat.label}</span>
              <span className="mono" style={{ fontSize: '0.7rem' }}>({fields.length})</span>
            </label>
            {fields.length === 0 && (
              <p className="mono" style={{ fontSize: '0.75rem', margin: '6px 0 0 24px' }}>
                Nothing to fill in this category — tick to confirm none is expected.
              </p>
            )}
            <ul style={{ listStyle: 'none', margin: '6px 0 0 24px', padding: 0 }}>
              {fields.map((f) => (
                <li key={`${f.fieldKey}|${f.targetField}`} className="mono" style={{ fontSize: '0.75rem', padding: '2px 0' }}>
                  {editing === f.fieldKey && isFirst(f) ? (
                    <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                      {f.fieldKey}{isSplit(f) ? ' (whole value)' : ''}:
                      <input
                        aria-label={`New value for ${f.fieldKey}`}
                        placeholder={isDatePart(f) ? 'YYYY-MM-DD' : undefined}
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        className="mono"
                        style={{ fontSize: '0.75rem', padding: '2px 6px', minWidth: 160 }}
                        autoFocus
                      />
                      <input
                        aria-label="Reason for the change (optional)"
                        placeholder="Reason (optional)"
                        value={draftReason}
                        onChange={(e) => setDraftReason(e.target.value)}
                        className="mono"
                        style={{ fontSize: '0.75rem', padding: '2px 6px', minWidth: 140 }}
                      />
                      <Button size="sm" onClick={() => void handleSaveEdit(f.fieldKey)} disabled={busy != null}>
                        {busy === `edit:${f.fieldKey}` ? 'Saving…' : 'Save'}
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(null)} disabled={busy != null}>
                        Cancel
                      </Button>
                    </span>
                  ) : (
                    <>
                      {f.label ?? f.fieldKey}: <strong>{String(f.mappedValue ?? '')}</strong>
                      {/* A value written to several portal controls (DOB → year/month/day)
                          is edited once, as a whole, from its first row. */}
                      {!locked && isFirst(f) && (
                        <button
                          type="button"
                          onClick={() => beginEdit(f, isSplit(f))}
                          disabled={busy != null || editing != null}
                          aria-label={`Edit ${f.fieldKey}`}
                          className="mono"
                          style={{ marginLeft: 8, fontSize: '0.7rem', textDecoration: 'underline', background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                        >
                          Edit
                        </button>
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )
      })}

      {review && !locked && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 20 }}>
          <input
            type="checkbox"
            checked={review.final_approval}
            disabled={busy != null}
            onChange={(e) => void handleCheck('final_approval', e.target.checked)}
            aria-busy={busy === 'final_approval'}
          />
          <span className="type-body" style={{ fontWeight: 600 }}>
            I have reviewed every field above
          </span>
        </label>
      )}

      {lockReasons != null && lockReasons.length > 0 && (
        <p className="mono" style={{ fontSize: '0.75rem', color: 'var(--color-rose, #b53030)', marginTop: 12 }}>
          Lock invalid — {lockReasons.map((r) => LOCK_REASON_TEXT[r] ?? r).join('; ')}.
          {' '}Start a new review to re-check and lock again.
        </p>
      )}
      {error && (
        <p className="mono" style={{ fontSize: '0.75rem', color: 'var(--color-rose, #b53030)', marginTop: 12 }}>
          {error}
        </p>
      )}

      {missingChecks.length > 0 && (
        <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 12 }}>
          Complete &amp; lock unlocks once you tick: {missingChecks.join(', ')}.
          {' '}A correction to a value un-ticks the category that covers it.
        </p>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
        {!review && (
          <Button onClick={() => void handleStart()} disabled={busy != null}>
            {busy === 'start' ? 'Starting…' : 'Start review'}
          </Button>
        )}
        {review && !locked && (
          <Button onClick={() => void handleComplete()} disabled={!allChecked || busy != null}>
            {busy === 'complete' ? 'Locking…' : 'Complete & lock'}
          </Button>
        )}
        {locked && (
          <Button variant="secondary" onClick={() => void handleValidate()} disabled={busy != null}>
            {busy === 'validate' ? 'Checking…' : 'Re-check lock'}
          </Button>
        )}
        {locked && (
          <Button variant="secondary" onClick={() => void handleNewReview()} disabled={busy != null}>
            {busy === 'start' ? 'Starting…' : 'Start a new review'}
          </Button>
        )}
      </div>
    </Card>
  )
}
