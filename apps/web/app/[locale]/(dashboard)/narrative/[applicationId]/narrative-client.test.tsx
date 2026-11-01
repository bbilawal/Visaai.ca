/**
 * Generate page defects from the 2026-10-14 Canada visitor-visa dry run:
 *  #7  letters showed raw markdown (and markdown tables)
 *  #8  letters looked approved without the applicant approving them; editing
 *      could only end in "Save & Approve"
 *  #10 clicking "Cover letter" while the itinerary was generating did nothing
 *  —   the prefilled government form showed as a raw JSON card with Approve
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string, v?: Record<string, unknown>) =>
    v ? `${k}:${Object.values(v).join(',')}` : k,
}))
vi.mock('@/lib/supabase/client', () => ({
  getSession: () => Promise.resolve({ data: { session: { access_token: 't' } } }),
}))
const toast = vi.fn()
vi.mock('@/components/providers/toast-provider', () => ({ useToast: () => ({ toast }) }))
vi.mock('@/lib/plan-error', () => ({ handlePlanError: () => Promise.resolve(false) }))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}))

import NarrativeClient from './narrative-client'

type Doc = {
  id: string
  doc_type: string
  content_md: string
  approved_by_user: boolean
  generated_at: string
}

const LOE: Doc = {
  id: 'g1',
  doc_type: 'loe',
  content_md: '**To: Visa Officer**\n\n| Day | Plan |\n|---|---|\n| 1 | Arrive |',
  approved_by_user: false,
  generated_at: '2026-10-14T10:00:00Z',
}
const FORM: Doc = {
  id: 'g9',
  doc_type: 'prefilled_form_json',
  content_md: JSON.stringify({
    visaType: 'visitor',
    countryCode: 'CA',
    fields: [
      { key: 'given_name', label: 'Given name', value: 'KARIM', group: 'Personal' },
      { key: 'duration_of_stay_days', label: 'Duration of stay (days)', value: '62', group: 'Travel' },
      { key: 'employer_name', label: 'Employer', value: '', group: 'Employment' },
    ],
  }),
  approved_by_user: false,
  generated_at: '2026-10-14T10:00:00Z',
}

let docs: Doc[] = []
type Pending = { resolve: (v: Response) => void; body: unknown }
let pendingGenerates: Pending[] = []
const calls: Array<{ url: string; body: unknown }> = []

function json(data: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(data) } as Response
}

beforeEach(() => {
  docs = [LOE]
  pendingGenerates = []
  calls.length = 0
  toast.mockReset()
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ url, body })
    if (url.endsWith('/generate')) {
      return new Promise<Response>(resolve => pendingGenerates.push({ resolve, body }))
    }
    if (init?.method === 'POST') return Promise.resolve(json({ ok: true }))
    return Promise.resolve(json(docs))
  }))
})
afterEach(() => vi.unstubAllGlobals())

describe('NarrativeClient — letters render as text, not markup (#7)', () => {
  it('renders bold and tables without asterisks or pipes', async () => {
    const { container } = render(<NarrativeClient applicationId="app-1" />)
    expect(await screen.findByText('To: Visa Officer')).toBeInTheDocument()
    expect(container.querySelector('table')).not.toBeNull()
    expect(container.textContent).not.toContain('**')
    expect(container.textContent).not.toContain('|')
  })
})

describe('NarrativeClient — approval is the applicant’s explicit act (#8)', () => {
  it('a fresh letter shows as a draft awaiting review, not approved', async () => {
    render(<NarrativeClient applicationId="app-1" />)
    expect(await screen.findByText('statusDraft')).toBeInTheDocument()
    expect(screen.queryByText('approved')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'approve' })).toBeInTheDocument()
  })

  it('an approved letter shows Approved and no Approve button', async () => {
    docs = [{ ...LOE, approved_by_user: true }]
    render(<NarrativeClient applicationId="app-1" />)
    expect(await screen.findByText('approved')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'approve' })).not.toBeInTheDocument()
  })

  it('saving an edit does not approve it', async () => {
    render(<NarrativeClient applicationId="app-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'edit' }))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Fixed letter' } })
    fireEvent.click(screen.getByRole('button', { name: 'saveDraft' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/narrative/document/g1/save'))).toBe(true))
    const save = calls.find(c => c.url.endsWith('/save'))!
    expect(save.body).toEqual({ content: 'Fixed letter' })
    expect(calls.some(c => c.url.endsWith('/approve'))).toBe(false)
  })

  it('Approve sends the approval', async () => {
    render(<NarrativeClient applicationId="app-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'approve' }))
    await waitFor(() => expect(calls.some(c => c.url.endsWith('/narrative/document/g1/approve'))).toBe(true))
  })
})

describe('NarrativeClient — a second Generate click is queued, not dropped (#10)', () => {
  it('queues the cover letter behind the itinerary, says so, then generates it', async () => {
    render(<NarrativeClient applicationId="app-1" />)
    await screen.findByText('To: Visa Officer')

    fireEvent.click(screen.getByRole('button', { name: '+ docItinerary' }))
    await waitFor(() => expect(pendingGenerates).toHaveLength(1))
    expect(pendingGenerates[0].body).toEqual({ docType: 'itinerary' })

    const cover = screen.getByRole('button', { name: '+ docCoverLetter' })
    expect(cover).not.toBeDisabled()
    fireEvent.click(cover)
    expect(await screen.findByText('queuedDoc:docCoverLetter,docItinerary')).toBeInTheDocument()

    pendingGenerates[0].resolve(json({ generatedDocumentId: 'g2' }))
    await waitFor(() => expect(pendingGenerates).toHaveLength(2))
    expect(pendingGenerates[1].body).toEqual({ docType: 'cover_letter' })
  })
})

describe('NarrativeClient — the prefilled form reads as a form, not JSON', () => {
  it('shows label/value rows, no JSON and no Approve button on that card', async () => {
    docs = [FORM]
    const { container } = render(<NarrativeClient applicationId="app-1" />)
    expect(await screen.findByText('Given name')).toBeInTheDocument()
    expect(screen.getByText('KARIM')).toBeInTheDocument()
    expect(screen.getByText('62')).toBeInTheDocument()
    expect(container.textContent).not.toContain('{"')
    expect(container.textContent).not.toContain('given_name')
    const card = screen.getByTestId('generated-form')
    expect(within(card).queryByRole('button', { name: 'approve' })).not.toBeInTheDocument()
    expect(within(card).getByRole('link', { name: 'formOpen' })).toHaveAttribute('href', '/prefill/app-1')
  })
})
