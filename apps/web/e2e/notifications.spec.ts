import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('notification center', () => {
  test.skip(
    !process.env.E2E_ADMIN_STORAGE_STATE,
    'needs seeded authed storageState (tech debt)',
  )

  test('notification bell is reachable with no serious a11y violations', async ({ page }) => {
    await page.goto('/en/applications')
    // The bell lives in the shared authed sidebar.
    await expect(page.getByRole('button', { name: /notification/i })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) =>
      ['serious', 'critical'].includes(v.impact ?? ''),
    )
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
})
