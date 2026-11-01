import { createClient } from '@/lib/supabase/server'
import { ApiError, apiFetch } from './client'

/**
 * Server-side authenticated API call. Pulls the caller's Supabase access token
 * from the SSR session and forwards it to the NestJS API (the source of truth).
 */
export async function serverApi<T>(path: string, init?: RequestInit): Promise<T> {
  const supabase = await createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new ApiError(401, 'no session')
  return apiFetch<T>(path, session.access_token, init)
}
