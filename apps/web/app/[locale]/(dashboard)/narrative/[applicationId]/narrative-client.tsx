'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslations } from 'next-intl'
import { ALL_LETTER_TYPES, LETTER_TYPES, type LetterType, type PrefilledFormField } from '@visaai/types'
import { Link } from '@/i18n/navigation'
import { getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/providers/toast-provider'
import { handlePlanError } from '@/lib/plan-error'
import { MarkdownView } from '@/components/ui/markdown-view'

type DocType = LetterType
const FORM_TYPE = 'prefilled_form_json'

interface GeneratedDocument {
  id: string
  doc_type: string
  content_md: string
  approved_by_user: boolean
  generated_at: string
}

function isLetter(d: GeneratedDocument): d is GeneratedDocument & { doc_type: DocType } {
  return (LETTER_TYPES as readonly string[]).includes(d.doc_type)
}

/** The prefilled form's fields, or null when the stored JSON is unreadable. */
function formFields(raw: string): PrefilledFormField[] | null {
  try {
    const parsed = JSON.parse(raw) as { fields?: unknown }
    return Array.isArray(parsed.fields) ? (parsed.fields as PrefilledFormField[]) : null
  } catch {
    return null
  }
}

/** Fields grouped in first-seen group order. */
function groupFields(fields: PrefilledFormField[]): Array<[string, PrefilledFormField[]]> {
  const groups = new Map<string, PrefilledFormField[]>()
  for (const f of fields) {
    const g = f.group?.trim() || ''
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  return [...groups]
}

export default function NarrativeClient({
  applicationId,
  offeredTypes = ALL_LETTER_TYPES,
}: {
  applicationId: string
  /** Letters this route uses, in order (@visaai/types route-letters). Default: the original three. */
  offeredTypes?: readonly DocType[]
}) {
  const t = useTranslations('narrative')
  const DOC_LABELS: Record<DocType, string> = {
    loe: t('docLoe'),
    itinerary: t('docItinerary'),
    cover_letter: t('docCoverLetter'),
    invitation_letter: t('docInvitation'),
  }
  const { toast } = useToast()
  const [documents, setDocuments] = useState<GeneratedDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState<DocType | null>(null)
  // A Generate click while another document is generating is queued (and
  // shown as queued) — never silently dropped. Runs in click order.
  const [queue, setQueueState] = useState<DocType[]>([])
  const queueRef = useRef<DocType[]>([])
  const setQueue = (q: DocType[]) => {
    queueRef.current = q
    setQueueState(q)
  }
  const [editing, setEditing] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loadTrigger, setLoadTrigger] = useState(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { session } } = await getSession()
      if (!session || cancelled) return

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/narrative/${applicationId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok || cancelled) return

      const data = await res.json() as GeneratedDocument[]
      if (!cancelled) {
        setDocuments(data)
        setLoading(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [applicationId, loadTrigger])

  async function runGenerate(docType: DocType): Promise<void> {
    setGenerating(docType)
    setError(null)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/narrative/${applicationId}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ docType }),
      })
      if (await handlePlanError(res, applicationId, toast)) {
        // The plan blocks every generation, so the queued ones would fail too.
        setQueue([])
        setGenerating(null)
        return
      }
      if (!res.ok) throw new Error(t('errGenerate'))
      toast(t('generatedToast', { doc: DOC_LABELS[docType] }), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errGenerate')
      setError(msg)
      toast(msg, 'error')
    }
    // Start the next queued document, in click order.
    const [next, ...rest] = queueRef.current
    setQueue(rest)
    if (next) return runGenerate(next)
    setGenerating(null)
  }

  function handleGenerate(docType: DocType) {
    if (generating === null) {
      void runGenerate(docType)
      return
    }
    if (generating === docType || queueRef.current.includes(docType)) return
    setQueue([...queueRef.current, docType])
  }

  async function postDocument(documentId: string, action: 'approve' | 'save', body: unknown) {
    const { data: { session } } = await getSession()
    if (!session) throw new Error(t('notAuthenticated'))
    return fetch(`${process.env.NEXT_PUBLIC_API_URL}/narrative/document/${documentId}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(body),
    })
  }

  async function handleSaveDraft(documentId: string, content: string) {
    setError(null)
    try {
      const res = await postDocument(documentId, 'save', { content })
      if (!res.ok) throw new Error(t('errSave'))
      setEditing(null)
      toast(t('savedToast'), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errSave')
      setError(msg)
      toast(msg, 'error')
    }
  }

  async function handleApprove(documentId: string, content?: string) {
    setError(null)
    try {
      const res = await postDocument(
        documentId,
        'approve',
        content === undefined ? {} : { editedContent: content },
      )
      if (!res.ok) throw new Error(t('errApprove'))
      setEditing(null)
      toast(t('approvedToast'), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errApprove')
      setError(msg)
      toast(msg, 'error')
    }
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-[18px] font-semibold tracking-[-0.45px] text-deep-black">
          {t('title')}
        </h1>
        <p className="text-[14px] text-midtone-gray mt-0.5">
          {t('subtitle')}
        </p>
      </div>

      {error && (
        <p className="mb-4 text-[13px] text-callout-red" role="alert">{error}</p>
      )}

      {offeredTypes.length === 0 && (
        <p className="mb-4 text-[13px] text-midtone-gray" role="note" data-testid="no-letters-for-route">
          {t('noLettersForRoute')}
        </p>
      )}

      <div className="flex gap-2 mb-4 flex-wrap">
        {offeredTypes.map(docType => {
          const isQueued = queue.includes(docType)
          const waitingFor = isQueued
            ? (queue.indexOf(docType) === 0 ? generating : queue[queue.indexOf(docType) - 1])
            : null
          return (
            <Button
              key={docType}
              onClick={() => handleGenerate(docType)}
              disabled={generating === docType || isQueued}
              aria-busy={generating === docType}
            >
              {generating === docType
                ? t('generatingDoc', { doc: DOC_LABELS[docType] })
                : isQueued && waitingFor
                  ? t('queuedDoc', { doc: DOC_LABELS[docType], waitingFor: DOC_LABELS[waitingFor] })
                  : `+ ${DOC_LABELS[docType]}`}
            </Button>
          )
        })}
      </div>
      {queue.length > 0 && generating && (
        <p className="mb-4 text-[13px] text-midtone-gray" role="status">
          {t('queueHint', { doc: DOC_LABELS[generating] })}
        </p>
      )}

      <div className="alert alert-warning mb-6" role="note">
        <span>
          These documents are AI-generated drafts. Read every line, edit anything that is not
          accurate or true for you, and confirm it reflects your real circumstances before you use
          it. VisaAI does not provide legal advice. For review of your specific case, a licensed
          immigration consultant (RCIC) can help.
        </span>
      </div>

      {loading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="bg-canvas-white rounded-[14px] p-4" style={{ boxShadow: 'var(--shadow-card)' }}>
              <div className="flex items-center justify-between mb-3">
                <Skeleton className="h-4 w-40" />
                <div className="flex gap-2">
                  <Skeleton className="h-7 w-12 rounded-full" />
                  <Skeleton className="h-7 w-16 rounded-[10px]" />
                </div>
              </div>
              <Skeleton className="h-32 w-full" />
            </div>
          ))}
        </div>
      ) : documents.length === 0 && offeredTypes.length === 0 ? null : documents.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[14px] text-midtone-gray">{t('noDocs')}</p>
          <p className="text-[12px] text-midtone-gray mt-1">
            {t('noDocsHint')}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {documents.filter(isLetter).map(doc => (
            <Card key={doc.id}>
              <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-medium text-deep-black">{DOC_LABELS[doc.doc_type]}</p>
                  {doc.approved_by_user
                    ? <Badge variant="inverse">{t('approved')}</Badge>
                    : <Badge variant="amber">{t('statusDraft')}</Badge>}
                </div>
                <div className="flex gap-2">
                  {editing === doc.id ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>{t('cancel')}</Button>
                      <Button size="sm" variant="ghost" onClick={() => handleSaveDraft(doc.id, editContent)}>{t('saveDraft')}</Button>
                      <Button size="sm" onClick={() => handleApprove(doc.id, editContent)}>{t('saveApprove')}</Button>
                    </>
                  ) : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => { setEditing(doc.id); setEditContent(doc.content_md) }}
                      >
                        {t('edit')}
                      </Button>
                      {!doc.approved_by_user && (
                        <Button size="sm" onClick={() => handleApprove(doc.id)}>
                          {t('approve')}
                        </Button>
                      )}
                    </>
                  )}
                </div>
              </div>
              {!doc.approved_by_user && editing !== doc.id && (
                <p className="mb-3 text-[12px] text-midtone-gray">{t('draftHint')}</p>
              )}
              {editing === doc.id ? (
                <textarea
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  aria-label={t('editAria', { doc: DOC_LABELS[doc.doc_type] })}
                  className="w-full h-[400px] text-[13px] font-mono leading-[1.5] text-rich-black border border-subtle-ash rounded-[10px] p-3 focus:outline-none focus-visible:border-rich-black focus-visible:ring-2 focus-visible:ring-deep-black/15 transition-[border-color,box-shadow]"
                />
              ) : (
                <MarkdownView source={doc.content_md} className="text-[13px] leading-[1.6] text-rich-black" />
              )}
            </Card>
          ))}
          {documents.filter(d => d.doc_type === FORM_TYPE).map(doc => {
            const fields = formFields(doc.content_md)
            return (
              <Card key={doc.id} data-testid="generated-form">
                <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <p className="text-[14px] font-medium text-deep-black">{t('docForm')}</p>
                    {doc.approved_by_user
                      ? <Badge variant="inverse">{t('approved')}</Badge>
                      : <Badge variant="amber">{t('statusDraft')}</Badge>}
                  </div>
                  <Link href={`/prefill/${applicationId}`} className="text-[13px] underline">
                    {t('formOpen')}
                  </Link>
                </div>
                {fields === null ? (
                  <p className="text-[13px] text-midtone-gray">{t('formUnreadable')}</p>
                ) : (
                  groupFields(fields).map(([group, rows]) => (
                    <div key={group || '_'} className="mb-3">
                      {group && <p className="text-[12px] font-medium text-midtone-gray mb-1">{group}</p>}
                      <dl className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-4 gap-y-1 text-[13px]">
                        {rows.map(f => (
                          <div key={f.key} className="contents">
                            <dt className="text-midtone-gray">{f.label || f.key}</dt>
                            <dd className="text-rich-black break-words">
                              {f.value?.trim() ? f.value : <span className="text-midtone-gray">{t('formEmpty')}</span>}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))
                )}
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
