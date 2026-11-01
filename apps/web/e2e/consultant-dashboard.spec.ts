import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Requires a seeded consultant session. If the repo has an auth-state fixture
// (e2e auth helper / storageState), use it; otherwise skip with a clear reason
// until the e2e auth harness lands (tracked in Task 8 tech debt).
test.describe('consultant dashboard', () => {
  test.skip(
    !process.env.E2E_CONSULTANT_STORAGE_STATE,
    'needs seeded consultant storageState (see Task 8)',
  )

  test('renders the six stat cards with no serious a11y violations', async ({ page }) => {
    await page.goto('/en/consultant/dashboard')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
    const serious = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''))
    expect(serious, JSON.stringify(serious, null, 2)).toEqual([])
  })
})
