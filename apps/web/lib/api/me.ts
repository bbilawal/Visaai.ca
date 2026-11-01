import { apiFetch } from './client'

export type AppRole = 'admin' | 'consultant' | 'user'

export interface Me {
  id: string
  email: string
  appRole: AppRole
  /** True for a guest (Supabase anonymous identity). Gated UI keys off this. */
  isAnonymous: boolean
}

/** Client-side identity (UI only). Caller passes a browser session token. */
export const getMe = (token: string) => apiFetch<Me>('/me', token)
