'use client'

import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Alert } from '@/components/ui/alert'
import {
  sanitizeOAuthDescription,
  OAUTH_ERROR_PARAM,
  OAUTH_ERROR_DETAIL_PARAM,
} from '@/lib/auth/oauth-error'

/**
 * Shows why a provider sign-in failed, from the params `/callback` and the
 * fragment listener redirect with. Renders nothing when there is no failure.
 *
 * Must be wrapped in <Suspense> by the caller: `useSearchParams` opts the
 * subtree into client rendering, and without a boundary the whole login page
 * would be excluded from prerendering.
 */
export function OAuthErrorAlert() {
  const t = useTranslations('auth')
  const params = useSearchParams()

  const code = params.get(OAUTH_ERROR_PARAM)
  if (!code) return null

  // Backing out at the provider's consent screen is a choice, not a fault.
  const message =
    code === 'access_denied' ? t('errOauthCancelled') : t('errOauthFailed')
  const detail = sanitizeOAuthDescription(params.get(OAUTH_ERROR_DETAIL_PARAM))

  return (
    <Alert variant="error">
      {/* `.alert` lays its children out in a flex row (for the icon slot), so
          the message and its detail share one column to stack vertically. */}
      <div className="min-w-0">
        <span className="block">{message}</span>
        {detail && (
          // The provider's own words, kept for support/debugging. Untrusted
          // input — sanitized above, rendered as plain text, never as markup.
          <span className="mt-1 block text-[11px] break-words opacity-80">
            {detail}
          </span>
        )}
      </div>
    </Alert>
  )
}
