'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ConsultantApprovalRollup,
  PortalFillCoverage,
  PortalFillLeftReason,
  PreflightInvalidationReason,
  PreflightMappingInput,
  PreflightReview,
} from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  getActivePreflight,
  getPortalFillCoverage,
  getPreflightMappings,
  validatePreflightLock,
} from '@/lib/api/preflight-client'
import { getConsultantApproval } from '@/lib/api/consultant-client'
import { approvalBlockText, lockReasonText, readbackKey } from '@/lib/readback-reasons'
import { isApiUnavailable } from '@/lib/api-unavailable'

export interface ReadbackState {
  /** Ready to request execution: a completed lock plus the user's confirmation. */
  confirmed: boolean
  reviewId: string | null
  mappings: PreflightMappingInput[] | null
  /** Null while loading; false when this destination has nothing to auto-fill. */
  fillable: boolean | null
}

/**
 * The readback gate — the applicant's own review of what will be typed into a
 * government form on their behalf, and the last human checkpoint before it
 * happens.
 *
 * Two independent conditions must hold before a fill can be requested:
 *  1. a consultant has completed the pre-submission review, locking a hash over
 *     these exact fields; and
 *  2. the applicant has read the values and confirmed them here.
 *
 * The second is the `userConfirmationFlag` the execution request refuses
 * without, so this checkbox is not decoration — it is the flag. It is never
 * defaulted to true, and it resets whenever the underlying values change.
 *
 * A third condition is the consultant's APPLICATION approval ("Approve
 * application", a separate button from "Complete & lock"). Execution refuses
 * without it (consultant_missing), so the gate reads the approval rollup and
 * says so up front rather than letting the applicant tick and launch into a
 * raw error code.
 *
 * `readOnly`: the viewer is not the applicant (a consultant or admin opening
 * the Submit page). They see the state, never the confirmation.
 */
export default function ReadbackGate({
  applicationId,
  onChange,
  readOnly = false,
  isEta = false,
}: {
  applicationId: string
  onChange: (state: ReadbackState) => void
  readOnly?: boolean
  /** Canada eTA: one page revealed step by step, nothing fills on its own. */
  isEta?: boolean
}) {
  const [review, setReview] = useState<PreflightReview | null>(null)
  const [mappings, setMappings] = useState<PreflightMappingInput[] | null>(null)
  // The values-key the applicant ticked for (null = not ticked). The tick holds
  // only while the values on screen are the ones it was given for.
  const [confirmedFor, setConfirmedFor] = useState<string | null>(null)
  // Null = not checked / no lock. A completed review can be BROKEN after the
  // fact — the applicant edits a mapped value on the Forms page — and the
  // execution request would then fail with lock_changed. Check up front.
  const [lockValid, setLockValid] = useState<boolean | null>(null)
  const [lockReasons, setLockReasons] = useState<PreflightInvalidationReason[]>([])
  // Null = unknown (not loaded, or the read failed). Unknown never blocks here:
  // the execution request re-checks it server-side regardless.
  const [approval, setApproval] = useState<ConsultantApprovalRollup | null>(null)
  // Display only: page titles and what the assistant leaves for the applicant.
  // Null (not loaded, failed, or no portal mapping) just shows less.
  const [coverage, setCoverage] = useState<PortalFillCoverage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * `silent`: a background refresh (window regained focus — the applicant was
   * away in the IRCC tab, or waiting for the consultant). It keeps what is on
   * screen and swallows errors rather than flashing a loader.
   */
  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('Not authenticated')
      const t = session.access_token
      const [m, r, a, c] = await Promise.all([
        getPreflightMappings(t, applicationId),
        getActivePreflight(t, applicationId),
        getConsultantApproval(t, applicationId).catch(() => null),
        Promise.resolve()
          .then(() => getPortalFillCoverage(t, applicationId))
          .catch(() => null),
      ])
      let valid: boolean | null = null
      let reasons: PreflightInvalidationReason[] = []
      if (r?.status === 'completed' && r.locked_diff_hash) {
        const v = await validatePreflightLock(t, applicationId, r.id, m)
        valid = v.valid
        reasons = v.reasons ?? []
      }
      setMappings(m)
      setReview(r)
      setLockValid(valid)
      setLockReasons(reasons)
      setApproval(a)
      setCoverage(c ?? null)
    } catch (err) {
      // A deploy restart reads as "GET /preflight/... -> 502" otherwise.
      if (!silent) {
        setError(
          isApiUnavailable(err)
            ? 'VisaAI is restarting — try again in a minute.'
            : err instanceof Error ? err.message : 'Could not load the review',
        )
      }
    } finally {
      if (!silent) setLoading(false)
    }
  }, [applicationId])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    const onFocus = () => { void load(true) }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [load])

  // A value that moved after the user ticked invalidates the tick — they
  // confirmed a different set of values than the one that would now be written.
  // Derived from the CONTENT (and the lock it belongs to), not the array: every
  // reload returns a new array, and resetting on that un-ticked the box each time.
  const valuesKey = useMemo(() => readbackKey(review?.id, mappings), [review?.id, mappings])
  const confirmed = confirmedFor != null && confirmedFor === valuesKey

  const lockedRaw = review?.status === 'completed' && Boolean(review.locked_diff_hash)
  const lockBroken = lockedRaw && lockValid === false
  const locked = lockedRaw && !lockBroken
  const approvalBlock = locked ? approvalBlockText(approval) : null
  const ready = locked && !approvalBlock && !readOnly
  const fillable = mappings == null ? null : mappings.length > 0

  // Any change to the lock, the values, or the tick re-publishes the gate state.
  useEffect(() => {
    onChange({
      confirmed: Boolean(ready && confirmed && mappings && mappings.length > 0),
      reviewId: review?.id ?? null,
      mappings,
      fillable,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, confirmed, mappings, review?.id, fillable])

  if (loading) {
    return <Card variant="tight" className="mb-4"><p className="mono" style={{ fontSize: '0.8rem' }}>Checking the pre-submission review…</p></Card>
  }
  if (error) {
    // getSession() rejects rather than hangs when the sign-in service is
    // unreachable, so this is a recoverable state: offer a retry, not a reload.
    return (
      <Card variant="tight" className="mb-4">
        <p className="mono" style={{ fontSize: '0.8rem', color: 'var(--color-rose, #b53030)' }}>{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void load()}>
          Try again
        </Button>
      </Card>
    )
  }
  if (fillable === false) return null // nothing to auto-fill; parent explains why

  const manual = 'You can still fill the portal yourself — nothing here blocks a manual application.'

  if (lockBroken) {
    const texts = [...new Set((lockReasons.length ? lockReasons : ['provenance_or_mapping_changed']).map(lockReasonText))]
    return (
      <Card variant="tight" className="mb-4">
        <h3 className="type-h4">Changed since your consultant&apos;s review</h3>
        {texts.map((text) => (
          <p key={text} className="mono" style={{ fontSize: '0.8rem', marginTop: 6 }}>{text}</p>
        ))}
        <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>{manual}</p>
      </Card>
    )
  }

  if (!locked) {
    const inReview = review?.status === 'in_review'
    return (
      <Card variant="tight" className="mb-4">
        <h3 className="type-h4">{inReview ? 'Consultant review in progress' : 'Awaiting consultant review'}</h3>
        <p className="mono" style={{ fontSize: '0.8rem', marginTop: 6 }}>
          {inReview
            ? 'Your consultant is reviewing the values auto-fill would enter. Auto-fill unlocks once they complete and lock that review and approve your application.'
            : 'Your consultant has not started the pre-submission review yet. Auto-fill unlocks once they review and lock the values it would enter, and approve your application.'}
        </p>
        <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>{manual}</p>
      </Card>
    )
  }

  if (approvalBlock) {
    return (
      <Card variant="tight" className="mb-4">
        <h3 className="type-h4">Waiting for your consultant&apos;s approval</h3>
        <p className="mono" style={{ fontSize: '0.8rem', marginTop: 6 }}>{approvalBlock}</p>
        <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>{manual}</p>
      </Card>
    )
  }

  const declarations = (mappings ?? []).filter((m) => m.declaration)
  // Declarations are shown once, in their own section above.
  const groups = groupByPage((mappings ?? []).filter((m) => !m.declaration), coverage)
  const left = (coverage?.pages ?? []).filter((p) => p.left.length > 0)

  return (
    <Card variant="tight" className="mb-4">
      <h3 className="type-h4">Confirm what will be entered</h3>
      <p className="mono" style={{ fontSize: '0.75rem', marginTop: 6 }}>
        Your consultant reviewed and locked these {mappings?.length} values. The
        assistant types these and nothing else — you still complete payment and
        submission yourself.
      </p>
      <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 6 }}>
        {isEta
          ? `One launch covers the whole eTA form: keep the assistant's side panel open. After you press the form's Next and new questions appear, click "Fill newly shown questions" in the panel.`
          : <>One launch covers the whole application: keep the assistant&apos;s side panel
        open, and each IRCC page fills as you open it. You press Save and continue.</>}
      </p>

      {declarations.length > 0 && (
        <section
          aria-label="Your declarations"
          style={{ marginTop: 12, padding: '10px 12px', border: '1px solid var(--color-rose, #b53030)', borderRadius: 6 }}
        >
          <p className="type-body" style={{ fontSize: '0.85rem', fontWeight: 600, margin: 0 }}>
            Your declarations to IRCC — read each one
          </p>
          <p className="mono text-muted" style={{ fontSize: '0.72rem', margin: '4px 0 8px' }}>
            These are legal declarations. The assistant enters them exactly as you answered
            them in VisaAI. If any answer is wrong, do not confirm — correct it first.
          </p>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {declarations.map((m) => (
              <li key={`d|${m.fieldKey}|${m.targetField}`} className="mono" style={{ fontSize: '0.75rem', padding: '3px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span>{m.label ?? m.fieldKey}</span>
                <strong>{String(m.mappedValue ?? '')}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.page || 'all'} aria-label={g.title ?? 'Values'} style={{ marginTop: 12 }}>
          {g.title && (
            <p className="eyebrow" style={{ margin: '0 0 4px' }}>{g.title}</p>
          )}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {g.items.map((m) => (
              <li key={`${m.fieldKey}|${m.targetField}`} className="mono" style={{ fontSize: '0.75rem', padding: '3px 0', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <span className="text-muted">{m.label ?? m.fieldKey}</span>
                <strong>{String(m.mappedValue ?? '')}</strong>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {left.length > 0 && (
        <section aria-label="Left for you on IRCC" style={{ marginTop: 16 }}>
          <p className="type-body" style={{ fontSize: '0.85rem', fontWeight: 600, margin: 0 }}>
            Left for you on IRCC
          </p>
          <p className="mono text-muted" style={{ fontSize: '0.72rem', margin: '4px 0 8px' }}>
            The assistant leaves these blank. Answer them yourself on each page.
          </p>
          {left.map((p) => (
            <div key={`left|${p.page}`} style={{ marginBottom: 8 }}>
              <p className="eyebrow" style={{ margin: '0 0 2px' }}>{p.title}</p>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {p.left.map((l) => (
                  <li key={`${p.page}|${l.label}`} className="mono" style={{ fontSize: '0.72rem', padding: '2px 0' }}>
                    {l.label} — <strong>{LEFT_REASON[l.reason]}</strong>
                    {l.note ? <span className="text-muted"> {l.note}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {readOnly ? (
        <p className="mono text-muted" style={{ fontSize: '0.75rem', marginTop: 16 }}>
          Only the applicant can confirm these values and launch auto-fill.
        </p>
      ) : (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 16 }}>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmedFor(e.target.checked ? valuesKey : null)}
          />
          <span className="type-body" style={{ fontSize: '0.85rem' }}>
            {declarations.length > 0
              ? 'These values are correct, including my declarations'
              : 'These values are correct'}
          </span>
        </label>
      )}
    </Card>
  )
}

const LEFT_REASON: Record<PortalFillLeftReason, string> = {
  needs_your_answer: 'needs your answer',
  not_in_profile: 'not in your VisaAI data',
  fill_yourself: 'you fill this',
}

/**
 * Mappings grouped by portal page, in portal order (the coverage order, else
 * the order they arrive in, which is the server's portal order). Page-less
 * mappings form one untitled group.
 */
function groupByPage(
  mappings: PreflightMappingInput[],
  coverage: PortalFillCoverage | null,
): Array<{ page: string; title: string | null; items: PreflightMappingInput[] }> {
  const groups = new Map<string, PreflightMappingInput[]>()
  for (const m of mappings) {
    const key = m.page ?? ''
    const g = groups.get(key)
    if (g) g.push(m)
    else groups.set(key, [m])
  }
  const order = coverage?.pages.map((p) => p.page) ?? []
  const pages = [...groups.keys()].sort((a, b) => {
    const ia = order.indexOf(a)
    const ib = order.indexOf(b)
    if (ia === -1 && ib === -1) return 0
    if (ia === -1) return 1
    if (ib === -1) return -1
    return ia - ib
  })
  return pages.map((page) => ({
    page,
    title: page ? (coverage?.pages.find((p) => p.page === page)?.title ?? page) : null,
    items: groups.get(page)!,
  }))
}
