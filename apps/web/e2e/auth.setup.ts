import { test as setup, expect } from '@playwright/test'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Playwright setup project (Increment 7): generate the authenticated admin
 * storageState the admin e2e specs gate on (`E2E_ADMIN_STORAGE_STATE`). Logs in
 * a seeded admin via the real login form and saves the session (Supabase keeps
 * its session in localStorage, which storageState captures per-origin).
 *
 * Requires `E2E_ADMIN_EMAIL` + `E2E_ADMIN_PASSWORD` for a seeded admin user.
 * When those are unset the setup project is not registered (see
 * playwright.config.ts) and the admin specs stay skipped, exactly as before.
 *
 * Verified against a live local stack: this setup and all six admin specs run
 * green (Phase 6). The "not yet run" caveat this comment used to carry is gone.
 *
 * A second project generates the CONSULTANT storageState the same way, gated on
 * E2E_CONSULTANT_EMAIL/PASSWORD. consultant-dashboard.spec.ts had been skipped
 * since it was written because that fixture never existed — the only test in the
 * repo with no path to execution.
 */
const STORAGE = process.env.E2E_ADMIN_STORAGE_STATE ?? 'e2e/.auth/admin.json'
const EMAIL = process.env.E2E_ADMIN_EMAIL
const PASSWORD = process.env.E2E_ADMIN_PASSWORD

setup('authenticate as admin', async ({ page }) => {
  // Skip rather than throw: the setup PROJECT is registered when EITHER the
  // admin or the consultant credentials are present, so one of these two will
  // legitimately have nothing to do. The early `return` is for TypeScript —
  // setup.skip() aborts at runtime, but the compiler cannot narrow through it.
  if (!EMAIL || !PASSWORD) {
    setup.skip(true, 'E2E_ADMIN_EMAIL/PASSWORD not set')
    return
  }

  await page.goto('/en/login')
  await page.locator('#login-email').fill(EMAIL)
  await page.locator('#login-password').fill(PASSWORD)
  await page.locator('button[type="submit"]').click()

  // Successful login redirects to the app root ('/'); wait until we leave /login.
  await page.waitForURL((url) => !url.pathname.endsWith('/login'), { timeout: 30_000 })
  // Fail fast if the session did not establish (still on an auth page).
  await expect(page).not.toHaveURL(/\/login(\?|$)/)

  mkdirSync(dirname(STORAGE), { recursive: true })
  await page.context().storageState({ path: STORAGE })
})

const CONSULTANT_STORAGE =
  process.env.E2E_CONSULTANT_STORAGE_STATE ?? 'e2e/.auth/consultant.json'
const CONSULTANT_EMAIL = process.env.E2E_CONSULTANT_EMAIL
const CONSULTANT_PASSWORD = process.env.E2E_CONSULTANT_PASSWORD

setup('authenticate as consultant', async ({ page }) => {
  if (!CONSULTANT_EMAIL || !CONSULTANT_PASSWORD) {
    setup.skip(true, 'E2E_CONSULTANT_EMAIL/PASSWORD not set')
    return
  }

  await page.goto('/en/login')
  await page.locator('#login-email').fill(CONSULTANT_EMAIL)
  await page.locator('#login-password').fill(CONSULTANT_PASSWORD)
  await page.locator('button[type="submit"]').click()

  await page.waitForURL((url) => !url.pathname.endsWith('/login'), {
    timeout: 30_000,
  })
  await expect(page).not.toHaveURL(/\/login(\?|$)/)

  mkdirSync(dirname(CONSULTANT_STORAGE), { recursive: true })
  await page.context().storageState({ path: CONSULTANT_STORAGE })
})
