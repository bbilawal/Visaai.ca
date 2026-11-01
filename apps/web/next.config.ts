import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
import { buildCsp } from './lib/csp'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const isProd = process.env.NODE_ENV === 'production'

const csp = buildCsp({
  isProd,
  apiUrl: process.env.NEXT_PUBLIC_API_URL,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
})

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ...(isProd
    ? [
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains; preload',
        },
      ]
    : []),
]

const nextConfig: NextConfig = {
  // Deploys build into a staging dir (NEXT_DIST_DIR=.next-staging) and swap it
  // in, so the running server never reads a half-written .next. Unset at
  // runtime → '.next', which is where the swap puts the finished build.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // A staging build must not type-check the LIVE build's generated route types
  // (.next/types): a route removed in this release would fail the build.
  typescript: {
    tsconfigPath: process.env.NEXT_DIST_DIR ? 'tsconfig.staging.json' : 'tsconfig.json',
  },
  // Internal navigation goes through @/i18n/navigation (locale-aware Link /
  // useRouter / redirect): hrefs stay locale-LESS ("/login") and the helper
  // adds the active locale prefix, so they are not checked against the
  // [locale]-prefixed route tree. typedRoutes guards the remaining bare
  // next/link + next/navigation call sites (external links, fragments, and
  // route-group-relative hrefs). See VISAAIDocs features/i18n/PHASE-2-ROUTING-PLAN.md.
  typedRoutes: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default withNextIntl(nextConfig)
