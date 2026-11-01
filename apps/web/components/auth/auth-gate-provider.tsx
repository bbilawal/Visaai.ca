'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { getSession } from '@/lib/supabase/client'
import { getMe } from '@/lib/api/me'
import { track } from '@/lib/analytics'
import { AuthModal } from './auth-modal'

export type AuthStatus = 'loading' | 'loggedOut' | 'guest' | 'permanent'

interface AuthGateValue {
  status: AuthStatus
  /** True when features should be gated (guest or logged-out). */
  isGated: boolean
  /** Open the auth modal. `target` = path to send the user to after success. */
  openAuthModal: (target?: string) => void
  closeAuthModal: () => void
  /** Re-read the session/identity (call after an in-place upgrade). */
  refresh: () => Promise<void>
}

// Safe default for consumers rendered OUTSIDE the provider (e.g. the
// authenticated dashboard): treat as permanent so nothing is ever gated there.
const DEFAULT: AuthGateValue = {
  status: 'permanent',
  isGated: false,
  openAuthModal: () => {},
  closeAuthModal: () => {},
  refresh: async () => {},
}

const AuthGateContext = createContext<AuthGateValue>(DEFAULT)

export const useAuthGate = (): AuthGateValue => useContext(AuthGateContext)

/**
 * Provides client-side auth state (logged-out / guest / permanent) and a single
 * shared auth modal for the public funnel. UI ONLY — never a security boundary;
 * the backend JwtGuard + RLS are the real gate.
 */
export function AuthGateProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [modalOpen, setModalOpen] = useState(false)
  const [target, setTarget] = useState<string | null>(null)

  // Pure resolver (no setState) so it can run inside the effect without tripping
  // the set-state-in-effect rule; callers decide what to do with the result.
  const computeStatus = useCallback(async (): Promise<AuthStatus> => {
    try {
      const { data: { session } } = await getSession()
      if (!session) return 'loggedOut'
      try {
        const me = await getMe(session.access_token)
        return me.isAnonymous ? 'guest' : 'permanent'
      } catch {
        // Have a session but /me failed — gate conservatively as a guest.
        return 'guest'
      }
    } catch {
      return 'loggedOut'
    }
  }, [])

  const refresh = useCallback(async () => {
    setStatus(await computeStatus())
  }, [computeStatus])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const next = await computeStatus()
      if (!cancelled) setStatus(next)
    })()
    return () => { cancelled = true }
  }, [computeStatus])

  // Fire unlock analytics on the gated -> permanent transition (covers email
  // upgrades and OAuth that completes after a redirect). A returning permanent
  // user (loading -> permanent) was never gated this session, so no event.
  const prevStatus = useRef<AuthStatus>('loading')
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = status
    if (status === 'permanent' && (prev === 'guest' || prev === 'loggedOut')) {
      track('documents_unlocked')
      try {
        if (sessionStorage.getItem('va.pendingSignup')) {
          track('signup_completed', { method: 'oauth' })
          sessionStorage.removeItem('va.pendingSignup')
        }
      } catch {
        // sessionStorage unavailable — ignore
      }
    }
  }, [status])

  const openAuthModal = useCallback((t?: string) => {
    track('auth_modal_opened', { target: t ?? null })
    setTarget(t ?? null)
    setModalOpen(true)
  }, [])

  const closeAuthModal = useCallback(() => setModalOpen(false), [])

  const isGated = status === 'guest' || status === 'loggedOut'

  return (
    <AuthGateContext.Provider value={{ status, isGated, openAuthModal, closeAuthModal, refresh }}>
      {children}
      {modalOpen && (
        <AuthModal
          status={status}
          target={target}
          onClose={closeAuthModal}
          onUpgraded={refresh}
        />
      )}
    </AuthGateContext.Provider>
  )
}
