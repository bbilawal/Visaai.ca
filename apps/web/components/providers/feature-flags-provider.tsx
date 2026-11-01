'use client'

import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import {
  DEFAULT_FLAGS,
  fetchFlags,
  type FlagMap,
} from '@/lib/api/feature-flags-client'

interface FlagsState {
  flags: FlagMap
  /** True until the first fetch settles (either way). */
  loading: boolean
  /** True when the values on screen are local defaults, not the server's. */
  degraded: boolean
}

const FlagsContext = createContext<FlagsState>({
  flags: DEFAULT_FLAGS,
  loading: true,
  degraded: true,
})

/**
 * Fetches evaluated flags once per mount and shares them through context.
 *
 * The initial state is `DEFAULT_FLAGS`, never an empty object. Starting empty
 * would make every flag read `false` for the first paint, which flickers live
 * features off and then back on — and, worse, would read as "payments are
 * disabled" during the fetch. Starting from the registry defaults means the
 * first paint is already the correct answer for everything not being rolled
 * out, and only genuinely targeted flags change when the response lands.
 *
 * A failed fetch leaves the defaults in place and sets `degraded`, so a caller
 * that needs to distinguish "off" from "unknown" can. Most callers should not:
 * the defaults are chosen so that acting on them is safe.
 *
 * This is a UI-only mechanism, exactly like `useAuthUser`. Every flag that
 * gates something that matters is ALSO enforced server-side by
 * `FeatureFlagGuard` — a user who flips this in devtools gets a 503 from the
 * API, not a feature.
 */
export function FeatureFlagsProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<FlagsState>({
    flags: DEFAULT_FLAGS,
    loading: true,
    degraded: true,
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const {
          data: { session },
        } = await getSession()
        if (!session) {
          // No session at all (not even a guest). Keep the defaults rather than
          // treating "not signed in" as "everything off".
          if (!cancelled) setState((s) => ({ ...s, loading: false }))
          return
        }
        const flags = await fetchFlags(session.access_token)
        if (!cancelled) {
          setState({ flags: { ...DEFAULT_FLAGS, ...flags }, loading: false, degraded: false })
        }
      } catch {
        if (!cancelled) setState((s) => ({ ...s, loading: false }))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  return <FlagsContext.Provider value={state}>{children}</FlagsContext.Provider>
}

/** Read one flag. Falls back to the registry default outside a provider. */
export function useFlag(key: string): boolean {
  const { flags } = useContext(FlagsContext)
  return flags[key] ?? DEFAULT_FLAGS[key] ?? false
}

/** Full state, for callers that need `loading` / `degraded`. */
export function useFlags(): FlagsState {
  return useContext(FlagsContext)
}

/**
 * Conditional render helper.
 *
 *   <IfFlag flag="beta_banner_enabled"><BetaBanner /></IfFlag>
 */
export function IfFlag({
  flag,
  children,
  fallback = null,
}: {
  flag: string
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const enabled = useFlag(flag)
  return useMemo(() => (enabled ? <>{children}</> : <>{fallback}</>), [enabled, children, fallback])
}
