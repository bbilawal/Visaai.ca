/**
 * Dry run 2026-10-16: after a reload the selector said "Not chosen yet" for an
 * application whose super visa route was already saved, because the server
 * render's read came back empty. The selector now asks the API for the route.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

vi.mock('next-intl', () => ({ useTranslations: () => (k: string) => k }))
vi.mock('@/lib/supabase/client', () => ({
  ensureSession: () => Promise.resolve({ access_token: 't' }),
}))

import { VisaTypeSelector, visaTypeOptionName, saveErrorMessage } from './visa-type-selector'

const OPTIONS = [
  { id: 'sv', visaaiId: 'ca-super-visa', name: 'Super visa', officialCode: null, category: null, dataQuality: null, requirementCount: 25 },
  { id: 'trv', visaaiId: 'ca-trv', name: 'Visitor visa', officialCode: null, category: null, dataQuality: null, requirementCount: 20 },
]

function stubFetch(app: Record<string, unknown>) {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(url.endsWith('/visa-types') ? OPTIONS : app),
    } as Response),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('VisaTypeSelector — shows the saved route', () => {
  it('reads the route from the API when the server render had none', async () => {
    stubFetch({ visa_type_id: 'sv' })
    render(<VisaTypeSelector applicationId="app-1" initialVisaTypeId={null} />)
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('sv'))
  })

  it('does not ask again when the server render already had it', async () => {
    const f = stubFetch({ visa_type_id: 'trv' })
    render(<VisaTypeSelector applicationId="app-1" initialVisaTypeId="sv" />)
    await screen.findByRole('combobox')
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('sv')
    expect(f.mock.calls.map((c) => c[0])).toEqual([expect.stringMatching(/visa-types$/)])
  })
})

/**
 * Dry run 2026-10-16: the selector read "Electronic travel authorization (eTA)
 * (eTA)", and refusing the eTA for a visa-required applicant needs the API's
 * own reason shown — not a generic "could not save".
 */
describe('visaTypeOptionName', () => {
  it('does not repeat a code the official name already carries', () => {
    expect(
      visaTypeOptionName({
        name: 'Electronic travel authorization (eTA)',
        officialCode: 'eTA',
      }),
    ).toBe('Electronic travel authorization (eTA)')
  })

  it('appends a code the name does not mention', () => {
    expect(visaTypeOptionName({ name: 'Visitor visa', officialCode: 'TRV' })).toBe(
      'Visitor visa (TRV)',
    )
  })

  it('shows the bare name when there is no code', () => {
    expect(visaTypeOptionName({ name: 'Super visa', officialCode: null })).toBe('Super visa')
  })
})

describe('saveErrorMessage', () => {
  it('shows the reason the API gave for refusing a route', () => {
    expect(
      saveErrorMessage(
        400,
        {
          code: 'ROUTE_INELIGIBLE',
          message: 'Citizens of Pakistan need a visitor visa (TRV) to travel to Canada.',
        },
        'Could not save',
      ),
    ).toBe('Citizens of Pakistan need a visitor visa (TRV) to travel to Canada.')
  })

  it('falls back to the generic message for anything else', () => {
    expect(saveErrorMessage(500, { message: 'boom' }, 'Could not save')).toBe('Could not save')
    expect(saveErrorMessage(400, null, 'Could not save')).toBe('Could not save')
  })
})
