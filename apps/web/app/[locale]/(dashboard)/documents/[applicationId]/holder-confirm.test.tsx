/**
 * 2026-10-30: a passport held because its name doesn't match the name the
 * applicant gave showed "Identity ✓ Pass" beside the held message, and the
 * applicant had no way to say it was theirs. The Identity line now reads
 * "Needs confirmation" (held) or "Not yours" (clearly someone else's), and a
 * held passport has a "This is my passport" button.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ChecklistItem } from '@visaai/types'

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))
const toast = vi.fn()
vi.mock('@/components/providers/toast-provider', () => ({
  useToast: () => ({ toast }),
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
const passportItem = {
  id: 'pp',
  application_id: APP,
  document_type: 'passport',
  label: 'Passport',
  required: true,
  status: 'verified',
  added_reason: null,
  meta: null,
} as ChecklistItem

const docWith = (details: Record<string, unknown>) => ({
  id: 'd-pp',
  file_name: 'passport.pdf',
  ocr_status: 'complete',
  upload_status: 'complete',
  created_at: '2026-10-29T09:00:00Z',
  checklist_item_id: 'pp',
  document_verifications: [
    { id: 'v1', verification_type: 'identity', result: 'pass', details_json: details, verified_at: '2026-10-29T09:00:00Z' },
  ],
  consultant_review: null,
})

const mismatch = (extra: Record<string, unknown>) => ({
  holder_mismatch: { holder: 'QUEBEC ZULU', applicant: 'Romeo Kilo', message: 'm', ...extra },
})

let fetchMock: ReturnType<typeof vi.fn>
function serve(documents: unknown[]) {
  fetchMock = vi.fn(async (url: string) => {
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
  })
  vi.stubGlobal('fetch', fetchMock)
}

describe('Documents vault — a passport held on its name', () => {
  beforeEach(() => {
    checklistRows = [passportItem]
  })
  afterEach(() => vi.unstubAllGlobals())

  it('shows "Needs confirmation" instead of Pass, and confirms on click', async () => {
    serve([docWith(mismatch({ needs_confirmation: true }))])
    render(<DocumentsClient applicationId={APP} initialChecklist={checklistRows} />)

    expect(await screen.findByText('resultNeedsConfirmation')).toBeInTheDocument()
    expect(screen.queryByText('resultPass')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'holderConfirmLabel:passport.pdf' }))
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/documents\/item\/d-pp\/confirm-holder$/),
        expect.objectContaining({ method: 'POST' }),
      ),
    )
  })

  it("clearly someone else's: 'Not yours', and no confirm button", async () => {
    serve([docWith(mismatch({ clearly_other: true }))])
    render(<DocumentsClient applicationId={APP} initialChecklist={checklistRows} />)

    expect(await screen.findByText('resultNotYours')).toBeInTheDocument()
    expect(screen.queryByText('resultPass')).not.toBeInTheDocument()
    expect(screen.queryByText('holderConfirmButton')).not.toBeInTheDocument()
  })

  it('once confirmed: the confirmation note and the stored result', async () => {
    serve([docWith({ holder_confirmation: { confirmed_at: '2026-10-30T10:00:00Z', holder: 'QUEBEC ZULU' } })])
    render(<DocumentsClient applicationId={APP} initialChecklist={checklistRows} />)

    expect(await screen.findByText('holderConfirmed')).toBeInTheDocument()
    expect(screen.getByText('resultPass')).toBeInTheDocument()
    expect(screen.queryByText('holderConfirmButton')).not.toBeInTheDocument()
  })
  it('a 503 (confirmation could not be recorded) shows a friendly retry message', async () => {
    serve([docWith(mismatch({ needs_confirmation: true }))])
    const base = fetchMock.getMockImplementation()!
    fetchMock.mockImplementation(async (url: string, init?: unknown) =>
      url.endsWith('/confirm-holder') ? { ok: false, status: 503, json: async () => ({}) } : base(url, init),
    )
    toast.mockReset()
    render(<DocumentsClient applicationId={APP} initialChecklist={checklistRows} />)
    fireEvent.click(await screen.findByRole('button', { name: 'holderConfirmLabel:passport.pdf' }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith('holderConfirmUnavailable', 'error'))
  })
})
