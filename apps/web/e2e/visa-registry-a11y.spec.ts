import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Accessibility of the registry-backed visa pages: /visas/{country} and
 * /visas/{country}/{visa}.
 *
 * WHY THESE ARE NOT IN design-system.spec.ts
 *
 * That suite's route list is fixed at module load and runs in BOTH web jobs.
 * The plain `web` job points NEXT_PUBLIC_SUPABASE_URL at example.supabase.co,
 * so `getCountryBySlug` finds nothing and the country page correctly renders a
 * 404 — axe would then inspect a not-found document and report it as a clean
 * page. That is worse than no coverage, because it looks like coverage.
 *
 * The `web-e2e-live` job is different: it runs `supabase start`, which applies
 * every migration in supabase/migrations, and the registration and promotion
 * migrations INSERT the registry rows. The pages therefore render real content
 * there, from the same data production serves.
 *
 * WHY A SKIP HERE CANNOT PASS SILENTLY
 *
 * The route list is discovered from the live /visas index rather than hardcoded,
 * and the suite skips when the index publishes no countries. In the live job
 * that skip is fatal: its report gate already fails the build on
 * `stats.skipped > 0`. So "the registry was not seeded" fails loudly in the job
 * that exists to test it, and is a quiet skip in the job that cannot.
 *
 * Discovering the slugs also means a new destination is covered the day it is
 * published, without anyone remembering to edit this file — the same reason the
 * coverage matrix is generated rather than typed.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/** Bounded so the suite's runtime does not grow with the registry. */
const MAX_COUNTRIES = 3

async function settle(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForLoadState('networkidle')
}

/**
 * Country hub paths, read off the published index.
 *
 * Returns [] when the registry is not reachable, which the tests turn into a
 * skip. Note this deliberately does NOT fall back to a hardcoded slug: a
 * hardcoded /visas/canada would 404 in the plain `web` job and the a11y
 * assertion would pass against the 404 page.
 */
async function countryPaths(page: Page): Promise<string[]> {
  await page.goto('/visas')
  await settle(page)
  const hrefs = await page.locator('a[href*="/visas/"]').evaluateAll((els) =>
    els
      .map((el) => (el as HTMLAnchorElement).getAttribute('href') ?? '')
      .filter((h) => /\/visas\/[^/]+$/.test(h)),
  )
  return [...new Set(hrefs)].slice(0, MAX_COUNTRIES)
}

test.describe('visa registry pages — accessibility', () => {
  test('country hubs have no WCAG A/AA violations', async ({ page }) => {
    const paths = await countryPaths(page)
    test.skip(
      paths.length === 0,
      'the visa registry publishes no countries in this environment — see the file header',
    )

    for (const path of paths) {
      await page.goto(path)
      await settle(page)
      // Proves we are on the hub and not on a 404 that happens to be clean.
      await expect(page.locator('h1')).toBeVisible()

      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
      expect(results.violations, `${path} has WCAG violations`).toEqual([])
    }
  })

  test('a visa detail page has no WCAG A/AA violations', async ({ page }) => {
    const paths = await countryPaths(page)
    test.skip(
      paths.length === 0,
      'the visa registry publishes no countries in this environment — see the file header',
    )

    // Find the first country that actually links to a visa detail page. A hub
    // whose visa types have no extracted requirements links to none, and that
    // is a legitimate state rather than a failure.
    for (const countryPath of paths) {
      await page.goto(countryPath)
      await settle(page)
      const detail = await page
        .locator(`a[href^="${countryPath}/"]`)
        .first()
        .getAttribute('href')
        .catch(() => null)
      if (!detail) continue

      await page.goto(detail)
      await settle(page)
      await expect(page.locator('h1')).toBeVisible()

      const results = await new AxeBuilder({ page }).withTags(WCAG).analyze()
      expect(results.violations, `${detail} has WCAG violations`).toEqual([])
      return
    }

    test.skip(true, 'no published country links to a visa detail page yet')
  })
})
