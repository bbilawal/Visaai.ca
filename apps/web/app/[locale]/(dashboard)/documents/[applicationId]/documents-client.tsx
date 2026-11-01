'use client'

import { refreshChecklistStay } from '@/lib/stay-mentions'
import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/i18n/navigation'
import { createClient, getSession } from '@/lib/supabase/client'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/providers/toast-provider'
import { handlePlanError } from '@/lib/plan-error'
import { getFormHref } from '@/lib/form-link'
import { groupByOwner, specsOf, isForm as isFormItem } from '@/lib/checklist-grouping'
import { ExternalLinkIcon, LockIcon, ShieldIcon, TrashIcon } from '@/components/ui/icons'
import { OfficialForms } from '@/components/forms/official-forms'
import { OfficialDocuments } from './official-documents'
import { formCodeKey, withoutOfficialDuplicates } from '@/lib/official-form-dedupe'
import { DocumentsProgress } from './documents-progress'
import { documentsCompletion } from '@visaai/types'
import { isOptionalItem, nextUploadItem, slotIsVerified } from '@/lib/required-docs'
import type { ChecklistItem } from '@visaai/types'
import { latestVerifications } from '@/lib/latest-verifications'
import { slotMismatchOf } from '@/lib/slot-mismatch'
import { confirmHolder, holderConfirmationOf, holderMismatchOf, identityResultOf } from '@/lib/holder-mismatch'
import { attentionOf, canReread, requestReread } from '@/lib/document-reread'
import {
  openRequestIn,
  requestOf,
  withConsultantRequests,
  type ConsultantDocumentReview,
  type ConsultantRequest,
} from '@/lib/consultant-requests'

interface AccessLogEntry {
  id: string
  document_id: string
  action: 'upload' | 'view' | 'download' | 'delete' | 'ocr'
  occurred_at: string
  documents?: { file_name: string } | null
}

interface DocumentRecord {
  id: string
  file_name: string
  ocr_status: string
  upload_status: string
  created_at: string
  checklist_item_id: string | null
  document_verifications: Array<{
    id: string
    verification_type: string
    result: string
    details_json: Record<string, unknown>
    verified_at?: string | null
  }>
  /** The consultant's latest decision on this file (decision, note, date). */
  consultant_review?: ConsultantDocumentReview | null
}

interface CrossVerification {
  id: string
  field_compared: string
  result: string
  details_json: Record<string, unknown>
}

interface Props {
  applicationId: string
  initialChecklist: ChecklistItem[]
  country?: string | null
  /** Stay length from the current trip dates; refreshes stale figures in checklist notes. */
  stayDays?: number | null
}

const STATUS_COLORS: Record<string, string> = {
  pass: 'text-success-green',
  warn: 'text-[#b45309]',
  fail: 'text-callout-red',
  match: 'text-success-green',
  mismatch: 'text-callout-red',
  needs_confirmation: 'text-[#b45309]',
  not_yours: 'text-callout-red',
}

/** One line of the NDJSON rebuild stream. */
type StreamMessage =
  | {
      type: 'items'
      items: Array<{
        document_type: string
        label: string
        required?: boolean
        added_reason?: string | null
        meta?: ChecklistItem['meta']
      }>
    }
  | { type: 'done'; items: ChecklistItem[] }
  | { type: 'error'; message: string }

/** A row the model has written but the database has not stored yet. Takes the
 *  id alone so it works on the narrower shape `UploadSlot` accepts. */
const isPreview = (item: { id: string }) => item.id.startsWith('preview:')

const ACCEPTED_TYPES = '.jpg,.jpeg,.png,.heic,.pdf'
const MAX_FILE_SIZE_MB = 50
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

export default function DocumentsClient({ applicationId, initialChecklist, country, stayDays = null }: Props) {
  const t = useTranslations('documents')
  const { toast } = useToast()
  const [documents, setDocuments] = useState<DocumentRecord[]>([])
  const [crossVerifications, setCrossVerifications] = useState<CrossVerification[]>([])
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() => refreshChecklistStay(initialChecklist, stayDays))
  // Read through a ref inside the load/rebuild effects: adding the prop to
  // their deps would re-run the (model-backed) checklist rebuild.
  const stayDaysRef = useRef(stayDays)
  stayDaysRef.current = stayDays
  const [uploadingItemId, setUploadingItemId] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadTrigger, setLoadTrigger] = useState(0)
  const [accessLog, setAccessLog] = useState<AccessLogEntry[]>([])
  const [showPrivacy, setShowPrivacy] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [rereadingId, setRereadingId] = useState<string | null>(null)
  // Official sections stay hidden until every required document is verified —
  // or until we learn a prefill already exists from a previous visit (below),
  // which keeps the material reachable for a returning applicant even if a
  // checklist item has since regressed.
  const [hasPrefill, setHasPrefill] = useState(false)
  // Form codes the two official sections below already hand the applicant,
  // keyed per section so one reload never wipes the other's codes.
  const [officialCodes, setOfficialCodes] = useState<{ forms: string[]; documents: string[] }>({ forms: [], documents: [] })
  const handleOfficialFormCodes = useCallback((codes: string[]) => {
    setOfficialCodes(prev => ({ ...prev, forms: codes }))
  }, [])
  const handleOfficialDocumentCodes = useCallback((codes: string[]) => {
    setOfficialCodes(prev => ({ ...prev, documents: codes }))
  }, [])

  // Failure is silent on purpose: the worst case is the reference sections
  // staying hidden until the checklist completes, not a broken page.
  useEffect(() => {
    let cancelled = false
    async function loadExisting() {
      try {
        const { data: { session } } = await getSession()
        if (!session || cancelled) return
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/prefill/${applicationId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        })
        if (!res.ok || cancelled) return
        const data = await res.json() as { payload: unknown | null }
        if (!cancelled && data.payload) setHasPrefill(true)
      } catch {
        // Non-fatal — see above.
      }
    }
    void loadExisting()
    return () => { cancelled = true }
  }, [applicationId])

  /**
   * Build the checklist, once, on arrival.
   *
   * The interview used to do this on every single turn — a structured
   * generation measured at 9.4–10.0s, rebuilding a list nobody was reading
   * while they were still answering questions. This page is where the list is
   * read, so this is where it is made.
   *
   * Deliberately fire-and-forget against the server-rendered list: the page
   * already shows whatever was stored, and this only ever adds to it. A failed
   * rebuild leaves the applicant with the documents they had rather than an
   * error where their checklist should be.
   */
  const [rebuilt, setRebuilt] = useState(false)
  /**
   * Items the model has finished writing but that are not stored yet.
   *
   * The generation runs 9-21s and is the ONLY source of a checklist for a route
   * whose registry has no document-kind requirements — Express Entry among
   * them — so an applicant who had just chosen one sat in front of an empty
   * vault for all of it. These render as they arrive and are dropped the moment
   * the authoritative list lands.
   */
  const [previews, setPreviews] = useState<ChecklistItem[]>([])
  useEffect(() => {
    let cancelled = false
    /**
     * Retried once, because failing here is not a cosmetic loss.
     *
     * On failure the `finally` sets `rebuilt`, and an empty checklist then
     * renders "complete the AI intake first" — a dead end on a page the
     * applicant reached correctly, which only a manual reload escapes.
     *
     * Observed live on 2026-09-04: `TypeError: Failed to fetch`, twice, while
     * the API was restarting mid-deploy. Any brief interruption does it — a
     * deploy, a dropped connection, a sleeping laptop — and the applicant is
     * left looking at a vault that says they have not done something they have
     * already done.
     *
     * One retry after a short pause, not a loop: the rebuild can cost a model
     * call, so retrying it repeatedly would be expensive as well as rude to a
     * server that may be the thing struggling.
     */
    async function attempt(): Promise<ChecklistItem[]> {
      const { data: { session } } = await getSession()
      if (!session) throw new Error('no session')
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/intake/applications/${applicationId}/checklist/rebuild`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            // Ask for the list as it is written. The server answers with the
            // single JSON array if it does not do this, so an older API — or a
            // proxy that strips the streaming — costs the progressive paint and
            // nothing else.
            Accept: 'application/x-ndjson',
          },
        },
      )
      if (!res.ok) throw new Error(`rebuild failed (${res.status})`)

      const streaming = res.headers
        .get('content-type')
        ?.includes('application/x-ndjson')
      if (!streaming || !res.body) {
        return (await res.json()) as ChecklistItem[]
      }

      // A fresh attempt owns the previews: a retry must not leave the first
      // attempt's half-list on screen underneath its own.
      if (!cancelled) setPreviews([])

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let final: ChecklistItem[] | null = null
      const shown: ChecklistItem[] = []

      const handle = (line: string) => {
        if (!line.trim()) return
        let msg: StreamMessage
        try {
          msg = JSON.parse(line) as StreamMessage
        } catch {
          // A truncated line is not worth failing a rebuild over.
          return
        }
        if (msg.type === 'items') {
          for (const item of msg.items) {
            shown.push({
              // No database row exists yet — these are what the model has
              // written so far, not what was stored. The prefix is what marks
              // them un-uploadable until the authoritative list lands.
              id: `preview:${item.document_type}`,
              application_id: applicationId,
              document_type: item.document_type,
              label: item.label,
              required: item.required ?? true,
              status: 'missing',
              added_reason: item.added_reason ?? null,
              meta: item.meta ?? null,
            })
          }
          if (!cancelled) setPreviews(refreshChecklistStay([...shown], stayDaysRef.current))
        } else if (msg.type === 'done') {
          final = msg.items
        } else if (msg.type === 'error') {
          throw new Error(msg.message)
        }
      }

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        // The last piece is whatever arrived mid-line; hold it for the next read.
        buffer = lines.pop() ?? ''
        for (const line of lines) handle(line)
      }
      handle(buffer)

      // No terminator means the connection died mid-generation. Previews are
      // not a checklist, so say so and let the retry above have a go.
      if (!final) throw new Error('rebuild stream ended without a result')
      return final
    }

    async function rebuild() {
      try {
        let items: ChecklistItem[]
        try {
          items = await attempt()
        } catch (first) {
          if (cancelled) return
          await new Promise(resolve => setTimeout(resolve, 1500))
          if (cancelled) return
          console.warn('[documents] checklist rebuild retrying after:', first)
          items = await attempt()
        }
        if (!cancelled && Array.isArray(items)) {
          setChecklist(refreshChecklistStay(items, stayDaysRef.current))
          setPreviews([])
        }
      } catch (err) {
        console.warn('[documents] checklist rebuild skipped:', err)
      } finally {
        if (!cancelled) setRebuilt(true)
      }
    }
    void rebuild()
    return () => { cancelled = true }
  }, [applicationId])

  // Refetch the checklist on mount, on tab focus, and whenever the documents
  // reload trigger fires — so items added elsewhere (the rebuild above, VRI
  // "Use these documents") show up without a hard page refresh.
  useEffect(() => {
    let cancelled = false
    async function loadChecklist() {
      const supabase = createClient()
      const { data } = await supabase
        .from('checklist_items')
        .select('*')
        .eq('application_id', applicationId)
        .order('added_reason')
      if (!cancelled && data) setChecklist(refreshChecklistStay(data as ChecklistItem[], stayDaysRef.current))
    }
    void loadChecklist()
    const onFocus = () => { void loadChecklist() }
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
    }
  }, [applicationId, loadTrigger])

  // Load documents whenever loadTrigger changes
  useEffect(() => {
    let cancelled = false

    async function load() {
      const { data: { session } } = await getSession()
      if (!session || cancelled) return

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${applicationId}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok || cancelled) return

      const data = await res.json() as { documents: DocumentRecord[]; crossVerifications: CrossVerification[] }
      if (!cancelled) {
        setDocuments(data.documents)
        setCrossVerifications(data.crossVerifications)
        setLoaded(true)
      }
    }

    load()
    return () => { cancelled = true }
  }, [applicationId, loadTrigger])

  // Poll every 5s while any document is still processing
  useEffect(() => {
    const hasPending = documents.some(d => d.ocr_status === 'pending')
    if (!hasPending) return
    const interval = setInterval(() => setLoadTrigger(tr => tr + 1), 5000)
    return () => clearInterval(interval)
  }, [documents])

  // Pull the audit log only when the privacy panel is opened — saves a round
  // trip for users who never expand it.
  useEffect(() => {
    if (!showPrivacy) return
    let cancelled = false
    async function load() {
      const { data: { session } } = await getSession()
      if (!session || cancelled) return
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/${applicationId}/access-log`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok || cancelled) return
      const data = await res.json() as { logs: AccessLogEntry[] }
      if (!cancelled) setAccessLog(data.logs)
    }
    void load()
    return () => { cancelled = true }
  }, [showPrivacy, applicationId, loadTrigger])

  const handleDelete = useCallback(async (doc: DocumentRecord) => {
    if (!window.confirm(t('confirmDelete', { name: doc.file_name }))) return
    setDeletingId(doc.id)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/documents/item/${doc.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
      if (!res.ok) throw new Error(t('errDelete'))
      toast(t('documentDeleted'), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      toast(err instanceof Error ? err.message : t('errDelete'), 'error')
    } finally {
      setDeletingId(null)
    }
  }, [toast, t])

  // Re-read a stored document with the current extraction (e.g. after a
  // parser fix). The card shows "processing" again until the new read lands.
  const handleReread = useCallback(async (doc: DocumentRecord) => {
    setRereadingId(doc.id)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))
      const result = await requestReread(process.env.NEXT_PUBLIC_API_URL, session.access_token, doc.id)
      toast(result === 'already_queued' ? t('rereadAlreadyQueued') : t('rereadQueued'), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      toast(
        code === 'rate_limited' ? t('rereadRateLimited') : code === 'failed' || !code ? t('errReread') : code,
        'error',
      )
    } finally {
      setRereadingId(null)
    }
  }, [toast, t])

  // "This is my passport": the applicant confirms a passport held because its
  // name doesn't match the name they gave. The API records it and re-syncs
  // the profile; the reload shows the confirmation in place of the hold.
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const handleConfirmHolder = useCallback(async (doc: DocumentRecord) => {
    setConfirmingId(doc.id)
    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))
      await confirmHolder(process.env.NEXT_PUBLIC_API_URL, session.access_token, doc.id)
      toast(t('holderConfirmedToast'), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      const code = err instanceof Error ? err.message : ''
      toast(
        code === 'rate_limited' ? t('rereadRateLimited') : code === 'not_confirmable' ? t('holderNotConfirmable') : code === 'unavailable' ? t('holderConfirmUnavailable') : code === 'failed' || !code ? t('holderConfirmFailed') : code,
        'error',
      )
    } finally {
      setConfirmingId(null)
    }
  }, [toast, t])

  // Upload a file and link it to a specific checklist item. `itemKey` is the
  // checklist item id, or 'other' for an unassigned additional upload.
  const handleFileUpload = useCallback(async (file: File, itemKey: string, checklistItemId?: string) => {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast(t('fileTooLarge', { max: MAX_FILE_SIZE_MB }), 'error')
      return
    }

    const allowed = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf']
    if (!allowed.includes(file.type) && !file.name.match(/\.(jpg|jpeg|png|heic|heif|pdf)$/i)) {
      toast(t('unsupportedType'), 'error')
      return
    }

    setUploadingItemId(itemKey)

    try {
      const { data: { session } } = await getSession()
      if (!session) throw new Error(t('notAuthenticated'))

      // Step 1: Get presigned upload URL
      const presignRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/documents/presign/${applicationId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ fileName: file.name, mimeType: file.type }),
        }
      )
      if (await handlePlanError(presignRes, applicationId, toast)) return
      if (!presignRes.ok) throw new Error(t('errUploadUrl'))
      const { uploadUrl, storagePath } = await presignRes.json() as { uploadUrl: string; storagePath: string; token: string }

      // Step 2: Upload directly to Supabase Storage
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': file.type },
        body: file,
      })
      if (!uploadRes.ok) throw new Error(t('errUpload'))

      // Step 3: Register document + dispatch OCR job, linked to its checklist item
      const registerRes = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/documents/register/${applicationId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ storagePath, mimeType: file.type, fileName: file.name, checklistItemId }),
        }
      )
      if (!registerRes.ok) throw new Error(t('errRegister'))

      toast(t('uploadedProcessing'), 'success')
      setLoadTrigger(tr => tr + 1)
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('errUpload')
      toast(msg, 'error')
    } finally {
      setUploadingItemId(null)
    }
  }, [applicationId, toast, t])

  const mismatches = crossVerifications.filter(cv => cv.result === 'mismatch')

  // Index uploaded documents by the checklist item they belong to.
  const docsByItem = new Map<string, DocumentRecord[]>()
  const unlinkedDocs: DocumentRecord[] = []
  for (const doc of documents) {
    if (doc.checklist_item_id) {
      const list = docsByItem.get(doc.checklist_item_id) ?? []
      list.push(doc)
      docsByItem.set(doc.checklist_item_id, list)
    } else {
      unlinkedDocs.push(doc)
    }
  }

  // A slot whose document the consultant sent back is not verified, whatever
  // its stored status says, until a replacement is uploaded into it. The
  // server applies the same rule (open-document-requests.ts: progress and the
  // auto-generated prefill), so the count below still matches it.
  const viewChecklist = withConsultantRequests(checklist, documents)
  const groups = groupByOwner(viewChecklist)
  const multiParty = groups.length > 1

  // Same rule the API uses to auto-generate (documentsCompletion in
  // @visaai/types), so this page never claims ready while the server disagrees.
  const completion = documentsCompletion(viewChecklist)
  const nextItem = nextUploadItem(viewChecklist)
  const officialUnlocked = completion.complete || hasPrefill

  // A form the official sections already list is not repeated as a "Required
  // Forms" slot. Only while those sections are actually rendered: before they
  // unlock, the slot is the applicant's only pointer to the form.
  const officialKeys = new Set(
    officialUnlocked && loaded
      ? [...officialCodes.forms, ...officialCodes.documents].map(formCodeKey).filter(Boolean)
      : [],
  )
  const visibleGroups = groups.map(group => ({
    ...group,
    forms: withoutOfficialDuplicates(group.forms, officialKeys, item => (docsByItem.get(item.id)?.length ?? 0) > 0),
  }))

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h1 className="text-[18px] font-semibold tracking-[-0.45px] text-deep-black flex items-center gap-2">
            {t('title')}
            <span
              className="inline-flex items-center gap-1 text-[11px] font-medium text-success-green bg-success-green/10 px-2 py-0.5 rounded-full"
              title="Files are encrypted in transit and at rest, scoped to your account."
            >
              <LockIcon size={11} />
              {t('privateEncrypted')}
            </span>
          </h1>
          <p className="text-[14px] text-midtone-gray mt-0.5">
            {t('subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setShowPrivacy(v => !v)} variant="ghost">
            {showPrivacy ? t('hide') : t('privacySecurity')}
          </Button>
          <Button onClick={() => setLoadTrigger(tr => tr + 1)} variant="ghost">{t('refresh')}</Button>
        </div>
      </div>

      {showPrivacy && (
        <Card className="mb-4">
          <div className="flex items-start gap-3">
            <span className="text-rich-black mt-0.5"><ShieldIcon size={18} /></span>
            <div className="flex-1">
              <p className="text-[14px] font-medium text-deep-black">Privacy &amp; security</p>
              <ul className="mt-2 flex flex-col gap-1.5 text-[13px] text-rich-black">
                <li>
                  <span className="font-medium">Encrypted in transit and at rest.</span>{' '}
                  Files travel over TLS and sit in your private bucket, only readable by your signed-in account.
                </li>
                <li>
                  <span className="font-medium">Row-level access control.</span>{' '}
                  Every database query is scoped to your user id — no other VisaAI customer can see your documents or extracted fields.
                </li>
                <li>
                  <span className="font-medium">Delete anytime.</span>{' '}
                  Use the trash icon on any document; the file is removed from storage and the verification rows go with it.
                </li>
                <li>
                  <span className="font-medium">AI provider.</span>{' '}
                  OCR runs through our AI provider under their enterprise no-training agreement — your documents are not used to train models.
                </li>
                <li>
                  <span className="font-medium">Access log.</span>{' '}
                  Every upload, view, and delete is recorded below so you can audit who touched what.
                </li>
              </ul>

              <p className="mt-4 text-[12px] font-medium text-deep-black">Recent activity</p>
              {accessLog.length === 0 ? (
                <p className="text-[12px] text-midtone-gray mt-1">No activity recorded yet.</p>
              ) : (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {accessLog.map(entry => (
                    <li key={entry.id} className="text-[12px] text-midtone-gray flex items-center gap-2">
                      <span className="font-mono text-rich-black">{new Date(entry.occurred_at).toLocaleString()}</span>
                      <span className="capitalize">{entry.action}</span>
                      {entry.documents?.file_name && <span className="text-midtone-gray">· {entry.documents.file_name}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* Identity mismatch alert */}
      {mismatches.length > 0 && (
        <Card className="mb-4 border border-callout-red" role="alert">
          <p className="text-[14px] font-medium text-callout-red mb-2">
            ⚠ {t('mismatchTitle')}
          </p>
          <div className="flex flex-col gap-3">
            {mismatches.map(cv => {
              const d = cv.details_json as {
                value_a?: string
                value_b?: string
                doc_type_a?: string
                doc_type_b?: string
                suggestion?: string
              }
              return (
                <div key={cv.id}>
                  <p className="text-[13px] text-rich-black">
                    <span className="font-medium capitalize">
                      {cv.field_compared.replace(/_/g, ' ')}
                    </span>
                    : &quot;{d.value_a}&quot; ({d.doc_type_a}) ≠ &quot;{d.value_b}&quot; ({d.doc_type_b})
                  </p>
                  {d.suggestion && (
                    <p className="text-[12px] text-midtone-gray mt-0.5">
                      <span className="font-medium text-rich-black">{t('suggestionLabel')} </span>
                      {d.suggestion}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* What the applicant must DO leads the page. The official reference
          material used to sit here, above the fold, pushing their own task
          out of sight. It now follows the uploads. */}
      <DocumentsProgress
        done={completion.done}
        total={completion.total}
        nextLabel={nextItem?.label ?? null}
      />

      {/* The checklist is assembled on arrival now, not during the interview,
          so an empty list before `rebuilt` means "still being written" — not
          "you have nothing". Showing the finish-the-interview prompt in that
          window would send an applicant back to a page they just left. */}
      {checklist.length === 0 && previews.length > 0 ? (
        // The list as it is being written. Read-only: there is nothing to
        // upload against until these rows exist.
        <div className="flex flex-col gap-3">
          {previews.map(item => (
            <UploadSlot
              key={item.id}
              item={item}
              docs={[]}
              country={country}
              uploading={false}
              deletingId={null}
              onUpload={() => {}}
              onDelete={() => {}}
            />
          ))}
        </div>
      ) : (!loaded || !rebuilt) && checklist.length === 0 ? (
        <div className="flex flex-col gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-[14px]" />
          ))}
        </div>
      ) : checklist.length === 0 ? (
        <Card>
          <p className="text-[14px] text-midtone-gray py-6 text-center">
            {t('completeIntakeFirst')}
          </p>
          <div className="flex justify-center">
            <Link href={`/intake/${applicationId}`}>
              <Button variant="ghost">{t('goToIntake')} <span className="inline-block rtl:-scale-x-100" aria-hidden>→</span></Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="flex flex-col gap-8">
          {visibleGroups.map(group => (
            <section key={group.owner}>
              {multiParty && (
                <div className="flex items-center gap-3 mb-4">
                  <h2 className="text-[15px] font-semibold text-deep-black">{group.heading}</h2>
                  {(() => {
                    const n = group.forms.length + group.documents.length + group.strengthening.length
                    return <Badge variant="neutral">{t('itemCount', { count: n })}</Badge>
                  })()}
                  <span className="h-px flex-1 bg-subtle-ash" />
                </div>
              )}

              {group.forms.length > 0 && (
                <>
                  <p className="text-[13px] font-medium text-midtone-gray uppercase tracking-[0.5px] mb-2">{t('requiredForms')}</p>
                  <div className="flex flex-col gap-3 mb-6">
                    {group.forms.map(item => (
                      <UploadSlot
                        key={item.id}
                        item={item}
                        docs={docsByItem.get(item.id) ?? []}
                        country={country}
                        uploading={uploadingItemId === item.id}
                        deletingId={deletingId}
                        onUpload={file => handleFileUpload(file, item.id, item.id)}
                        onDelete={handleDelete}
              onReread={handleReread}
              rereadingId={rereadingId}
              onConfirmHolder={handleConfirmHolder}
              confirmingId={confirmingId}
                      />
                    ))}
                  </div>
                </>
              )}

              <p className="text-[13px] font-medium text-midtone-gray uppercase tracking-[0.5px] mb-2">
                {group.forms.length > 0 ? t('supportingDocuments') : t('requiredDocuments')}
              </p>
              {group.documents.length === 0 ? (
                <p className="text-[13px] text-midtone-gray mb-2">{t('noSupportingRequired')}</p>
              ) : (
                <div className="flex flex-col gap-3">
                  {group.documents.map(item => (
                    <UploadSlot
                      key={item.id}
                      item={item}
                      docs={docsByItem.get(item.id) ?? []}
                      country={country}
                      uploading={uploadingItemId === item.id}
                      deletingId={deletingId}
                      onUpload={file => handleFileUpload(file, item.id, item.id)}
                      onDelete={handleDelete}
              onReread={handleReread}
              rereadingId={rereadingId}
              onConfirmHolder={handleConfirmHolder}
              confirmingId={confirmingId}
                    />
                  ))}
                </div>
              )}

              {group.strengthening.length > 0 && (
                <>
                  <p className="text-[13px] font-medium text-midtone-gray uppercase tracking-[0.5px] mt-5 mb-1">
                    {t('strengthenCase')}
                  </p>
                  <p className="text-[12px] text-midtone-gray mb-2">
                    {t('strengthenHint')}
                  </p>
                  <div className="flex flex-col gap-3">
                    {group.strengthening.map(item => (
                      <UploadSlot
                        key={item.id}
                        item={item}
                        docs={docsByItem.get(item.id) ?? []}
                        country={country}
                        uploading={uploadingItemId === item.id}
                        deletingId={deletingId}
                        onUpload={file => handleFileUpload(file, item.id, item.id)}
                        onDelete={handleDelete}
              onReread={handleReread}
              rereadingId={rereadingId}
              onConfirmHolder={handleConfirmHolder}
              confirmingId={confirmingId}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          ))}

          {/* Catch-all slot for anything not on the checklist */}
          <section>
            <p className="text-[13px] font-medium text-midtone-gray uppercase tracking-[0.5px] mb-2">{t('otherDocuments')}</p>
            <UploadSlot
              item={{ id: 'other', label: t('additionalDocument'), status: 'missing', required: false, meta: null }}
              docs={unlinkedDocs}
              country={country}
              uploading={uploadingItemId === 'other'}
              deletingId={deletingId}
              onUpload={file => handleFileUpload(file, 'other')}
              onDelete={handleDelete}
              onReread={handleReread}
              rereadingId={rereadingId}
              onConfirmHolder={handleConfirmHolder}
              confirmingId={confirmingId}
            />
          </section>
        </div>
      )}

      {/* ── Official reference material ────────────────────────────────────
          Uploads first, official material after. There is no Generate button
          here any more: the prefill is produced server-side the moment every
          required document is verified (PrefillService.autoGenerateIfReady),
          and the Forms stage owns reviewing/regenerating it. These sections
          stay reference-only, revealed by the same completion rule the old
          button was gated on. */}
      {checklist.length > 0 && officialUnlocked && (
        <div className="mt-8">
          {/* `.anim-page-enter` is the app's existing fade+rise keyframe and
              is already neutralised under prefers-reduced-motion in
              globals.css — no bespoke animation, no second a11y rule to keep
              in sync. */}
          <div className="anim-page-enter">
            <OfficialForms
              applicationId={applicationId}
              country={country}
              enabled
              onCodes={handleOfficialFormCodes}
            />
            <OfficialDocuments
              applicationId={applicationId}
              country={country}
              enabled
              onCodes={handleOfficialDocumentCodes}
            />
          </div>
        </div>
      )}

      {/* The only handoff to the Forms stage now that the Generate button is
          gone, so it must be reachable as soon as there is a checklist — not
          only after the first upload. */}
      {checklist.length > 0 && (
        <Card className="mt-6 p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <p className="text-[14px] font-medium text-deep-black">{t('prefillCtaTitle')}</p>
            <p className="text-[13px] text-midtone-gray mt-1">
              VisaAI drafts every field of the official form from your intake answers + uploaded documents. Review and edit them on the Forms stage, then download the summary PDF or, where supported, the real government form (e.g. IMM 5257) with values stamped in.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <Link href={`/readiness/${applicationId}`}>
              <Button variant="ghost">{t('checkVri')} <span className="inline-block rtl:-scale-x-100" aria-hidden>→</span></Button>
            </Link>
            <Link href={`/prefill/${applicationId}`}>
              <Button>{t('generateFilledForm')} <span className="inline-block rtl:-scale-x-100" aria-hidden>→</span></Button>
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

interface SlotItem {
  id: string
  label: string
  status: string
  /** Only an explicit false makes a slot optional ("Optional", not "Needed"). */
  required?: boolean | null
  meta?: ChecklistItem['meta']
}

interface UploadSlotProps {
  item: SlotItem
  docs: DocumentRecord[]
  country?: string | null
  uploading: boolean
  deletingId: string | null
  onUpload: (file: File) => void
  onDelete: (doc: DocumentRecord) => void
  /** Absent on read-only previews. */
  onReread?: (doc: DocumentRecord) => void
  rereadingId?: string | null
  /** "This is my passport" on a held passport. Absent on read-only previews. */
  onConfirmHolder?: (doc: DocumentRecord) => void
  confirmingId?: string | null
}

/**
 * One upload box per checklist item. Carries its own heading, the official
 * preparation requirements (specs), a drop/browse zone, and the list of files
 * already uploaded against it with their verification results.
 */
function UploadSlot({ item, docs, country, uploading, deletingId, onUpload, onDelete, onReread, rereadingId = null, onConfirmHolder, confirmingId = null }: UploadSlotProps) {
  const t = useTranslations('documents')
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // A preview has no row behind it, so there is nothing an upload could attach
  // to. Every interactive affordance is switched off until the real list lands.
  const pending = isPreview(item)
  const form = isFormItem(item)
  const specs = specsOf(item)
  const meta = item.meta ?? {}
  // required=false covers registry recommendations and "may be required"
  // items, not only strengthening evidence — none of them is "Needed".
  const optional = isOptionalItem(item)
  const hasUploads = docs.length > 0
  const attention = attentionOf(item)
  const request = openRequestIn(docs)

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (pending) return
    const file = e.dataTransfer.files[0]
    if (file) onUpload(file)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (pending) return
    const file = e.target.files?.[0]
    if (file) onUpload(file)
    if (inputRef.current) inputRef.current.value = ''
  }

  // Aggregate state badge for the slot. A document the pipeline found to be
  // the wrong kind for this slot never counts as verifying it.
  const verified = !request && slotIsVerified(
    item,
    docs.some(d => d.ocr_status === 'complete' && !slotMismatchOf(d.document_verifications) && !requestOf(d)?.open),
  )
  const processing = docs.some(d => d.ocr_status === 'pending')
  const slotBadge = request
    ? { label: requestBadgeLabel(request, t), variant: 'neutral' as const }
    : verified
    ? { label: t('statusVerified'), variant: 'inverse' as const }
    : processing
    ? { label: t('statusProcessing'), variant: 'neutral' as const }
    : hasUploads
    ? { label: t('statusUploaded'), variant: 'neutral' as const }
    : { label: optional ? t('statusOptional') : t('statusNeeded'), variant: 'neutral' as const }

  const formLink = form
    ? getFormHref({
        source_url: meta.source_url ?? null,
        form_code: meta.form_code,
        form_name: meta.form_name,
        country,
      })
    : null

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] font-medium text-deep-black">{item.label}</p>
          {formLink && (
            <a
              href={formLink.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#1d4ed8] hover:text-[#1e40af] underline underline-offset-2 mt-1"
              title={formLink.isFallback ? 'Search the official site for this form' : 'Open the official form'}
            >
              <ExternalLinkIcon size={12} />
              {t('openOfficialForm')}
            </a>
          )}
          {attention && (
            <p role="alert" className="mt-1 text-[12px] text-callout-red">{attention}</p>
          )}
          {request && (
            <p role="alert" className="mt-1 text-[12px] text-callout-red">{requestMessage(request, t)}</p>
          )}
          {specs.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              {specs.map(s => (
                <li key={s.label} className="text-[12px] text-midtone-gray">
                  <span className="font-medium text-rich-black">{s.label}:</span> {s.value}
                </li>
              ))}
            </ul>
          )}
        </div>
        <Badge variant={slotBadge.variant}>{slotBadge.label}</Badge>
      </div>

      {/* Upload zone */}
      <div
        role={pending ? undefined : 'button'}
        tabIndex={pending ? -1 : 0}
        aria-label={pending ? undefined : `Upload ${item.label}`}
        aria-disabled={pending || undefined}
        onDrop={handleDrop}
        onDragOver={e => { e.preventDefault(); if (!pending) setIsDragging(true) }}
        onDragLeave={() => setIsDragging(false)}
        onKeyDown={e => { if (!pending && e.key === 'Enter') inputRef.current?.click() }}
        onClick={() => { if (!pending) inputRef.current?.click() }}
        className={`mt-3 border-2 border-dashed rounded-[12px] p-4 text-center transition-colors ${
          pending
            ? 'border-subtle-ash opacity-60 cursor-default'
            : isDragging
            ? 'border-rich-black bg-ghost-gray cursor-pointer'
            : 'border-subtle-ash hover:border-rich-black cursor-pointer'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES}
          className="hidden"
          onChange={handleChange}
          aria-hidden="true"
        />
        {pending ? (
          <p className="text-[13px] text-midtone-gray">{t('preparing')}</p>
        ) : uploading ? (
          <p className="text-[13px] text-midtone-gray">{t('uploading')}</p>
        ) : (
          <p className="text-[13px] text-midtone-gray">
            <span className="font-medium text-deep-black">{hasUploads ? t('replaceOrAdd') : t('dropOrClick')}</span>
            {' '}{t('fileHint', { max: MAX_FILE_SIZE_MB })}
          </p>
        )}
      </div>

      {/* Uploaded files for this slot */}
      {hasUploads && (
        <div className="mt-3 flex flex-col gap-2">
          {docs.map(doc => {
            const mismatch = slotMismatchOf(doc.document_verifications)
            // The decision belongs to this file even after a newer upload
            // closed the request on the slot.
            const docRequest = requestOf(doc)
            // Non-blocking: a personal document that seems to name someone
            // other than the applicant. The document still counts.
            const otherHolder = holderMismatchOf(latestVerifications(doc.document_verifications))
            const confirmedHolder = otherHolder ? null : holderConfirmationOf(latestVerifications(doc.document_verifications))
            return (
            <div key={doc.id} className="rounded-[10px] border border-subtle-ash px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-deep-black truncate">{doc.file_name}</p>
                  <p className="text-[11px] text-midtone-gray">{new Date(doc.created_at).toLocaleDateString()}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={doc.ocr_status === 'complete' && !mismatch && !docRequest ? 'inverse' : 'neutral'}>
                    {docRequest ? requestBadgeLabel(docRequest, t) : mismatch ? t('statusWrongDocument') : doc.ocr_status === 'complete' ? t('statusVerified') : doc.ocr_status === 'failed' ? t('statusFailed') : t('statusProcessing')}
                  </Badge>
                  {onReread && canReread(doc) && (
                    <button
                      type="button"
                      onClick={() => onReread(doc)}
                      disabled={rereadingId === doc.id}
                      aria-label={t('rereadLabel', { name: doc.file_name })}
                      title={t('rereadTitle')}
                      className="inline-flex items-center h-7 px-2 rounded-md text-[12px] font-medium text-midtone-gray hover:text-deep-black hover:bg-ghost-gray disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rich-black/30"
                    >
                      {t('reread')}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onDelete(doc)}
                    disabled={deletingId === doc.id}
                    aria-label={`Delete ${doc.file_name}`}
                    title="Delete document"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-md text-midtone-gray hover:text-callout-red hover:bg-callout-red/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-callout-red/40"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
              {mismatch && (
                <p role="alert" className="mt-2 text-[12px] text-callout-red">{mismatch.message}</p>
              )}
              {docRequest && !docRequest.open && (
                <p className="mt-2 text-[12px] text-midtone-gray">{requestMessage(docRequest, t)}</p>
              )}
              {otherHolder && (
                <p role="status" className="mt-2 text-[12px] text-amber">
                  {t(otherHolder.held ? 'holderMismatchHeld' : 'holderMismatch', { holder: otherHolder.holder, applicant: otherHolder.applicant })}
                </p>
              )}
              {otherHolder?.held && !otherHolder.clearlyOther && onConfirmHolder && (
                <button
                  type="button"
                  onClick={() => onConfirmHolder(doc)}
                  disabled={confirmingId === doc.id}
                  aria-label={t('holderConfirmLabel', { name: doc.file_name })}
                  className="mt-2 inline-flex items-center h-7 px-3 rounded-md border border-subtle-ash text-[12px] font-medium text-deep-black hover:bg-ghost-gray disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rich-black/30"
                >
                  {confirmingId === doc.id ? t('holderConfirming') : t('holderConfirmButton')}
                </button>
              )}
              {confirmedHolder && (
                <p role="status" className="mt-2 text-[12px] text-midtone-gray">
                  {t('holderConfirmed')}
                </p>
              )}
              {doc.document_verifications.length > 0 && (
                <div className="flex flex-col gap-1 mt-2 pt-2 border-t border-subtle-ash">
                  {latestVerifications(doc.document_verifications).map(v => {
                    // An expiry finding says WHY ("policy does not cover your
                    // planned stay: it must be valid until …"); a bare ✗ does not.
                    const basis =
                      v.verification_type === 'expiry' && v.result !== 'pass' && typeof v.details_json?.basis === 'string'
                        ? (v.details_json.basis as string)
                        : null
                    return (
                      <div key={v.id}>
                        <div className="flex items-center justify-between">
                          <span className="text-[12px] text-midtone-gray capitalize">{v.verification_type}</span>
                          {(() => {
                            // A held / someone-else's passport is never "✓ Pass".
                            const shown = identityResultOf(v)
                            return (
                              <span className={`text-[12px] font-medium ${STATUS_COLORS[shown] ?? 'text-rich-black'}`}>
                                {shown === 'needs_confirmation' ? t('resultNeedsConfirmation') : shown === 'not_yours' ? t('resultNotYours') : shown === 'pass' ? t('resultPass') : shown === 'warn' ? t('resultWarn') : t('resultFail')}
                              </span>
                            )
                          })()}
                        </div>
                        {basis && <p className="text-[12px] text-rich-black mt-0.5 first-letter:uppercase">{basis}</p>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}

type DocumentsT = ReturnType<typeof useTranslations<'documents'>>

function requestBadgeLabel(r: ConsultantRequest, t: DocumentsT): string {
  return r.decision === 'rejected' ? t('statusRejectedByConsultant') : t('statusReuploadRequested')
}

/** "Your consultant asked for a new upload: <note>" — the note is required server-side. */
function requestMessage(r: ConsultantRequest, t: DocumentsT): string {
  const note = r.note?.trim() || '—'
  return r.decision === 'rejected' ? t('consultantRejectedDocument', { note }) : t('consultantAskedReupload', { note })
}
