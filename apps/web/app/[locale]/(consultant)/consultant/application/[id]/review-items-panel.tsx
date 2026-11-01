'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  ConsultantReviewItems,
  PrefilledFormField,
  ReviewItemDecision,
  ReviewItemDecisionRecord,
  ReviewItemKind,
} from '@visaai/types'
import { getSession } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { MarkdownView } from '@/components/ui/markdown-view'
import { useToast } from '@/components/providers/toast-provider'
import {
  decideReviewItem,
  editGeneratedItem,
  getDocumentUrl,
  getReviewItems,
} from '@/lib/api/review-items-client'
import { editPreflightField } from '@/lib/api/preflight-client'
import { notifyPreflightChanged } from '@/lib/preflight-events'

/**
 * Consultant review of everything the applicant uploaded or the app generated.
 *
 *  - Uploads open through a 5-minute signed URL; the API logs each open in the
 *    applicant's document access log. The bucket is never made public.
 *  - Each upload shows what OCR read from it and its verification results.
 *  - Decisions (approve / needs re-upload / reject; approve / request changes
 *    for generated items) are recorded server-side; anything but an approval
 *    needs a note, which is posted to the applicant's conversation.
 *  - Letters render as formatted text and are editable (the API keeps the
 *    previous text and resets the applicant's approval).
 *  - Every application-form field is editable through the same endpoint as the
 *    pre-submission review, so an auto-fill field edit updates the mappings —
 *    and is refused while the review is locked.
 */

const LETTER_LABEL: Record<string, string> = {
  loe: 'Letter of explanation',
  itinerary: 'Travel itinerary',
  cover_letter: 'Cover letter',
}

const DECISION_TEXT: Record<ReviewItemDecision, string> = {
  approved: 'Approved',
  needs_reupload: 'Needs re-upload',
  changes_requested: 'Changes requested',
  rejected: 'Rejected',
}

const tone = (d: ReviewItemDecision) =>
  d === 'approved' ? 'var(--color-emerald, #1a6b40)' : 'var(--color-rose, #b53030)'

const border = '1px solid var(--color-hairline-2, rgba(0,0,0,.15))'
const small: React.CSSProperties = { fontSize: '0.75rem' }
const linkBtn: React.CSSProperties = {
  ...small,
  textDecoration: 'underline',
  background: 'none',
  border: 0,
  cursor: 'pointer',
  padding: 0,
  marginRight: 10,
}

async function token(): Promise<string> {
  const { data: { session } } = await getSession()
  if (!session) throw new Error('Not authenticated')
  return session.access_token
}

function DecisionBadge({ d }: { d: ReviewItemDecisionRecord | null }) {
  if (!d) return <span className="mono text-muted" style={small}>Not reviewed</span>
  return (
    <span className="mono" style={{ ...small, color: tone(d.decision) }}>
      {DECISION_TEXT[d.decision]}
      {d.note ? ` — ${d.note}` : ''}
    </span>
  )
}

/** Approve / other-decision controls; non-approvals require a note. */
function DecisionControls({
  options,
  onDecide,
  busy,
}: {
  options: ReviewItemDecision[]
  onDecide: (decision: ReviewItemDecision, note?: string) => Promise<void>
  busy: boolean
}) {
  const [pending, setPending] = useState<ReviewItemDecision | null>(null)
  const [note, setNote] = useState('')

  if (pending) {
    return (
      <span style={{ display: 'grid', gap: 4, marginTop: 6 }}>
        <span className="mono" style={small}>{DECISION_TEXT[pending]} — the applicant will see this note:</span>
        <textarea
          aria-label="Note for the applicant"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="mono"
          style={{ ...small, padding: 6 }}
        />
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Button
            size="sm"
            disabled={busy || !note.trim()}
            onClick={() => void onDecide(pending, note.trim()).then(() => { setPending(null); setNote('') })}
          >
            Send decision
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setPending(null)}>Cancel</Button>
        </span>
      </span>
    )
  }
  return (
    <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap', marginTop: 6 }}>
      {options.map((o) =>
        o === 'approved' ? (
          <Button key={o} size="sm" disabled={busy} onClick={() => void onDecide('approved')}>Approve</Button>
        ) : (
          <Button key={o} size="sm" variant="secondary" disabled={busy} onClick={() => setPending(o)}>
            {DECISION_TEXT[o]}
          </Button>
        ),
      )}
    </span>
  )
}

export default function ReviewItemsPanel({ applicationId }: { applicationId: string }) {
  const router = useRouter()
  const { toast } = useToast()
  const [items, setItems] = useState<ConsultantReviewItems | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const [letterEdit, setLetterEdit] = useState<{ id: string; text: string; note: string } | null>(null)
  const [fieldEdit, setFieldEdit] = useState<{ key: string; value: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    token()
      .then((t) => getReviewItems(t, applicationId))
      .then(
        (v) => { if (!cancelled) setItems(v) },
        (err: unknown) => {
          if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Could not load the documents for review')
        },
      )
    return () => { cancelled = true }
  }, [applicationId])

  async function act<T>(key: string, fn: (t: string) => Promise<T>, done?: string): Promise<T | undefined> {
    setBusy(key); setError(null)
    try {
      const out = await fn(await token())
      if (done) toast(done, 'success')
      return out
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That action failed')
      return undefined
    } finally { setBusy(null) }
  }

  async function decide(kind: ReviewItemKind, id: string, decision: ReviewItemDecision, note?: string) {
    const out = await act(`decide:${id}`, (t) =>
      decideReviewItem(t, applicationId, note ? { itemKind: kind, itemId: id, decision, note } : { itemKind: kind, itemId: id, decision }),
      decision === 'approved' ? 'Approved' : 'Decision sent to the applicant',
    )
    if (!out) return
    setItems((cur) => {
      if (!cur) return cur
      const d = out.decision
      return {
        ...cur,
        documents: cur.documents.map((x) => (kind === 'document' && x.id === id ? { ...x, decision: d } : x)),
        generated: cur.generated.map((x) => (kind === 'generated' && x.id === id ? { ...x, decision: d } : x)),
        form: cur.form && kind === 'generated' && cur.form.id === id ? { ...cur.form, decision: d } : cur.form,
      }
    })
  }

  async function openDoc(id: string) {
    // Open the tab NOW, inside the click: a window.open() after an await is no
    // longer a user gesture and gets popup-blocked. Point it at the signed URL
    // once it arrives; close it if the URL cannot be issued.
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null // the opened page must not reach back into this one
    const out = await act(`open:${id}`, (t) => getDocumentUrl(t, applicationId, id))
    if (!out) {
      tab?.close()
      return
    }
    if (tab) tab.location.href = out.url
    else window.open(out.url, '_blank', 'noopener,noreferrer') // no tab: let the browser decide
  }

  async function saveLetter() {
    if (!letterEdit) return
    const { id, text, note } = letterEdit
    const out = await act(`letter:${id}`, (t) =>
      editGeneratedItem(t, applicationId, id, text, note.trim() || undefined),
      'Letter saved — the applicant will need to approve it again',
    )
    if (!out) return
    setItems((cur) => cur && { ...cur, generated: cur.generated.map((g) => (g.id === id ? out : g)) })
    setLetterEdit(null)
  }

  async function saveField(key: string) {
    if (!fieldEdit) return
    const value = fieldEdit.value
    const out = await act(`field:${key}`, (t) => editPreflightField(t, applicationId, key, value, undefined), 'Field saved')
    if (!out) return
    setItems((cur) => cur && cur.form ? {
      ...cur,
      form: {
        ...cur.form,
        fields: cur.form.fields.map((f) => (f.key === key ? { ...f, value, source: 'consultant' as const } : f)),
      },
    } : cur)
    setFieldEdit(null)
    notifyPreflightChanged(applicationId) // the edit may have un-ticked a review check
    router.refresh() // the auto-fill review and extracted-fields table read the same data
  }

  if (loadError) {
    return <Card><p className="mono" role="alert" style={{ ...small, color: 'var(--color-rose, #b53030)' }}>{loadError}</p></Card>
  }
  if (!items) return <Card><p className="mono">Loading documents and forms…</p></Card>

  const groups = new Map<string, PrefilledFormField[]>()
  for (const f of items.form?.fields ?? []) {
    const g = f.group ?? 'Other'
    groups.set(g, [...(groups.get(g) ?? []), f])
  }

  return (
    <div style={{ display: 'grid', gap: 20 }}>
      {error && (
        <p className="mono" role="alert" style={{ ...small, color: 'var(--color-rose, #b53030)' }}>{error}</p>
      )}

      <Card>
        <h3 className="type-h4">Uploaded documents ({items.documents.length})</h3>
        {items.documents.length === 0 ? (
          <p className="mono text-muted" style={small}>No documents uploaded yet.</p>
        ) : (
          <ul style={{ display: 'grid', gap: 8, listStyle: 'none', padding: 0, marginTop: 10 }}>
            {items.documents.map((d) => {
              const label = d.name ?? d.type ?? d.id.slice(0, 8)
              return (
                <li key={d.id} style={{ border, borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <span>
                      <span className="sans" style={{ fontWeight: 500 }}>{label}</span>
                      <span className="mono text-muted" style={{ ...small, marginLeft: 8 }}>
                        {d.type ?? '—'} · upload {d.uploadStatus ?? '—'} · OCR {d.ocrStatus ?? '—'}
                      </span>
                    </span>
                    <DecisionBadge d={d.decision} />
                  </div>
                  <div style={{ marginTop: 4 }}>
                    <button type="button" className="mono" style={linkBtn} aria-label={`Open ${label}`} disabled={busy != null} onClick={() => void openDoc(d.id)}>
                      Open
                    </button>
                    <button type="button" className="mono" style={linkBtn} aria-label={`Details for ${label}`} onClick={() => setDetails(details === d.id ? null : d.id)}>
                      {details === d.id ? 'Hide details' : 'Details'}
                    </button>
                  </div>
                  {details === d.id && (
                    <div className="mono" style={{ ...small, marginTop: 6 }}>
                      <strong>Read from this document</strong>
                      {d.extractedFields.length === 0 ? (
                        <p className="text-muted">Nothing extracted.</p>
                      ) : (
                        <ul style={{ margin: '4px 0 8px 16px' }}>
                          {d.extractedFields.map((f) => (
                            <li key={f.fieldKey}>
                              {f.fieldKey}: <span>{f.value ?? '—'}</span>
                              {f.confidence != null && <span className="text-muted"> · {Math.round(f.confidence * 100)}%</span>}
                            </li>
                          ))}
                        </ul>
                      )}
                      <strong>Verification</strong>
                      {d.verifications.length === 0 ? (
                        <p className="text-muted">No verification results.</p>
                      ) : (
                        <ul style={{ margin: '4px 0 0 16px' }}>
                          {d.verifications.map((v, i) => (
                            <li key={i}>{v.verificationType ?? 'check'}: {v.result ?? '—'}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <DecisionControls
                    options={['approved', 'needs_reupload', 'rejected']}
                    busy={busy != null}
                    onDecide={(dec, note) => decide('document', d.id, dec, note)}
                  />
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <h3 className="type-h4">Generated letters ({items.generated.length})</h3>
        {items.generated.length === 0 && <p className="mono text-muted" style={small}>No letters generated yet.</p>}
        {items.generated.map((g) => {
          const title = LETTER_LABEL[g.docType] ?? g.docType
          const editing = letterEdit?.id === g.id
          return (
            <section key={g.id} style={{ borderTop: border, paddingTop: 12, marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <h4 className="type-body" style={{ fontWeight: 600 }}>{title}</h4>
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                  <Badge>{g.approvedByUser ? 'Applicant approved' : 'Awaiting applicant approval'}</Badge>
                  <DecisionBadge d={g.decision} />
                </span>
              </div>
              {editing ? (
                <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                  <textarea
                    aria-label={`${title} text`}
                    value={letterEdit.text}
                    onChange={(e) => setLetterEdit({ ...letterEdit, text: e.target.value })}
                    rows={14}
                    className="mono"
                    style={{ ...small, padding: 8 }}
                  />
                  <input
                    aria-label="Reason for the edit (optional)"
                    placeholder="Reason for the edit (optional)"
                    value={letterEdit.note}
                    onChange={(e) => setLetterEdit({ ...letterEdit, note: e.target.value })}
                    className="mono"
                    style={{ ...small, padding: '4px 6px' }}
                  />
                  <span style={{ display: 'inline-flex', gap: 6 }}>
                    <Button size="sm" aria-label="Save letter" disabled={busy != null || !letterEdit.text.trim()} onClick={() => void saveLetter()}>
                      {busy === `letter:${g.id}` ? 'Saving…' : 'Save'}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => setLetterEdit(null)}>Cancel</Button>
                  </span>
                </div>
              ) : (
                <>
                  <MarkdownView source={g.contentMd} className="sans" />
                  <button type="button" className="mono" style={linkBtn} aria-label={`Edit ${title}`} disabled={busy != null} onClick={() => setLetterEdit({ id: g.id, text: g.contentMd, note: '' })}>
                    Edit
                  </button>
                </>
              )}
              <DecisionControls
                options={['approved', 'changes_requested']}
                busy={busy != null}
                onDecide={(dec, note) => decide('generated', g.id, dec, note)}
              />
            </section>
          )
        })}
      </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h3 className="type-h4">Application form ({items.form?.fields.length ?? 0} fields)</h3>
          {items.form && <DecisionBadge d={items.form.decision} />}
        </div>
        {!items.form ? (
          <p className="mono text-muted" style={small}>The applicant has not generated their application form yet.</p>
        ) : (
          <>
            <p className="mono text-muted" style={{ ...small, marginTop: 4 }}>
              Edits save to the applicant&apos;s form. Fields that portal auto-fill writes also update the
              pre-submission review; they cannot change while that review is locked.
            </p>
            {[...groups].map(([group, fields]) => (
              <section key={group} style={{ marginTop: 12 }}>
                <h4 className="mono" style={{ ...small, fontWeight: 600, textTransform: 'uppercase' }}>{group}</h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: '4px 0 0' }}>
                  {fields.map((f) => (
                    <li key={f.key} className="mono" style={{ ...small, padding: '3px 0', borderBottom: border }}>
                      <span className="text-muted">{f.label}</span>{' '}
                      {fieldEdit?.key === f.key ? (
                        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <input
                            aria-label={`New value for ${f.key}`}
                            value={fieldEdit.value}
                            onChange={(e) => setFieldEdit({ key: f.key, value: e.target.value })}
                            className="mono"
                            style={{ ...small, padding: '2px 6px', minWidth: 180 }}
                            autoFocus
                          />
                          <Button size="sm" aria-label={`Save ${f.key}`} disabled={busy != null} onClick={() => void saveField(f.key)}>
                            {busy === `field:${f.key}` ? 'Saving…' : 'Save'}
                          </Button>
                          <Button size="sm" variant="secondary" disabled={busy != null} onClick={() => setFieldEdit(null)}>Cancel</Button>
                        </span>
                      ) : (
                        <>
                          <strong>{f.value || '—'}</strong>
                          {f.source === 'consultant' && <span className="text-muted"> · edited by consultant</span>}
                          {f.needsReview && <span style={{ color: 'var(--color-rose, #b53030)' }}> · needs review</span>}
                          <button
                            type="button"
                            className="mono"
                            style={{ ...linkBtn, marginLeft: 8 }}
                            aria-label={`Edit ${f.key}`}
                            disabled={busy != null || fieldEdit != null}
                            onClick={() => setFieldEdit({ key: f.key, value: f.value })}
                          >
                            Edit
                          </button>
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
            <DecisionControls
              options={['approved', 'changes_requested']}
              busy={busy != null}
              onDecide={(dec, note) => decide('generated', items.form!.id, dec, note)}
            />
          </>
        )}
      </Card>
    </div>
  )
}
