/**
 * Live 2026-10-20: the consultant marked an uploaded passport "Needs
 * re-upload" with a note. The applicant's vault kept the document and its
 * slot at "Verified" and counted it in "N of M required verified"; the
 * request was only visible in Messages.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import type { ChecklistItem } from '@visaai/types'

vi.mock('next-intl', () => ({
  // Echo the key plus any interpolated values, so assertions can see both.
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ toast: vi.fn() }),
}))
vi.mock('@/components/forms/official-forms', () => ({ OfficialForms: () => null }))
vi.mock('./official-documents', () => ({ OfficialDocuments: () => null }))

let checklistRows: ChecklistItem[] = []
vi.mock('@/lib/supabase/client', () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => Promise.resolve({ data: checklistRows }),
  }
  return {
    getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }),
    createClient: () => ({ from: () => builder }),
  }
})

import DocumentsClient from './documents-client'

const APP = 'app-1'
const item = (id: string, label: string): ChecklistItem =>
  ({
    id,
    application_id: APP,
    document_type: id,
    label,
    required: true,
    status: 'verified',
    added_reason: null,
    meta: null,
  }) as ChecklistItem

const doc = (over: Record<string, unknown>) => ({
  id: 'd-pp',
  file_name: 'passport.pdf',
  ocr_status: 'complete',
  upload_status: 'complete',
  created_at: '2026-10-19T09:00:00Z',
  checklist_item_id: 'pp',
  document_verifications: [],
  consultant_review: null,
  ...over,
})

const REQUEST = {
  decision: 'needs_reupload',
  note: 'The photo page is cut off',
  decided_at: '2026-10-20T10:00:00Z',
  open: true,
}

function serve(documents: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const json = (body: unknown) => ({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        body: null,
        json: async () => body,
      })
      if (url.includes('/checklist/rebuild')) return json(checklistRows)
      if (url.includes('/prefill/')) return json({ payload: null })
      if (url.endsWith(`/documents/${APP}`)) return json({ documents, crossVerifications: [] })
      return json({})
    }),
  )
}

function slotCard(label: string): HTMLElement {
  const heading = screen.getAllByText(label).find(el => el.tagName === 'P')!
  return heading.closest('.flex.items-start.justify-between')!.parentElement as HTMLElement
}

describe('Documents vault — consultant re-upload request', () => {
  beforeEach(() => {
    checklistRows = [item('pp', 'Passport'), item('bank', 'Bank statement')]
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows the request and the note on the slot and the file, and stops counting the slot as verified', async () => {
    serve([
      doc({ consultant_review: REQUEST }),
      doc({ id: 'd-bank', file_name: 'bank.pdf', checklist_item_id: 'bank' }),
    ])
    render(<DocumentsClient applicationId={APP} initialChecklist={checklistRows} />)

    expect(
      await screen.findByText('consultantAskedReupload:The photo page is cut off'),
    ).toBeInTheDocument()
    const card = slotCard('Passport')
    // Slot badge and file badge both read the request — never "Verified".
    expect(within(card).getAllByText('statusReuploadRequested')).toHaveLength(2)
    expect(within(card).queryByText('statusVerified')).not.toBeInTheDocument()
    // 1 of 2, and the passport is the next thing to upload.
    expect(screen.getByText('progressCount:1,2')).toBeInTheDocument()
    expect(screen.getByText('nextUpload:Passport')).toBeInTheDocument()
    // The untouched slot still reads Verified.
    expect(within(slotCard('Bank statement')).getAllByText('statusVerified').length).toBeGreaterThan(0)
  })

  it('a rejection reads as one', async () => {
    serve([doc({ consultant_review: { ...REQUEST, decision: 'rejected', note: 'Expired passport' } })])
    render(<DocumentsClient applicationId={APP} initialChecklist={checklistRows} />)
    expect(
      await screen.findByText('consultantRejectedDocument:Expired passport'),
    ).toBeInTheDocument()
    expect(within(slotCard('Passport')).getAllByText('statusRejectedByConsultant').length).toBe(2)
  })

  it('a newer upload in the slot clears the request; the old file keeps its decision', async () => {
    serve([
      doc({ id: 'd-new', file_name: 'passport-new.pdf', created_at: '2026-10-21T09:00:00Z' }),
      doc({ consultant_review: { ...REQUEST, open: false } }),
      doc({ id: 'd-bank', file_name: 'bank.pdf', checklist_item_id: 'bank' }),
    ])
    render(<DocumentsClient applicationId={APP} initialChecklist={checklistRows} />)
    await screen.findByText('passport-new.pdf')
    await waitFor(() => expect(screen.getByText('progressCount:2,2')).toBeInTheDocument())
    const card = slotCard('Passport')
    // No alert on the slot any more; the old file still shows what was asked.
    expect(within(card).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(card).getAllByText('statusReuploadRequested')).toHaveLength(1)
    expect(
      within(card).getByText('consultantAskedReupload:The photo page is cut off'),
    ).toBeInTheDocument()
  })
})
