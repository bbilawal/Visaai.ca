'use client'
import { useEffect, useRef, useState } from 'react'
import { usePathname } from '@/i18n/navigation'
import { useAuthUser } from '@/lib/auth/use-auth-user'
import { getSession } from '@/lib/supabase/client'
import { analytics } from '@/lib/analytics/client'

/**
 * Fires the SP-A client analytics events: session.started (mount), page.viewed
 * (route change), user.identified (once when auth resolves). Renders nothing.
 * session.ended is auto-wired in the SDK (beforeunload). All calls no-op when
 * NEXT_PUBLIC_ANALYTICS_ENABLED=false.
 *
 * WHY THE ACCESS TOKEN IS PASSED
 *
 * `POST /analytics/collect` attributes an event to a user by reading the
 * VERIFIED JWT on the request — never a `user_id` in the payload, which a
 * client could forge. That is the right design, and it has one consequence:
 * an event sent without an Authorization header is stored with `user_id`
 * NULL, permanently and irrecoverably.
 *
 * This provider previously passed no token, so the SDK took its
 * `navigator.sendBeacon` path — and sendBeacon cannot set headers. Production
 * showed the result exactly: 788 page.viewed, 303 session.started and 142
 * user.identified events, with `user_id` NULL on every single one, and
 * `analytics_identity_map` empty. `user.identified`, whose entire purpose is
 * to link an anonymous visitor to a user, was the clearest case: fired 142
 * times, identifying nobody.
 *
 * Passing the token moves authenticated events onto the `fetch` path, which
 * does carry `Authorization`. Anonymous visitors still use sendBeacon and
 * still record — that is ANALYTICS-001, and top-of-funnel events must keep
 * working without a credential.
 */
export function AnalyticsProvider() {
  const pathname = usePathname()
  const { me } = useAuthUser()
  const [token, setToken] = useState<string | undefined>(undefined)
  const identified = useRef<string | null>(null)

  // Read the token only once a user actually resolves. A guest has no
  // permanent identity to attribute to, and asking for a session here would
  // mint an anonymous one purely as a side effect of loading analytics.
  useEffect(() => {
    if (!me?.id) {
      setToken(undefined)
      return
    }
    let cancelled = false
    void (async () => {
      try {
        const {
          data: { session },
        } = await getSession()
        if (!cancelled) setToken(session?.access_token)
      } catch {
        // Analytics must never break the page. An unattributed event is a
        // worse metric, not a worse experience.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [me?.id])

  useEffect(() => {
    analytics.startSession()
  }, [])

  // Re-fires on token arrival as well as on navigation, so the first page view
  // after sign-in is attributed rather than stranded on the anonymous id.
  useEffect(() => {
    analytics.page(pathname, token)
  }, [pathname, token])

  useEffect(() => {
    if (!me?.id || !token) return
    if (identified.current === me.id) return
    identified.current = me.id
    analytics.identify(me.id, token)
  }, [me?.id, token])

  return null
}
