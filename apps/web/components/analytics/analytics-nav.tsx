'use client'
import { Link, usePathname } from '@/i18n/navigation'

const TABS = ['executive', 'financial', 'visa', 'ai', 'consultant', 'journey', 'reports', 'alerts'] as const

export function AnalyticsNav({ labels }: { labels: Record<string, string> }) {
  const pathname = usePathname()
  // WEB-011: none of the eight analytics dashboards rendered a heading of any
  // level, so a screen-reader user navigating by heading landed on a page with
  // no title at all. The dashboards are visually self-describing via this nav,
  // so the heading is `sr-only` — it restores the document outline without
  // adding a title the sighted layout never had room for.
  const active = TABS.find((t) => pathname === `/analytics/${t}`)

  return (
    <>
      {active ? <h1 className="sr-only">{labels[active] ?? active}</h1> : null}
      <nav className="flex flex-wrap gap-4 border-b pb-2 mb-6" aria-label="Analytics sections">
        {TABS.map((t) => (
          <Link key={t} href={`/analytics/${t}`} className="text-sm hover:underline">
            {labels[t] ?? t}
          </Link>
        ))}
      </nav>
    </>
  )
}
