'use client'

import { cn } from '@/lib/utils'
import { LockIcon } from '@/components/ui/icons'
import { useAuthGate } from './auth-gate-provider'

interface Props {
  children: React.ReactNode
  /** Path to route to after the user signs in (passed to the modal). */
  target?: string
  /** Overlay label. */
  label?: string
  className?: string
}

/**
 * Blurs its children for gated users (guest / logged-out) and overlays a
 * focusable "sign in to unlock" affordance that opens the auth modal. The
 * content stays in the DOM (visible-but-blurred) so users can see the feature
 * exists; it is aria-hidden + non-interactive while gated. For permanent users
 * it renders children untouched.
 */
export function GatedRegion({ children, target, label = 'Sign in to unlock', className }: Props) {
  const { isGated, openAuthModal } = useAuthGate()

  if (!isGated) return <>{children}</>

  return (
    <div className={cn('gated', className)}>
      <div className="gated__content" aria-hidden="true" inert>
        {children}
      </div>
      <button
        type="button"
        className="gated__overlay"
        onClick={() => openAuthModal(target)}
      >
        <span className="gated__lock" aria-hidden>
          <LockIcon className="h-3.5 w-3.5" />
        </span>
        {label}
      </button>
    </div>
  )
}
