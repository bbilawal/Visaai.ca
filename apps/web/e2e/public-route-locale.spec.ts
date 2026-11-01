import { test, expect } from '@playwright/test'

/**
 * WEB-001 regression guard.
 *
 * `splitLocale` in proxy.ts stripped a leading locale segment ONLY when it was
 * not the default locale. So '/en/privacy' was classified as the literal path
 * '/en/privacy', matched nothing in the public-route list, and every
 * '/en/'-prefixed public URL redirected a logged-out visitor to /login.
 *
 * Non-default locales were unaffected ('/fr/privacy' worked), which is exactly
 * why it survived: the locale most people and most shared links use was the one
 * that was broken.
 *
 * Two directions are asserted, because the fix must not become a hole:
 *   - public routes stay reachable, prefixed or not
 *   - protected routes stay gated, prefixed or not
 */

const PUBLIC_ROUTES = [
  '/applications/new',
  '/privacy',
  '/terms',
  '/forbidden',
  // WEB-002: pricing must be readable before signing up.
  '/pricing',
]
const PROTECTED_ROUTES = ['/my-applications', '/profile', '/messages']

test.describe('public routes are reachable with and without a locale prefix', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route} — unprefixed`, async ({ page }) => {
      await page.goto(route)
      expect(new URL(page.url()).pathname).not.toBe('/login')
    })

    test(`/en${route} — default-locale prefix (the WEB-001 case)`, async ({ page }) => {
      await page.goto(`/en${route}`)
      // next-intl `as-needed` normalises /en/x to /x; the point is that it must
      // NOT have been bounced to /login on the way.
      expect(new URL(page.url()).pathname).not.toBe('/login')
    })

    test(`/fr${route} — non-default locale`, async ({ page }) => {
      await page.goto(`/fr${route}`)
      const path = new URL(page.url()).pathname
      expect(path).not.toBe('/login')
      expect(path).not.toBe('/fr/login')
    })
  }
})

test.describe('protected routes stay gated for logged-out visitors', () => {
  for (const route of PROTECTED_ROUTES) {
    test(`${route} — unprefixed redirects to login`, async ({ page }) => {
      await page.goto(route)
      expect(new URL(page.url()).pathname).toBe('/login')
    })

    test(`/en${route} — prefixed still redirects to login`, async ({ page }) => {
      // The WEB-001 fix widened locale stripping. This asserts it did not
      // accidentally make authenticated areas publicly reachable.
      await page.goto(`/en${route}`)
      expect(new URL(page.url()).pathname).toBe('/login')
    })
  }
})
