'use client'

import { useEffect, useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { getMe, type AppRole, type Me } from '@/lib/api/me'

/**
 * UI-ONLY auth hook. For rendering/menus — NEVER a security boundary. Real
 * authorization is server-side (require-role layouts + backend guards).
 */
export function useAuthUser(): { me: Me | null; appRole: AppRole | null; loading: boolean } {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const {
          data: { session },
        } = await getSession()
        if (session && !cancelled) setMe(await getMe(session.access_token))
      } catch {
        // UI-only: silently leave me=null
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  return { me, appRole: me?.appRole ?? null, loading }
}

/** UI gating only. */
export function useHasRole(role: AppRole): boolean {
  const { me } = useAuthUser()
  return me?.appRole === 'admin' || me?.appRole === role
}
