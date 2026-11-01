import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const { push, getUser, getSession, markOnboarded } = vi.hoisted(() => ({
  push: vi.fn(),
  getUser: vi.fn(),
  getSession: vi.fn(),
  markOnboarded: vi.fn(),
}))

vi.mock('next-intl', () => ({
  useTranslations: () => (k: string) => k,
  useLocale: () => 'en',
}))
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/lib/supabase/client', () => ({ getUser, getSession }))
vi.mock('@/lib/onboarding/complete', () => ({ markOnboarded }))
vi.mock('@/lib/use-supported-countries', () => ({
  useSupportedCountries: () => ({
    countries: [{ code: 'CA', name: 'Canada' }, { code: 'US', name: 'United States' }],
    loading: false,
    error: null,
    retry: vi.fn(),
  }),
}))

async function loadPage(mode: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode)
  vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://api.test')
  return (await import('./page')).default
}

describe('Onboarding first application — site scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    getSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } })
    markOnboarded.mockResolvedValue(undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ applicationId: 'app-9' }) }),
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('global: asks for a destination country before starting', async () => {
    const Page = await loadPage('')
    render(<Page />)
    await waitFor(() => expect(getUser).toHaveBeenCalled())
    expect(screen.getByText('destinationCountry', { exact: false })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'startApplication' })).toBeDisabled()
  })

  it('canada: no country picker; start creates a CA application', async () => {
    const Page = await loadPage('canada')
    render(<Page />)
    expect(screen.queryByText('destinationCountry', { exact: false })).not.toBeInTheDocument()
    const start = screen.getByRole('button', { name: 'startApplication' })
    await waitFor(() => expect(getUser).toHaveBeenCalled())
    await userEvent.click(start)
    await waitFor(() => expect(push).toHaveBeenCalledWith('/intake/app-9'))
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(JSON.parse(init.body)).toMatchObject({ country: 'CA' })
  })
})
