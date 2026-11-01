import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'

// The web package's Playwright wants chromium_headless_shell-1228, but only the
// 1234 build is installed locally. Use it when present (override with
// PW_CHROMIUM_PATH, or run `apps/web/node_modules/.bin/playwright install chromium`).
const LOCAL_SHELL = `${homedir()}/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const executablePath = process.env.PW_CHROMIUM_PATH ?? (existsSync(LOCAL_SHELL) ? LOCAL_SHELL : undefined)

// Live visaai.ca checks. No webServer: runs against production.
export default defineConfig({
  testDir: '.',
  testMatch: /browser\.spec\.ts/,
  timeout: 240_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'evidence/browser-results.json' }]],
  outputDir: 'evidence/test-output',
  use: {
    baseURL: process.env.BASE_URL ?? 'https://visaai.ca',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions: executablePath ? { executablePath } : {} } }],
})
