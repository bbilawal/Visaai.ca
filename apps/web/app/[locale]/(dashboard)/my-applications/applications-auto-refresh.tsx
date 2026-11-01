'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** How often a visible "My applications" tab re-pulls the list. */
export const REFRESH_INTERVAL_MS = 30_000

/**
 * Keeps the applicant's "My applications" list current (#38).
 *
 * When a consultant claimed an application, the applicant's page kept showing
 * "Not assigned" until a manual reload: it is a server component rendered once,
 * and applicants have no live channel (the assignment SSE stream is
 * consultant-only). This re-runs the server render — router.refresh(), the
 * same authoritative refetch the consultant queue uses — when the applicant
 * comes back to the tab and every REFRESH_INTERVAL_MS while it is visible.
 * Renders nothing.
 */
export function ApplicationsAutoRefresh() {
  const router = useRouter()

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') router.refresh()
    }
    const onVisibility = () => refreshIfVisible()
    const onFocus = () => refreshIfVisible()
    const timer = setInterval(refreshIfVisible, REFRESH_INTERVAL_MS)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router])

  return null
}
