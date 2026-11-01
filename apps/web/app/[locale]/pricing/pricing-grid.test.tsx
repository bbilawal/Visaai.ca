import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (k: string) => k,
}))
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const QUOTES = [
  { visa_type: 'visitor', country_code: 'CA', price: 99, currency: 'USD' },
  { visa_type: 'student', country_code: 'CA', price: 199, currency: 'USD' },
  { visa_type: 'visitor', country_code: 'US', price: 149, currency: 'USD' },
]

async function loadGrid(mode: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode)
  return (await import('./pricing-grid')).PricingGrid
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('PricingGrid site scope', () => {
  it('global: offers the destination switcher across every corridor', async () => {
    const PricingGrid = await loadGrid('')
    render(<PricingGrid quotes={QUOTES} />)
    expect(screen.getByRole('tablist')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
  })

  it('canada: no destination switcher, Canadian quotes only', async () => {
    const PricingGrid = await loadGrid('canada')
    render(<PricingGrid quotes={QUOTES} />)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByText('selectCountry')).not.toBeInTheDocument()
    // Two CA quotes render, the US one never does.
    expect(screen.getAllByRole('link')).toHaveLength(2)
  })
})
