'use client'

import { useEffect } from 'react'
import { useRouter } from '@/i18n/navigation'
import {
  parseOAuthError,
  OAUTH_ERROR_PARAM,
  OAUTH_ERROR_DETAIL_PARAM,
} from '@/lib/auth/oauth-error'

/**
 * Catches an OAuth failure that Supabase Auth put in the URL *fragment*.
 *
 * The fragment never reaches the server, so `/callback` cannot see this class
 * of failure — GoTrue redirects straight to the site root with
 * `#error=…&error_description=…` and the app rendered as if nothing had
 * happened. The user stayed on their anonymous guest session and read the
 * resulting bounces as "the buttons are broken".
 *
 * Mounted once in the locale layout because the landing page is whatever
 * `SITE_URL` points at (observed: `/applications/new`), not a route we control.
 */
export function OAuthErrorListener() {
  const router = useRouter()

  useEffect(() => {
    const info = parseOAuthError(window.location.hash)
    if (!info) return

    // Drop the fragment before navigating: it keeps the raw provider error out
    // of the address bar and out of the back-stack, so returning to this page
    // cannot re-fire the redirect.
    window.history.replaceState(
      null,
      '',
      window.location.pathname + window.location.search,
    )

    const query: Record<string, string> = { [OAUTH_ERROR_PARAM]: info.code }
    if (info.description) query[OAUTH_ERROR_DETAIL_PARAM] = info.description

    router.replace({ pathname: '/login', query })
  }, [router])

  return null
}
