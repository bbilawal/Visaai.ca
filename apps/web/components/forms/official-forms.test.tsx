/**
 * RTL tests for OfficialForms (Task 9 — official-forms section on the
 * documents page).
 *
 * Follows the same mocking pattern as
 * components/notifications/notification-bell.test.tsx (mock
 * @/lib/supabase/client's getSession, render, waitFor) but mocks global
 * fetch directly rather than an API-client module, because OfficialForms
 * fetches GET /forms/:applicationId inline — the same idiom
 * documents-client.tsx already uses for /documents/:applicationId — with no
 * wrapper module to mock instead.
 *
 * These four states pin the human's explicit ruling that a failed load must
 * be SHOWN, not swallowed (this project shipped a production billing outage
 * from exactly that pattern):
 *   a) a non-OK fetch response -> the error text renders AND includes the
 *      HTTP status; the section is visible, never null
 *   b) a 200 response whose body is not an array -> error renders instead of
 *      `forms.map` throwing during render (pins the unchecked-cast fix)
 *   c) a form with downloadPath set -> the "Download" button renders (the API
 *      streams the bytes behind a bearer token, so this is a button that
 *      fetches, NOT an <a href> — see download-button.tsx)
 *   d) a form with downloadPath null but officialUrl set -> the "Open official
 *      page" link renders instead
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/supabase/client', () => ({
  getSession: () =>
    Promise.resolve({ data: { session: { access_token: 'test-token' } } }),
}))

const mockFetch = vi.fn()

// ─── Import under test (after mocks) ─────────────────────────────────────────
import { OfficialForms } from './official-forms'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(opts: {
  ok: boolean
  status: number
  body: unknown
  requestId?: string
}) {
  return {
    ok: opts.ok,
    status: opts.status,
    headers: new Headers(opts.requestId ? { 'x-request-id': opts.requestId } : {}),
    json: async () => opts.body,
  }
}

// ─── Setup ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', mockFetch)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OfficialForms', () => {
  it('(a) shows a visible error including the HTTP status on a non-OK response', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ ok: false, status: 503, body: null, requestId: 'req-abc-123' }),
    )

    render(<OfficialForms applicationId="app-1" country="CA" />)

    await waitFor(() => {
      expect(screen.getByText(/Couldn.?t load your official forms/i)).toBeInTheDocument()
    })

    // The section itself must be visible, not null.
    expect(screen.getByText('Official forms')).toBeInTheDocument()
    // The status must appear in the error text.
    expect(screen.getByText(/503/)).toBeInTheDocument()
    // The x-request-id must appear when the response carries that header.
    expect(screen.getByText(/req-abc-123/)).toBeInTheDocument()
  })

  it('(b) shows an error rather than throwing when a 200 body is not an array', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ ok: true, status: 200, body: { not: 'an array' } }),
    )

    render(<OfficialForms applicationId="app-1" country="CA" />)

    await waitFor(() => {
      expect(screen.getByText(/Couldn.?t load your official forms/i)).toBeInTheDocument()
    })

    // Section renders visibly (did not throw / did not render null).
    expect(screen.getByText('Official forms')).toBeInTheDocument()
    expect(screen.getByText(/200/)).toBeInTheDocument()
  })

  it('(c) renders the Download button when downloadPath is set', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: 200,
        body: [
          {
            formCode: 'IMM 5257',
            formName: 'Application for Temporary Resident Visa',
            capability: 'acroform',
            versionLabel: '2024-01',
            downloadPath: '/forms/app-1/file/IMM%205257',
            officialUrl: 'https://www.canada.ca/imm5257',
            source: 'cache',
            prefillable: true,
          },
        ],
      }),
    )

    render(<OfficialForms applicationId="app-1" country="CA" />)

    await waitFor(() => {
      expect(screen.getByText(/IMM 5257/)).toBeInTheDocument()
    })

    expect(screen.getByRole('button', { name: /Download/i })).toBeInTheDocument()
    // The cached copy is offered instead of the government page, not alongside it.
    expect(
      screen.queryByRole('link', { name: /Open official page/i }),
    ).not.toBeInTheDocument()
  })

  it('(d) renders an Open official page link when downloadPath is null', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        ok: true,
        status: 200,
        body: [
          {
            formCode: 'IMM 5645',
            formName: 'Family Information',
            capability: 'unknown',
            versionLabel: null,
            downloadPath: null,
            officialUrl: 'https://www.canada.ca/imm5645',
            source: 'official-link',
            prefillable: false,
          },
        ],
      }),
    )

    render(<OfficialForms applicationId="app-1" country="CA" />)

    await waitFor(() => {
      expect(screen.getByText(/IMM 5645/)).toBeInTheDocument()
    })

    const link = screen.getByRole('link', { name: /Open official page/i })
    expect(link).toHaveAttribute('href', 'https://www.canada.ca/imm5645')
    expect(screen.queryByRole('button', { name: /Download/i })).not.toBeInTheDocument()
  })

  function formWith(verifiedAt: string | null) {
    return {
      formCode: 'IMM 5257',
      formName: 'Application for Temporary Resident Visa',
      capability: 'acroform',
      versionLabel: '2024-01',
      downloadPath: '/forms/app-1/file/IMM%205257',
      officialUrl: 'https://www.canada.ca/imm5257',
      source: 'cache',
      prefillable: true,
      freshness: 'fresh',
      verifiedAt,
    }
  }

  it('(e) states the verification DATE — never "checked today"', async () => {
    const today = new Date()
    mockFetch.mockResolvedValue(
      jsonResponse({ ok: true, status: 200, body: [formWith(today.toISOString())] }),
    )

    render(<OfficialForms applicationId="app-1" country="CA" />)

    await waitFor(() => {
      expect(screen.getByText(/IMM 5257/)).toBeInTheDocument()
    })

    // Same-day used to render the words "checked today". It now renders the date.
    expect(screen.queryByText(/checked (daily|today)/i)).not.toBeInTheDocument()
    expect(
      screen.getByText(new RegExp(`checked ${today.toLocaleDateString()}`)),
    ).toBeInTheDocument()
    expect(screen.getByText(/Version 2024-01/)).toBeInTheDocument()
  })

  it('(f) renders no freshness line at all when there is no verification date', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ ok: true, status: 200, body: [formWith(null)] }),
    )

    render(<OfficialForms applicationId="app-1" country="CA" />)

    await waitFor(() => {
      expect(screen.getByText(/IMM 5257/)).toBeInTheDocument()
    })

    // The old "checked daily" fallback is gone — no date, no claim.
    expect(screen.queryByText(/checked/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Version 2024-01/)).toBeInTheDocument()
  })
})

/**
 * The section is gated behind the applicant finishing their uploads. Locked
 * must mean locked all the way down: no markup AND no request, or the page
 * quietly spends an API call on material it is not showing.
 */
describe('OfficialForms gating', () => {
  it('renders nothing and fetches nothing when not enabled', async () => {
    render(<OfficialForms applicationId="app-1" country="CA" enabled={false} />)

    // Give any stray effect a chance to fire before asserting it did not.
    await new Promise(r => setTimeout(r, 0))

    expect(mockFetch).not.toHaveBeenCalled()
    expect(screen.queryByText('Official forms')).not.toBeInTheDocument()
  })

  it('defaults to enabled so existing callers are unaffected', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ ok: true, status: 200, body: [] }),
    )

    render(<OfficialForms applicationId="app-1" country="CA" />)

    await waitFor(() => expect(mockFetch).toHaveBeenCalled())
  })
})
