'use client'

import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/i18n/navigation'
import { cn } from '@/lib/utils'
import { LanguageSelector } from '@/components/language-selector'
import { useAuthUser } from '@/lib/auth/use-auth-user'
import { navForRole } from '@/lib/nav/nav-config'
// Single unified notification bell — system events + message pings over one
// realtime feed (Increment 7). The former messaging bell was retired.
import { NotificationBell } from '@/components/notifications/notification-bell'
import { ThemeToggle } from '@/components/ui/theme-toggle'

interface SidebarProps {
  userEmail?: string
  userFullName?: string
}

export function Sidebar({ userEmail, userFullName }: SidebarProps) {
  const t = useTranslations('nav')
  const pathname = usePathname()
  const { appRole, loading } = useAuthUser()
  const displayName = userFullName || userEmail || 'Account'

  // UI-only role gating. If the role fetch is still loading we show skeletons;
  // if it failed (appRole === null) navForRole degrades to common-only links —
  // a missing/failed role can never reveal a privileged link. Real auth lives
  // in the server-side route-group guards + backend, not here.
  const navItems = navForRole(appRole)

  return (
    <aside className="flex min-w-0 items-center md:flex-col md:items-stretch w-full md:w-[220px] md:h-screen md:sticky md:top-0 border-b md:border-b-0 md:border-r border-subtle-ash bg-canvas-white px-4 md:px-0">
      <div className="shrink-0 py-3 md:px-4 md:py-5 md:border-b md:border-subtle-ash me-auto md:me-0">
        {/* Brand wordmark. `priority` because this sits above the fold on every
            authenticated page, and the intrinsic size is the asset's own ratio
            so Next can reserve space and avoid a layout shift. `brand-plate`
            adds the light backing the artwork needs on the dark canvas — see
            globals.css. */}
        <Image
          src="/brand/wordmark-v3.png"
          alt="VisaAI"
          width={1109}
          height={325}
          priority
          className="brand-plate h-7 w-auto md:h-8"
        />
      </div>

      <nav
        aria-label="Primary"
        aria-busy={loading}
        // On a phone this is a horizontal bar and seven links do not fit in
        // 375px. Scrolling the NAV keeps the page itself from scrolling
        // sideways, which is what WCAG 2.2 §1.4.10 actually prohibits. On
        // md+ it reverts to the vertical sidebar and nothing scrolls.
        className="flex min-w-0 overflow-x-auto md:overflow-x-visible md:flex-col md:flex-1 gap-1 md:gap-0.5 md:px-2 md:py-3"
      >
        {loading
          ? // Loading state: placeholder rows that match nav item geometry.
            Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                aria-hidden="true"
                className="h-7 w-[88px] md:w-auto mx-1 my-0.5 rounded-[10px] bg-ghost-gray animate-pulse"
              />
            ))
          : navItems.map(item => {
              const isActive =
                item.href === '/' ? pathname === '/' : pathname.startsWith(item.href as string)

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  // PERF-001: the sidebar is permanently in the viewport, so the
                  // default viewport-prefetch fired an RSC render for EVERY nav
                  // item on EVERY page view — measured 53 prefetch requests for
                  // one load of /applications on an admin account, each one a
                  // real server render with its own queries (/admin, /users,
                  // /audit, /registry …). `false` keeps the hover/touch-start
                  // prefetch, which is what actually precedes a click, and drops
                  // the on-sight storm.
                  prefetch={false}
                  aria-current={isActive ? 'page' : undefined}
                  className={cn(
                    'flex shrink-0 items-center whitespace-nowrap px-3 py-1.5 rounded-[10px] text-[14px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep-black focus-visible:ring-offset-1 focus-visible:ring-offset-canvas-white',
                    isActive
                      ? 'bg-ghost-gray text-deep-black font-medium'
                      : 'text-midtone-gray hover:text-rich-black hover:bg-ghost-gray'
                  )}
                >
                  {t(item.labelKey)}
                </Link>
              )
            })}
      </nav>

      {/* min-w-0 so this row may shrink below its content width, and the
          language <select> is capped: on a 375px screen the bell, the full
          language name and "Sign out" together measured 532px and pushed the
          page into horizontal scroll (WCAG 2.2 §1.4.10). Only visible once
          screenshots waited for the real webfonts — the fallback font was
          narrow enough to hide it. */}
      <div className="flex shrink-0 items-center gap-3 md:block ms-auto md:ms-0 py-3 md:px-4 md:py-4 md:border-t md:border-subtle-ash">
        <NotificationBell />
        {/* md+ only: the mobile top bar is already full, and adding the
            toggle there pushed the page into horizontal scroll. Mobile users
            get it on the profile page instead, which is where a persistent
            preference belongs anyway. */}
        <div className="hidden md:block md:mb-3">
          <ThemeToggle />
        </div>
        <LanguageSelector
          persistToAccount
          className="lang-selector min-w-0 max-w-[7.5rem] shrink md:max-w-none md:mb-3"
        />
        {(userFullName || userEmail) && (
          <p
            className="hidden md:block text-[12px] text-midtone-gray truncate md:mb-2"
            title={userEmail}
          >
            {displayName}
          </p>
        )}
        <form action="/api/auth/signout" method="post">
          <button
            type="submit"
            className="whitespace-nowrap text-[12px] text-midtone-gray hover:text-rich-black focus-visible:outline-none focus-visible:underline transition-colors cursor-pointer"
          >
            {t('signOut')}
          </button>
        </form>
      </div>
    </aside>
  )
}
