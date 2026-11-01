import type { ReactNode } from 'react'

/**
 * Root layout — a deliberate pass-through.
 *
 * WHY IT RENDERS NO <html>
 *
 * `app/[locale]/layout.tsx` already renders `<html>` and `<body>`, because only
 * it knows the locale and therefore the `lang` and `dir` attributes. If this
 * layout also rendered them, every localized page would nest `<html>` inside a
 * `<body>` — React reports "In HTML, <html> cannot be a child of <body>. This
 * will cause a hydration error", which is exactly what happened when this file
 * was first added with a document shell.
 *
 * WHY IT EXISTS AT ALL
 *
 * Without any root layout, Next.js synthesises one, and the synthesised shell
 * is a bare `<html>` with no `lang` and no `<title>`. That only ever rendered
 * for `notFound()` and unhandled errors — which unwind ABOVE the locale
 * segment — so every 404 and 500 on the site was served as a document with no
 * language and no title. axe-core rates both `serious`.
 *
 * The fix is not a shell here; it is that `app/not-found.tsx` and
 * `app/global-error.tsx` each render their own complete document. This file
 * exists so those two are reachable as root-level boundaries.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children
}
