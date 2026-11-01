import { createNavigation } from 'next-intl/navigation'
import { routing } from './routing'

/**
 * Locale-aware navigation. Drop-in replacements for next/link + next/navigation
 * that automatically keep the active locale prefix. Migrate internal navigation
 * to import from here so links/redirects preserve the user's locale:
 *
 *   import { Link, useRouter, redirect, usePathname } from '@/i18n/navigation'
 *
 * (For the default locale these produce unprefixed URLs, identical to today.)
 */
const nav = createNavigation(routing)

export const { Link, usePathname, useRouter, getPathname } = nav

/**
 * `nav.redirect` is a generic const whose `never` return type does NOT trigger
 * TypeScript's control-flow narrowing at call sites (CFA only honours `never`
 * from plain function/arrow declarations, not complex instantiated property
 * signatures). Re-wrap it as a plain `(): never` function so guard patterns
 * like `if (!user) redirect({ href: '/login', locale })` narrow `user` to
 * non-null afterwards — matching how next/navigation's `redirect` behaves.
 */
export function redirect(
  ...args: Parameters<typeof nav.redirect>
): never {
  return nav.redirect(...args)
}
