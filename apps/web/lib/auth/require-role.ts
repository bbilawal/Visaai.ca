import { getLocale } from 'next-intl/server'
import { redirect } from '@/i18n/navigation'
import { createClient } from '@/lib/supabase/server'
import { ApiError, apiFetch } from '@/lib/api/client'
import type { AppRole, Me } from '@/lib/api/me'

/**
 * SERVER-SIDE RBAC gate for route-group layouts. Resolves the role via the API
 * GET /me (the source of truth — NEVER decodes the JWT in the browser).
 *  - no session            -> /login
 *  - role not allowed       -> /forbidden
 *  - admin                  -> always allowed
 */
export async function requireRole(allowed: AppRole[]): Promise<Me> {
  const locale = await getLocale()
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) redirect({ href: '/login', locale })

  let me: Me
  try {
    me = await apiFetch<Me>('/me', session.access_token)
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) redirect({ href: '/login', locale })
    throw err
  }

  if (me.appRole === 'admin') return me
  if (!allowed.includes(me.appRole)) redirect({ href: '/forbidden', locale })
  return me
}
