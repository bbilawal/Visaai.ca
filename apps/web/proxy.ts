import createMiddleware from 'next-intl/middleware'
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { routing } from './i18n/routing'
import { LOCALES, DEFAULT_LOCALE } from './i18n/config'

const handleI18n = createMiddleware(routing)

/** Split a leading locale prefix off the path for auth classification.
 *  '/fr/login' -> { prefix: '/fr', path: '/login' }
 *  '/en/login' -> { prefix: '',    path: '/login' }   (default locale: as-needed)
 *  '/login'    -> { prefix: '',    path: '/login' }
 *
 *  WEB-001: this previously skipped the stripping entirely when the segment WAS
 *  the default locale, so '/en/privacy' was classified as the literal path
 *  '/en/privacy'. That matched no entry in the public-route list, so every
 *  '/en/'-prefixed public URL redirected a logged-out visitor to /login —
 *  including /en/privacy and /en/terms, which must stay publicly reachable, and
 *  /en/applications/new, the guest funnel's front door. Non-default locales
 *  ('/fr/...') were unaffected, which is why it went unnoticed.
 *
 *  The default locale still yields an EMPTY prefix, so redirect targets stay
 *  unprefixed and next-intl's `as-needed` behaviour is preserved. */
function splitLocale(pathname: string): { prefix: string; path: string } {
  const seg = pathname.split('/')[1] ?? ''
  if ((LOCALES as readonly string[]).includes(seg)) {
    const prefix = seg === DEFAULT_LOCALE ? '' : `/${seg}`
    return { prefix, path: pathname.slice(seg.length + 1) || '/' }
  }
  return { prefix: '', path: pathname }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  // API + auth callback must NOT be localized — refresh the session only.
  const skipI18n =
    pathname.startsWith('/api') || pathname.startsWith('/callback')

  // 1. Locale routing first (prefix normalization + locale cookie). For the
  //    default locale (as-needed) this is a transparent rewrite.
  const response = skipI18n
    ? NextResponse.next({ request })
    : handleI18n(request)

  // 2. Refresh the Supabase session, writing refreshed auth cookies onto the
  //    response from step 1 so both the i18n and auth cookies survive.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // (A) A request with no Supabase auth cookie (prefix `sb-`) is definitively
  //     unauthenticated — there is no token to verify and nothing to refresh, so
  //     skip the auth lookup entirely. This spares the public funnel
  //     (/applications/new, /intake) a per-request auth call on every visit.
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-'))

  // (B) getClaims() verifies the JWT LOCALLY against the project's JWKS when
  //     asymmetric signing keys are enabled — no network round-trip per request.
  //     It calls getSession() internally, so an expiring token is still refreshed
  //     and the rotated cookies are written via the setAll callback above. With
  //     legacy HS256 secrets it transparently falls back to a getUser() network
  //     check, so this is safe (no weaker) regardless of the project's key type.
  let user: { id: string } | null = null
  let isAnonymous = false
  if (hasAuthCookie) {
    const { data } = await supabase.auth.getClaims()
    const claims = data?.claims as
      | { sub?: string; is_anonymous?: boolean }
      | undefined
    if (claims?.sub) {
      user = { id: claims.sub }
      isAnonymous = claims.is_anonymous === true
    }
  }

  // 3. Auth classification on the locale-stripped path; redirect targets re-add
  //    the active locale prefix so the user stays in their language.
  const { prefix, path } = splitLocale(pathname)
  const redirectTo = (target: string) => {
    const res = NextResponse.redirect(new URL(`${prefix}${target}`, request.url))
    response.cookies.getAll().forEach((c) => res.cookies.set(c))
    return res
  }

  const isAuthRoute = path === '/login' || path === '/signup'
  const isPasswordFlow =
    path === '/forgot-password' || path === '/reset-password'
  const isLegalOrError =
    path === '/privacy' || path === '/terms' || path === '/forbidden'
  // WEB-002: pricing is a marketing page — a prospect must be able to read it
  // before creating an account. It was gated purely by omission from this list.
  //
  // The visa reference pages are public for the same reason, and more sharply:
  // they exist to be found by search engines and cited by answer engines. A
  // public page that 307s a logged-out visitor to /login is invisible to both —
  // a crawler follows the redirect, indexes the login page, and every one of
  // these URLs is worth nothing. This list is the whole gate, so a route that
  // is public by intent is private by default until it appears here.
  // /bots is the page the source monitor's own User-Agent advertises. An
  // administrator who follows it must reach it without an account — a crawler
  // disclosure page behind a login is worse than none, because it proves the
  // operator is not serious about being contactable.
  const isMarketing =
    path === '/pricing' ||
    path === '/visas' ||
    path.startsWith('/visas/') ||
    path === '/bots'
  const isPublicFunnel =
    path === '/applications/new' || path.startsWith('/intake/')
  const isPublicRoute =
    isAuthRoute ||
    isPasswordFlow ||
    isLegalOrError ||
    isMarketing ||
    isPublicFunnel ||
    path.startsWith('/callback') ||
    path.startsWith('/api')

  // Site entry: a brand-new visitor on the bare root starts in the public funnel.
  if (!user && path === '/') return redirectTo('/applications/new')

  // Logged-out users may only reach public routes.
  if (!user && !isPublicRoute) return redirectTo('/login')

  // Permanent users are bounced off auth pages; anonymous guests may stay to
  // upgrade their session.
  if (user && !isAnonymous && isAuthRoute) return redirectTo('/')

  return response
}

export const config = {
  matcher: [
    // robots.txt, llms.txt, sitemap.xml and /.well-known are excluded because
    // they are
    // NOT localised pages. While the matcher caught them, this proxy 307'd
    // /robots.txt into the localised app and crawlers received an HTML document
    // instead of crawl directives.
    //
    // /.well-known matters more than it looks: iOS does NOT follow redirects
    // when fetching apple-app-site-association, so a 307 here is indistinguishable
    // from the file not existing and Universal Links silently never work.
    //
    // `zip` is here for the same reason (MEASURED 2026-08-13): the packaged
    // Chrome extension at /extension/visaai-portal-assistant.zip was rewritten
    // into the localised app, so the download answered 200 with an HTML page.
    // A browser saves that as a .zip it cannot open — the failure looks like a
    // corrupt download rather than a routing bug.
    '/((?!_next/static|_next/image|favicon.ico|robots\\.txt|llms\\.txt|sitemap\\.xml|\\.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|zip)$).*)',
  ],
}
