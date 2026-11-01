import { afterEach, describe, expect, it, vi } from 'vitest'

const { listConsultants } = vi.hoisted(() => ({ listConsultants: vi.fn() }))

vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/i18n/navigation', () => ({ Link: () => null }))
vi.mock('@/lib/api/marketplace', () => ({ listConsultants }))

async function run(mode: string, country?: string) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_SITE_MODE', mode)
  listConsultants.mockReset().mockResolvedValue([])
  const Page = (await import('./page')).default
  await Page({ searchParams: Promise.resolve({ country }) })
  return listConsultants.mock.calls[0][0]
}

afterEach(() => vi.unstubAllEnvs())

describe('ConsultantsPage — site scope', () => {
  it('global: forwards the requested country filter', async () => {
    expect(await run('', 'US')).toMatchObject({ country: 'US' })
    expect(await run('')).toMatchObject({ country: undefined })
  })

  it('canada: always browses Canadian consultants', async () => {
    expect(await run('canada', 'US')).toMatchObject({ country: 'CA' })
    expect(await run('canada')).toMatchObject({ country: 'CA' })
  })
})
