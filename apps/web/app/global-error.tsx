'use client'

/**
 * The last-resort error document.
 *
 * `global-error.tsx` replaces the ROOT layout when an error escapes every other
 * boundary, so unlike a normal error page it must render its own `<html>` and
 * `<body>`. Next.js's built-in fallback renders a bare `<html>` — no `lang`, no
 * `<title>` — which axe-core rates `serious` twice over:
 *
 *   html-has-lang    a screen reader has no idea what language to pronounce
 *   document-title   the tab, history entry and bookmark are unnamed, and a
 *                    screen-reader user gets nothing announced on load
 *
 * Found by adding a visa page to the accessibility gate: in an environment
 * where the registry is unreachable the page throws, and the resulting error
 * document failed WCAG. The page throwing is a separate matter; the error
 * document being inaccessible affects every unhandled error on the site.
 *
 * Inline styles rather than the design system on purpose: this renders when
 * something is already broken, and it must not depend on anything that could be
 * the thing that broke.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <head>
        <title>Something went wrong — VisaAI</title>
        {/* An error page must never be indexed. */}
        <meta name="robots" content="noindex" />
      </head>
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
          <div style={{ textAlign: 'center', maxWidth: '30rem' }}>
            <h1 style={{ fontSize: '1.75rem', marginBottom: '0.75rem' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 14, marginBottom: '1.5rem' }}>
              This page could not be loaded. Your data has not been changed.
            </p>
            {/*
              The digest is the only handle support has on a specific
              occurrence, and it carries no user data — it is a hash of the
              server-side error. The error MESSAGE is deliberately not shown:
              it can contain query text and internal identifiers.
            */}
            {error.digest ? (
              <p style={{ fontSize: 12, marginBottom: '1.5rem' }}>
                Reference: <code>{error.digest}</code>
              </p>
            ) : null}
            <button
              type="button"
              onClick={reset}
              style={{ padding: '0.5rem 1rem', fontSize: 14, cursor: 'pointer' }}
            >
              Try again
            </button>
            <p style={{ fontSize: 14, marginTop: '1.5rem' }}>
              <a href="/">Go to the homepage</a>
            </p>
          </div>
        </main>
      </body>
    </html>
  )
}
