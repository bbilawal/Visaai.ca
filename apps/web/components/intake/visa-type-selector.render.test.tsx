import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

/**
 * Prod 2026-10-16: refusing the eTA for a Pakistani showed nothing useful —
 * the API's global error envelope dropped `code: 'ROUTE_INELIGIBLE'`, so the
 * selector fell back to its generic message. And once a route was chosen, a
 * profile that later ruled it out was never surfaced here at all.
 */

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) =>
    key === 'errSaveFailed' ? 'Could not save your choice.' : key,
}))
vi.mock('@/lib/supabase/client', () => ({
  ensureSession: () => Promise.resolve({ access_token: 'tok' }),
}))

import { VisaTypeSelector } from './visa-type-selector'

const ETA = {
  id: 'eta',
  visaaiId: 'ca-electronic-travel-authorization-eta',
  name: 'Electronic travel authorization (eTA)',
  officialCode: 'eTA',
  category: 'visitor',
  dataQuality: 'verified',
  requirementCount: 3,
}
const TRV = {
  id: 'trv',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
  name: 'Visitor visa',
  officialCode: 'TRV',
  category: 'visitor',
  dataQuality: 'verified',
  requirementCount: 20,
}

const PK_REASON =
  "Citizens of Pakistan need a visitor visa (TRV) to travel to Canada — Pakistan is not on IRCC's list of countries whose citizens can apply for an eTA."

function json(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response)
}

describe('VisaTypeSelector', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('renders the API’s reason when a route is refused (prod envelope)', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        // Exactly what AllExceptionsFilter now sends.
        return json(400, {
          statusCode: 400,
          error: 'BAD_REQUEST',
          message: `${PK_REASON} Choose “Visitor visa (temporary resident visa, TRV)” instead.`,
          code: 'ROUTE_INELIGIBLE',
          details: { eligibility: 'ineligible' },
        })
      }
      return json(200, [ETA, TRV])
    })

    render(<VisaTypeSelector applicationId="app-1" />)
    const select = await screen.findByRole('combobox')
    fireEvent.change(select, { target: { value: 'eta' } })

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Pakistan need a visitor visa/)
    expect(alert.textContent).not.toMatch(/Could not save/)
    // Reverted: the refused route is not shown as chosen.
    expect((select as HTMLSelectElement).value).toBe('')
  })

  it('flags an already-chosen route the profile has since ruled out', async () => {
    fetchMock.mockImplementation(() =>
      json(200, [
        {
          ...ETA,
          eligibility: {
            status: 'ineligible',
            reason: PK_REASON,
            recommendedVisaaiId: TRV.visaaiId,
            recommendedLabel: 'Visitor visa (temporary resident visa, TRV)',
          },
        },
        TRV,
      ]),
    )

    render(<VisaTypeSelector applicationId="app-1" initialVisaTypeId="eta" />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toMatch(/Pakistan need a visitor visa/)
    expect(alert.textContent).toMatch(/Visitor visa \(temporary resident visa, TRV\)/)
    // The route is NOT silently changed.
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('eta')
  })

  it('re-reads eligibility when the interview moves on (refreshKey)', async () => {
    let call = 0
    fetchMock.mockImplementation(() => {
      call += 1
      return json(200, [
        call === 1
          ? {
              ...ETA,
              eligibility: {
                status: 'unknown',
                reason: 'Whether you can use an eTA depends on your nationality, which we do not know yet.',
              },
            }
          : { ...ETA, eligibility: { status: 'ineligible', reason: PK_REASON } },
        TRV,
      ])
    })

    const { rerender } = render(
      <VisaTypeSelector applicationId="app-1" initialVisaTypeId="eta" refreshKey={1} />,
    )
    expect(await screen.findByText(/depends on your nationality/)).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()

    rerender(
      <VisaTypeSelector applicationId="app-1" initialVisaTypeId="eta" refreshKey={2} />,
    )
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/Pakistan/),
    )
  })

  it('warns after accepting a route whose eligibility depends on nationality', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        return json(200, {
          visaTypeId: 'eta',
          changed: true,
          intakeComplete: false,
          eligibility: {
            status: 'unknown',
            reason: 'Whether you can use an eTA depends on your nationality, which we do not know yet.',
          },
        })
      }
      return json(200, [ETA, TRV])
    })
    const onChange = vi.fn()
    render(<VisaTypeSelector applicationId="app-1" onChange={onChange} />)
    fireEvent.change(await screen.findByRole('combobox'), {
      target: { value: 'eta' },
    })
    expect(await screen.findByText(/depends on your nationality/)).toBeTruthy()
    expect(onChange).toHaveBeenCalled()
  })
})
