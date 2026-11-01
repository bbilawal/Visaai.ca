/**
 * Parsing for OAuth sign-in failures handed back by Supabase Auth (GoTrue).
 *
 * A failed provider sign-in does NOT come back as an exception — GoTrue
 * redirects the browser to the site with the reason attached to the URL, and
 * for the implicit path it uses the *fragment*, which never reaches the server:
 *
 *   /applications/new#error=server_error&error_code=unexpected_failure
 *                    &error_description=Unable+to+exchange+external+code%253A+4%252F0A
 *
 * Nothing in the app read either form, so a completely broken provider was
 * indistinguishable from "the button did nothing": the user was silently left
 * on their pre-existing anonymous guest session, which every authenticated
 * route then bounces.
 *
 * Pure and framework-free so it can be unit-tested and shared by the server
 * `/callback` route (query params) and the client fragment listener (hash).
 */

/** Query param carrying the failure code from /callback to the login page. */
export const OAUTH_ERROR_PARAM = 'authError'
/** Query param carrying the provider's human-readable reason, if any. */
export const OAUTH_ERROR_DETAIL_PARAM = 'authErrorDetail'

export interface OAuthErrorInfo {
  /** Stable-ish machine code, e.g. `unexpected_failure`, `access_denied`. */
  code: string
  /** Provider prose. Untrusted — run through `sanitizeOAuthDescription` to render. */
  description: string | null
}

function toParams(
  input: string | URLSearchParams | null | undefined,
): URLSearchParams | null {
  if (!input) return null
  if (input instanceof URLSearchParams) return input
  const trimmed = input.replace(/^[#?]/, '')
  return trimmed ? new URLSearchParams(trimmed) : null
}

/**
 * GoTrue percent-encodes `error_description` a second time on the way into the
 * fragment, so one `URLSearchParams` decode leaves `code%3A 4%2F0A` behind.
 * Decode again while escapes remain, bounded so a description that legitimately
 * contains `%` (or a malformed escape) neither loops nor throws.
 */
function decodeRepeatedly(value: string, maxPasses = 2): string {
  let out = value
  for (let i = 0; i < maxPasses; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(out)) break
    let next: string
    try {
      next = decodeURIComponent(out)
    } catch {
      break
    }
    if (next === out) break
    out = next
  }
  return out
}

/**
 * Extract an OAuth failure from a URL fragment, query string, or
 * URLSearchParams. Returns null when the input carries no error — a successful
 * callback (`?code=…`) and an empty fragment both read as "nothing wrong".
 */
export function parseOAuthError(
  input: string | URLSearchParams | null | undefined,
): OAuthErrorInfo | null {
  const params = toParams(input)
  if (!params) return null

  // `error_code` is the specific one (`unexpected_failure`); `error` is the
  // OAuth2-spec bucket (`server_error`). Prefer the specific, accept either.
  const code = params.get('error_code') || params.get('error')
  if (!code) return null

  const description = decodeRepeatedly(params.get('error_description') ?? '')
  return { code, description: description || null }
}

/**
 * Make a provider description safe to render as text. It arrives from the URL,
 * so it is user-controllable: React escapes it against XSS, but that still
 * leaves room for injected instructions ("call this number"). Strip markup
 * characters and control characters, collapse whitespace, and cap the length so
 * it reads as a diagnostic rather than page copy.
 */
export function sanitizeOAuthDescription(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null
  const cleaned = raw
    .replace(/\p{C}/gu, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, 200) : null
}
