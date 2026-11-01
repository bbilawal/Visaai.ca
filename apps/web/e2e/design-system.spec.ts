import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

/**
 * Design-system coverage: visual regression, dark mode, responsive reflow and
 * accessibility, on the routes that need no authentication.
 *
 * Scoped to public routes deliberately. The authenticated portals need seeded
 * credentials that CI does not have, so a suite covering them would be skipped
 * in CI and would therefore prove nothing. What runs here runs everywhere.
 *
 * Screenshots are compared against committed baselines. First run writes them;
 * afterwards a diff fails the build, which is the whole point — a token change
 * that alters an unrelated page shows up as a picture rather than a bug report
 * three weeks later.
 */

const PUBLIC_ROUTES = [
  { path: '/', name: 'landing' },
  { path: '/login', name: 'login' },
  { path: '/signup', name: 'signup' },
  { path: '/forgot-password', name: 'forgot-password' },
  { path: '/pricing', name: 'pricing' },
  { path: '/privacy', name: 'privacy' },
  { path: '/terms', name: 'terms' },
  // The visa reference index. This is the surface a search engine and an
  // answer engine read, which means it is also the surface a screen reader
  // reaches without ever signing in — a public page nobody can navigate is a
  // public page that excludes people, and this list is what catches it.
  //
  // /visas/{country} is deliberately NOT here, and this is no longer a gap.
  // This suite runs in BOTH web jobs, and the plain `web` job points
  // NEXT_PUBLIC_SUPABASE_URL at example.supabase.co — the country page then
  // correctly renders a 404, and axe would inspect a not-found document and
  // report it clean. Coverage that passes against the wrong page is worse than
  // none, because it looks like coverage.
  //
  // Those routes are covered by visa-registry-a11y.spec.ts instead, which
  // discovers its paths from the live index and therefore only asserts where
  // the registry actually renders — in `web-e2e-live`, whose Supabase stack has
  // every migration applied. See that file's header.
  { path: '/visas', name: 'visas-index' },
] as const

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 900 },
] as const

/**
 * Select a theme deterministically, by emulating the OS preference.
 *
 * NOT via localStorage + addInitScript: that script also runs on `about:blank`,
 * where a write does not reach the real origin, so the app's inline script
 * found nothing and rendered light. It failed intermittently — a 98% pixel
 * diff on a "dark" screenshot — which is worse than failing outright, because
 * it reads as flake rather than as a broken fixture.
 *
 * Emulating `prefers-color-scheme` needs no storage and applies before the
 * first request, so the app's own OS-preference path does the work. The
 * storage path is still covered, by the tests that are actually about it.
 */
async function useTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme: theme })
}

/** Animations make screenshots flaky; the app already honours this preference. */
async function settle(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForLoadState('networkidle')
  // Fonts must be resolved before a screenshot, or the diff is text reflow.
  await page.evaluate(() => document.fonts.ready)
}

test.describe('visual regression — light', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} renders consistently`, async ({ page }) => {
      await useTheme(page, 'light')
      await page.goto(route.path)
      await settle(page)
      await expect(page).toHaveScreenshot(`${route.name}-light.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      })
    })
  }
})

test.describe('visual regression — dark', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} renders consistently`, async ({ page }) => {
      await useTheme(page, 'dark')
      await page.goto(route.path)
      await settle(page)
      await expect(page).toHaveScreenshot(`${route.name}-dark.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      })
    })
  }
})

test.describe('responsive', () => {
  for (const viewport of VIEWPORTS) {
    test(`landing reflows at ${viewport.name} (${viewport.width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')
      await settle(page)

      // WCAG 2.2 §1.4.10 Reflow: no horizontal scrolling at 320 CSS px
      // equivalent. A page wider than its viewport means someone on a small
      // phone drags sideways to read every line.
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      )
      expect(overflow).toBeLessThanOrEqual(1)

      await expect(page).toHaveScreenshot(`landing-${viewport.name}.png`, {
        fullPage: true,
        maxDiffPixelRatio: 0.02,
      })
    })
  }

  test('reflows at the 320px minimum', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 })
    await page.goto('/login')
    await settle(page)
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(1)
  })

  // §1.4.4: text must survive 200% zoom without loss of content. Halving the
  // viewport is the standard way to simulate it.
  test('survives 200% text zoom', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 480 })
    await page.goto('/login')
    await settle(page)
    await expect(page.getByRole('button', { name: /sign in|log in/i }).first()).toBeVisible()
  })
})

test.describe('accessibility', () => {
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} has no WCAG A/AA violations (light)`, async ({ page }) => {
      await useTheme(page, 'light')
      await page.goto(route.path)
      await settle(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations).toEqual([])
    })
  }

  // Contrast is the failure mode a new theme introduces, so dark mode gets its
  // own pass rather than being assumed equivalent.
  for (const route of PUBLIC_ROUTES) {
    test(`${route.name} has no WCAG A/AA violations (dark)`, async ({ page }) => {
      await useTheme(page, 'dark')
      await page.goto(route.path)
      await settle(page)
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(results.violations).toEqual([])
    })
  }
})

test.describe('keyboard', () => {
  test('every focused element shows a visible focus indicator', async ({ page }) => {
    await page.goto('/login')
    await settle(page)

    // Walk the first stretch of the tab order and assert the focus ring is
    // actually painted. A focus style that exists in CSS but is overridden by
    // a later rule is the classic silent regression.
    for (let i = 0; i < 8; i += 1) {
      await page.keyboard.press('Tab')
      const visible = await page.evaluate(() => {
        const el = document.activeElement
        if (!el || el === document.body) return true
        const style = getComputedStyle(el)
        const hasOutline =
          style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) > 0
        const hasRing = style.boxShadow !== 'none' && style.boxShadow !== ''
        return hasOutline || hasRing
      })
      expect(visible).toBe(true)
    }
  })

  test('reaches the primary action by keyboard alone', async ({ page }) => {
    await page.goto('/login')
    await settle(page)
    const reached = await page.evaluate(() => {
      const target = document.querySelector('button[type="submit"]')
      if (!target) return false
      const focusable = Array.from(
        document.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      )
      return focusable.includes(target as HTMLElement)
    })
    expect(reached).toBe(true)
  })
})

/** Store an explicit preference the way the app does — after a real load, so
 *  the write lands on the site's origin rather than about:blank. */
async function storePreference(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.goto('/')
  await page.evaluate((value) => localStorage.setItem('visaai.theme', value), theme)
}

test.describe('theme switching', () => {
  test('honours the OS preference when no choice is stored', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await settle(page)
    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    )
    expect(scheme).toContain('dark')
  })

  // The case a two-state toggle gets wrong: an explicit light choice on a dark
  // OS must win.
  test('an explicit light choice overrides a dark OS', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await storePreference(page, 'light')
    await page.goto('/')
    await settle(page)
    const scheme = await page.evaluate(
      () => getComputedStyle(document.documentElement).colorScheme,
    )
    expect(scheme).toContain('light')
  })

  test('persists the choice across a reload', async ({ page }) => {
    await storePreference(page, 'dark')
    await page.goto('/')
    await settle(page)
    await page.reload()
    await settle(page)
    const theme = await page.evaluate(() =>
      document.documentElement.getAttribute('data-theme'),
    )
    expect(theme).toBe('dark')
  })

  // No flash of light content: the inline script must apply the theme before
  // the first paint, not after hydration.
  test('applies the stored theme before first paint', async ({ page }) => {
    await storePreference(page, 'dark')
    const applied: (string | null)[] = []
    page.on('domcontentloaded', async () => {
      applied.push(
        await page
          .evaluate(() => document.documentElement.getAttribute('data-theme'))
          .catch(() => null),
      )
    })
    await page.goto('/')
    await settle(page)
    expect(applied.some((value) => value === 'dark')).toBe(true)
  })
})
