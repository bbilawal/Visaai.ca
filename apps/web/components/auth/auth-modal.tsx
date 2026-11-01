'use client'

import { useEffect, useRef, useState } from 'react'
import { Link, useRouter } from '@/i18n/navigation'
import {
  signInWithOAuth,
  linkOAuthIdentity,
  upgradeGuestEmail,
  signUp,
  getSession,
} from '@/lib/supabase/client'
import { getMe } from '@/lib/api/me'
import { track } from '@/lib/analytics'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Alert } from '@/components/ui/alert'
import { GoogleIcon, MicrosoftIcon } from '@/components/ui/icons'
import type { AuthStatus } from './auth-gate-provider'
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/password-strength'

interface Props {
  status: AuthStatus
  /** Where to send the user after a successful in-place upgrade. */
  target: string | null
  onClose: () => void
  onUpgraded: () => Promise<void>
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function AuthModal({ status, target, onClose, onUpgraded }: Props) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<HTMLElement | null>(null)

  const [mode, setMode] = useState<'choices' | 'email'>('choices')
  const [pending, setPending] = useState<'google' | 'azure' | 'email' | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Email already belongs to another account — we never auto-merge; offer login.
  const [collision, setCollision] = useState(false)
  // Upgrade succeeded but Supabase requires email confirmation before the
  // account becomes permanent; the user stays a guest until they confirm.
  const [confirmSent, setConfirmSent] = useState(false)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const isGuest = status === 'guest'
  const next = target ?? '/'

  // Focus management: remember the opener, focus the panel, trap Tab, Esc closes.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
      openerRef.current?.focus?.()
    }
  }, [onClose])

  async function handleOAuth(provider: 'google' | 'azure', label: string) {
    setPending(provider)
    setError(null)
    // Mark intent so signup_completed can fire when OAuth returns post-redirect
    // (the gated -> permanent transition is detected in AuthGateProvider).
    try { sessionStorage.setItem('va.pendingSignup', '1') } catch { /* ignore */ }
    // Guest: link the identity to the SAME uid (preserve intake data). Otherwise
    // a normal OAuth sign-in. Both redirect through /callback?next=<target>.
    const { error } = isGuest
      ? await linkOAuthIdentity(provider, next)
      : await signInWithOAuth(provider, next)
    if (error) {
      setPending(null)
      try { sessionStorage.removeItem('va.pendingSignup') } catch { /* ignore */ }
      setError(`Continue with ${label} is not available right now.`)
    }
    // On success the browser redirects to the provider; nothing more to do here.
  }

  async function handleEmail(e: React.FormEvent) {
    e.preventDefault()
    setPending('email')
    setError(null)
    setCollision(false)
    // Guest: upgrade in place (updateUser) so the uid — and all intake data —
    // is preserved. Logged-out: a fresh signUp.
    const { error } = isGuest
      ? await upgradeGuestEmail({ email, password, fullName: fullName.trim() || undefined })
      : await signUp({ email, password, fullName: fullName.trim() || undefined })

    if (error) {
      setPending(null)
      const msg = (error instanceof Error ? error.message : String(error)).toLowerCase()
      if (/registered|already|exists|taken|in use/.test(msg)) {
        // Collision: the email belongs to another account. We do NOT merge two
        // real accounts (data-loss risk). The guest keeps their session/data on
        // this device; offer a clean path to log in to the existing account.
        setCollision(true)
        setError('That email already has an account.')
      } else {
        setError('Could not create your account. Please try again.')
      }
      return
    }

    // Refresh gate state, then decide: immediate upgrade vs pending confirmation.
    await onUpgraded()
    let permanent = false
    try {
      const { data: { session } } = await getSession()
      if (session) {
        const me = await getMe(session.access_token)
        permanent = !me.isAnonymous
      }
    } catch {
      // fall through to the confirmation message
    }

    if (permanent) {
      track('signup_completed', { method: 'email' })
      onClose()
      router.push(next)
      router.refresh()
      return
    }

    // Email confirmation required: keep the user in the intake funnel (their
    // session is still anonymous, so a gated target would 403). Tell them to
    // confirm; they unlock automatically once verified.
    setPending(null)
    setConfirmSent(true)
  }

  function goToLogin() {
    onClose()
    router.push('/login')
  }

  function onBackdropClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) onClose()
  }

  return (
    <div className="modal-backdrop" onMouseDown={onBackdropClick}>
      <div
        ref={panelRef}
        className="modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
      >
        <button type="button" className="modal-close" aria-label="Close" onClick={onClose}>
          <span aria-hidden>✕</span>
        </button>

        <h2
          id="auth-modal-title"
          className="text-[18px] font-semibold tracking-[-0.45px] text-deep-black"
        >
          Create your free account
        </h2>
        <p className="text-[13px] text-midtone-gray mt-1 mb-5">
          Your interview and progress are saved — sign in to unlock documents,
          generation, readiness, and submission.
        </p>

        {confirmSent ? (
          <div className="mt-3 flex flex-col gap-4">
            <div className="rounded-[14px] bg-ghost-gray p-4">
              <p className="text-[14px] font-medium text-deep-black mb-1">Check your email</p>
              <p className="text-[13px] text-midtone-gray leading-[1.5]">
                We sent a confirmation link to{' '}
                <span className="text-rich-black">{email}</span>. Confirm it to unlock
                documents, generation, readiness, and submission — your interview and
                progress are saved.
              </p>
            </div>
            <Button type="button" className="w-full" onClick={onClose}>
              Got it
            </Button>
          </div>
        ) : (
        <>
        {error && <Alert variant="error">{error}</Alert>}
        {collision && (
          <Button
            type="button"
            variant="secondary"
            className="w-full mt-2"
            onClick={goToLogin}
          >
            Log in to that account
          </Button>
        )}

        {mode === 'choices' ? (
          <div className="flex flex-col gap-2 mt-3">
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center gap-2"
              loading={pending === 'google'}
              onClick={() => handleOAuth('google', 'Google')}
            >
              {pending !== 'google' && <GoogleIcon className="h-4 w-4" />}
              Continue with Google
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full justify-center gap-2"
              loading={pending === 'azure'}
              onClick={() => handleOAuth('azure', 'Microsoft')}
            >
              {pending !== 'azure' && <MicrosoftIcon className="h-4 w-4" />}
              Continue with Microsoft
            </Button>

            <div className="my-2 flex items-center gap-3">
              <span className="h-px flex-1 bg-subtle-ash" />
              <span className="text-[11px] text-midtone-gray">or</span>
              <span className="h-px flex-1 bg-subtle-ash" />
            </div>

            <Button
              type="button"
              variant="secondary"
              className="w-full justify-center"
              onClick={() => { setError(null); setMode('email') }}
            >
              Continue with Email
            </Button>

            <p className="mt-3 text-center text-[12px] text-midtone-gray">
              Already have an account?{' '}
              <Link
                href="/login"
                className="text-rich-black underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black rounded-sm"
                onClick={onClose}
              >
                Log in
              </Link>
            </p>
          </div>
        ) : (
          <form onSubmit={handleEmail} className="flex flex-col gap-3 mt-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="auth-name" className="text-[12px] font-medium text-rich-black">
                Full name <span className="text-midtone-gray font-normal">(optional)</span>
              </label>
              <Input
                id="auth-name"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="auth-email" className="text-[12px] font-medium text-rich-black">
                Email
              </label>
              <Input
                id="auth-email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoComplete="email"
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="auth-password" className="text-[12px] font-medium text-rich-black">
                Password
              </label>
              <PasswordInput
                id="auth-password"
                placeholder="At least 8 characters"
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                required
              />
            </div>
            <Button type="submit" loading={pending === 'email'} className="mt-1 w-full">
              Create account
            </Button>
            <button
              type="button"
              className="text-[12px] text-midtone-gray hover:text-rich-black underline underline-offset-2"
              onClick={() => { setError(null); setMode('choices') }}
            >
              <span className="inline-block rtl:-scale-x-100" aria-hidden>←</span> Back
            </button>
          </form>
        )}
        </>
        )}
      </div>
    </div>
  )
}
