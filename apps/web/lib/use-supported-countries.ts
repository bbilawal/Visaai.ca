'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLocale } from 'next-intl'
import { localizeCountries } from './localize-country-name'
import { isCountryInSiteScope, SITE_CONFIG } from './site-config'

export type CountryGroup = 'priority' | 'schengen' | 'other'

export interface SupportedCountry {
  /** ISO-2 code, or 'SCHENGEN' for the area-wide bloc. */
  code: string
  name: string
  /**
   * Display group from the API: 'priority' (pinned, fixed order), 'schengen',
   * or 'other'. Optional for backward-compat with an older API response.
   */
  group?: CountryGroup
  /**
   * Whether the browser extension can fill this destination's government
   * portal. Optional for the same backward-compat reason as `group`: an older
   * API omits it, and a missing answer must read as "no" rather than as an
   * offer we cannot honour.
   */
  assistedFill?: boolean
}

/**
 * Single source of truth for the destination-country dropdowns.
 *
 * Fetches the supported list from the API (GET /countries), which is derived
 * live from the backend strategy registry. The web app no longer hardcodes any
 * country list — the dropdown can only ever offer countries VisaAI actually
 * supports, and it stays in sync automatically when a country strategy is
 * added or removed on the backend.
 */
/** Bounded backoff, in ms, for transient failures. */
const RETRY_DELAYS_MS = [500, 1500, 3500] as const

export function useSupportedCountries() {
  const [countries, setCountries] = useState<SupportedCountry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const locale = useLocale()
  // Bumping this re-runs the effect — the hook's manual retry handle.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let active = true
    // Timers are tracked so an unmount mid-backoff cannot fire a stale retry.
    const timers: ReturnType<typeof setTimeout>[] = []
    setLoading(true)
    setError(null)

    if (SITE_CONFIG.mode === 'canada') {
      setCountries([{ code: 'CA', name: 'Canada', group: 'priority', assistedFill: true }])
      setLoading(false)
      return () => {
        active = false
      }
    }

    // This list gates the ONLY entry point to the product: the destination
    // picker disables itself whenever this hook reports an error. A single
    // transient blip used to be terminal — one failed GET left the user on a
    // dead form with no way forward but a manual page reload. So transient
    // failures are now retried with bounded backoff before the error surfaces.
    const load = (tryIndex: number): void => {
      fetch(`${process.env.NEXT_PUBLIC_API_URL}/countries`)
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load countries (${res.status})`)
          return (await res.json()) as { countries: SupportedCountry[] }
        })
        .then((data) => {
          if (!active) return
          // Preserve the server's grouped order (priority → Schengen → other).
          // The API is the single source of truth for grouping/ordering; do NOT
          // re-sort here or the pinned priority order would be destroyed.
          setCountries((data.countries ?? []).filter((country) => isCountryInSiteScope(country.code)))
          setError(null)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (!active) return
          const delay = RETRY_DELAYS_MS[tryIndex]
          if (delay !== undefined) {
            timers.push(setTimeout(() => active && load(tryIndex + 1), delay))
            return
          }
          // Retries exhausted — surface the failure, and leave `retry` as the
          // caller's escape hatch so the UI can offer a way out.
          setError(err instanceof Error ? err.message : 'Failed to load countries')
          setLoading(false)
        })
    }

    load(0)

    return () => {
      active = false
      for (const t of timers) clearTimeout(t)
    }
  }, [attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  /**
   * Localisation happens HERE, not at the call sites, because the bug it fixes
   * was precisely that a call site did not do it. `GET /countries` returns
   * English names from the strategy registry and carries no locale, so the
   * picker on `/ur/applications/new` rendered an entirely Urdu page whose
   * options read "Australia", "United States", "Canada".
   *
   * Putting it in the hook means a page added tomorrow gets translated names
   * without anyone remembering to ask for them. English is returned byte-for-
   * byte unchanged, and any country that cannot be translated keeps the API's
   * English name.
   */
  const localized = useMemo(
    () => localizeCountries(countries, locale),
    [countries, locale],
  )

  return { countries: localized, loading, error, retry }
}
