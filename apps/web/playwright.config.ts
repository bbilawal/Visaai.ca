import { defineConfig, devices } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE = `http://localhost:${PORT}`

// Which specs actually want the admin session. Derived from the specs
// themselves — a spec opts in by gating on E2E_ADMIN_STORAGE_STATE — so adding
// an admin spec needs no edit here and the two lists cannot drift apart.
const E2E_DIR = join(__dirname, 'e2e')
const specsGatedOn = (envVar: string) =>
  readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .filter((f) => readFileSync(join(E2E_DIR, f), 'utf8').includes(envVar))
    .map((f) => `**/${f}`)

const ADMIN_SPECS = specsGatedOn('E2E_ADMIN_STORAGE_STATE')
const CONSULTANT_SPECS = specsGatedOn('E2E_CONSULTANT_STORAGE_STATE')

// Admin auth fixture (Increment 7): when a seeded admin's credentials are
// provided, a `setup` project logs in once and saves the session; the admin
// e2e specs (gated on E2E_ADMIN_STORAGE_STATE) then run against it. Without
// credentials nothing changes — the setup project is not registered and the
// admin specs stay skipped, exactly as before.
const ADMIN_AUTH = Boolean(process.env.E2E_ADMIN_EMAIL && process.env.E2E_ADMIN_PASSWORD)
const CONSULTANT_AUTH = Boolean(
  process.env.E2E_CONSULTANT_EMAIL && process.env.E2E_CONSULTANT_PASSWORD,
)
if (CONSULTANT_AUTH && !process.env.E2E_CONSULTANT_STORAGE_STATE) {
  process.env.E2E_CONSULTANT_STORAGE_STATE = 'e2e/.auth/consultant.json'
}
if (ADMIN_AUTH && !process.env.E2E_ADMIN_STORAGE_STATE) {
  process.env.E2E_ADMIN_STORAGE_STATE = 'e2e/.auth/admin.json'
}
const ADMIN_STATE = process.env.E2E_ADMIN_STORAGE_STATE

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL: BASE, trace: 'on-first-retry' },
  // Screenshot-only CSS: hides the `next dev` indicator badge. See the file.
  expect: { toHaveScreenshot: { stylePath: './e2e/screenshot.css' } },
  projects: [
    ...(ADMIN_AUTH || CONSULTANT_AUTH
      ? [{ name: 'setup', testMatch: /auth\.setup\.ts/ }]
      : []),
    {
      // Logged-OUT project. The admin storageState must never be applied here:
      // it used to be set on this project whenever credentials were present,
      // which silently signed in the entire suite. 38 specs then failed for the
      // wrong reason — the marketing pages render a different header when
      // authenticated, and the "protected routes redirect to /login" and
      // "login page renders" specs assert precisely the logged-out state.
      name: 'chromium',
      testIgnore: [
        '**/auth.setup.ts',
        ...(ADMIN_AUTH ? ADMIN_SPECS : []),
        ...(CONSULTANT_AUTH ? CONSULTANT_SPECS : []),
      ],
      use: { ...devices['Desktop Chrome'] },
    },
    // Authenticated project, added only when credentials are supplied. Without
    // them the admin specs stay in the project above and skip themselves, so
    // the collected test count is the same either way.
    ...(ADMIN_AUTH
      ? [
          {
            name: 'chromium-admin',
            testMatch: ADMIN_SPECS,
            use: { ...devices['Desktop Chrome'], storageState: ADMIN_STATE },
            dependencies: ['setup'],
          },
        ]
      : []),
    // Consultant project — same split as the admin one, for the same reason:
    // a consultant session must never leak into the logged-out specs.
    ...(CONSULTANT_AUTH
      ? [
          {
            name: 'chromium-consultant',
            testMatch: CONSULTANT_SPECS,
            use: {
              ...devices['Desktop Chrome'],
              storageState: process.env.E2E_CONSULTANT_STORAGE_STATE,
            },
            dependencies: ['setup'],
          },
        ]
      : []),
  ],
  webServer: {
    command: `pnpm --filter web dev -p ${PORT}`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
