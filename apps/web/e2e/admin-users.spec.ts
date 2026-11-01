import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('admin users management', () => {
  test.skip(
    !process.env.E2E_ADMIN_STORAGE_STATE,
    'needs seeded admin storageState (tech debt)',
  )

  test('users list renders with no serious a11y violations', async ({ page }) => {
    await page.goto('/en/users')
    // Level 1: the page's own title. Was level 2, which asserted a section
    // heading and passed on pages that had no document title at all (WEB-011).
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
})
