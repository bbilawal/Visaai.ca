import { createClient } from '@/lib/supabase/server'
import { resolveSafeNext } from '@/lib/auth/safe-next'
import {
  parseOAuthError,
  OAUTH_ERROR_PARAM,
  OAUTH_ERROR_DETAIL_PARAM,
} from '@/lib/auth/oauth-error'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const code = searchParams.get('code')
  const next = resolveSafeNext(searchParams.get('next'))
  const redirectUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'

  /** Send the user somewhere they can act on the failure, with the reason. */
  const failed = (errorCode: string, description?: string | null) => {
    const params = new URLSearchParams({ [OAUTH_ERROR_PARAM]: errorCode })
    if (description) params.set(OAUTH_ERROR_DETAIL_PARAM, description)
    return NextResponse.redirect(`${redirectUrl}/login?${params.toString()}`)
  }

  // The provider (or GoTrue) can hand back a failure instead of a code. This
  // used to be ignored outright, so a dead provider redirected the user onward
  // as if sign-in had succeeded — leaving them on their anonymous guest session
  // with no clue why every page bounced them.
  const providerError = parseOAuthError(searchParams)
  if (providerError) {
    return failed(providerError.code, providerError.description)
  }

  if (code) {
    const supabase = await createClient()
    // The result was previously discarded. An exchange can fail on its own
    // (expired or replayed code, PKCE verifier mismatch) and must not fall
    // through to the success redirect.
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return failed('exchange_failed', error.message)
  }

  return NextResponse.redirect(`${redirectUrl}${next}`)
}
