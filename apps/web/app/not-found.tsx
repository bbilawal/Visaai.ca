import type { Metadata } from 'next'
import { SITE_BRAND } from '@/lib/site-config'

/**
 * Root 404.
 *
 * `notFound()` raised inside a page unwinds above the `[locale]` segment, so
 * this — not `app/[locale]/not-found.tsx` — is what a visitor actually sees for
 * a missing visa page or a bad URL.
 *
 * It renders its own `<html>` and `<body>` because the root layout is a
 * pass-through (see `layout.tsx`): the locale layout owns the document for
 * localized pages, and nothing owns it here. Without this, Next's synthesised
 * shell serves a document with no `lang` and no `<title>` — two `serious`
 * axe-core violations on every 404.
 *
 * Plain `<a>` rather than the i18n `<Link>`: no locale has been resolved at this
 * level, so there is no locale-aware router to route with. Inline styles for
 * the same reason the error page uses them — this must not depend on anything
 * that could itself be missing.
 */
export const metadata: Metadata = {
  title: `Page not found — ${SITE_BRAND}`,
  // A 404 has no content and dilutes the corpus. It must never be indexed.
  robots: { index: false, follow: true },
}

export default function NotFound() {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>
        <main
          style={{
            minHeight: '100dvh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1rem',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: '28rem' }}>
            <p
              style={{
                letterSpacing: '0.1em',
                textTransform: 'uppercase',
                fontSize: 12,
              }}
            >
              404
            </p>
            <h1 style={{ fontSize: '2rem', margin: '0.5rem 0 0.75rem' }}>
              Page not found
            </h1>
            <p style={{ fontSize: 14, marginBottom: '1.5rem' }}>
              The page you are looking for does not exist or has been moved.
            </p>
            <p style={{ fontSize: 14 }}>
              <a href="/">Go to the homepage</a>
              {' · '}
              <a href="/visas">Browse visa information</a>
            </p>
          </div>
        </main>
      </body>
    </html>
  )
}
