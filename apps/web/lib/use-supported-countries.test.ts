import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useSupportedCountries } from './use-supported-countries'

// The hook localises country names, so it reads the active locale. Mocked
// rather than wrapped in a provider because every test here is about FETCH
// behaviour — retries, ordering, errors — and only the localisation test below
// cares which locale it is.
let mockLocale = 'en'
vi.mock('next-intl', () => ({ useLocale: () => mockLocale }))

const ok = (countries: unknown[]) =>
  ({ ok: true, json: async () => ({ countries }) }) as unknown as Response

// Worst case is the full backoff ladder (500 + 1500 + 3500 ms) plus the fetches
// around it, so anything asserting on exhausted retries needs a window wider
// than waitFor's 1s default.
const AFTER_ALL_RETRIES = { timeout: 12_000 }

describe('useSupportedCountries', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    mockLocale = 'en'
  })

  it('loads the list and preserves the server order', async () => {
    const rows = [
      { code: 'AU', name: 'Australia', group: 'priority' },
      { code: 'US', name: 'United States', group: 'priority' },
      { code: 'AT', name: 'Austria', group: 'schengen' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(rows)))

    const { result } = renderHook(() => useSupportedCountries())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // The API is the source of truth for grouping/ordering — the hook must not
    // re-sort, or the pinned priority order would be destroyed.
    expect(result.current.countries.map((c) => c.code)).toEqual(['AU', 'US', 'AT'])
    expect(result.current.error).toBeNull()
  })

  // BUG-003 regression. The destination picker disables itself whenever this
  // hook reports an error, and it is the ONLY entry point to the product — so a
  // single transient blip used to leave the user on a permanently dead form.
  it('recovers from a transient failure without ever surfacing an error', async () => {
    const rows = [{ code: 'CA', name: 'Canada', group: 'priority' }]
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network blip'))
      .mockResolvedValue(ok(rows))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSupportedCountries())

    await waitFor(() => expect(result.current.countries).toHaveLength(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    // The picker must never have been disabled by a transient error.
    expect(result.current.error).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  it('gives up after bounded retries and reports the error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('countries are down'))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSupportedCountries())

    await waitFor(() => expect(result.current.error).toBe('countries are down'), AFTER_ALL_RETRIES)
    // Retries are BOUNDED — one initial attempt plus three backoff retries.
    // An unbounded loop would hammer a genuinely down API forever.
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(result.current.loading).toBe(false)
  }, 20_000)

  it('exposes retry() so the UI can recover from a terminal failure', async () => {
    const rows = [{ code: 'GB', name: 'United Kingdom', group: 'priority' }]
    const fetchMock = vi.fn().mockRejectedValue(new Error('countries are down'))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSupportedCountries())
    await waitFor(() => expect(result.current.error).not.toBeNull(), AFTER_ALL_RETRIES)

    fetchMock.mockResolvedValue(ok(rows))
    act(() => result.current.retry())

    await waitFor(() => expect(result.current.countries).toHaveLength(1))
    expect(result.current.error).toBeNull()
  }, 20_000)

  it('does not fire a queued retry after unmount', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network blip'))
    vi.stubGlobal('fetch', fetchMock)

    const { unmount } = renderHook(() => useSupportedCountries())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    unmount()

    const afterUnmount = fetchMock.mock.calls.length
    // First backoff fires at 500ms; wait well past it and prove nothing ran.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 1_500))
    })
    expect(fetchMock).toHaveBeenCalledTimes(afterUnmount)
  })

  it('LOCALISES the names, and does not reorder the pinned group', async () => {
    // The bug: /countries returns English names from the strategy registry and
    // carries no locale, so an entirely Urdu page rendered "Australia",
    // "United States", "Canada". Localising in the hook means a page added
    // later cannot forget to do it.
    mockLocale = 'de'
    const rows = [
      { code: 'AU', name: 'Australia', group: 'priority' },
      { code: 'US', name: 'United States', group: 'priority' },
      { code: 'NL', name: 'Netherlands', group: 'schengen' },
      { code: 'AT', name: 'Austria', group: 'schengen' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(ok(rows)))

    const { result } = renderHook(() => useSupportedCountries())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.countries.map((c) => c.name)).toEqual([
      // Pinned corridors keep the API's fixed order even though alphabetising
      // them in German would move Kanada above Vereinigte Staaten.
      'Australien',
      'Vereinigte Staaten',
      // Schengen re-sorted by the GERMAN name: the API sorted these by their
      // English names, where Austria precedes Netherlands.
      'Niederlande',
      'Österreich',
    ])
  })
})
