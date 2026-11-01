/**
 * BUG-002 verification — drives the public funnel as a guest and counts the
 * requests JwtGuard is guaranteed to reject for an anonymous identity.
 *
 * Before the fix: 3 offenders per load (GET /progress/:id, /notifications/
 * unread-count, /messaging/stream) with the SSE one retry-looping on backoff.
 * After the fix: zero.
 *
 * Usage: node qa/visaai-autonomous-e2e/harness/verify-bug-002.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const REPO = resolve(ROOT, '..', '..')

// Same resolution the other harness scripts use: playwright is a dependency of
// apps/web, not of the repo root.
const requireFromWeb = createRequire(join(REPO, 'apps', 'web', 'package.json'))
const playwright = await import(
  pathToFileURL(requireFromWeb.resolve('@playwright/test')).href
)
const { chromium } = playwright.default ?? playwright
const BASE = process.env.VISAAI_TEST_BASE_URL ?? 'http://localhost:3100'
// How long to sit on the intake page — long enough for the SSE reconnect
// backoff (1s, 2s, 3s, ...) to produce several retries if the bug is present.
const DWELL_MS = Number(process.env.DWELL_MS ?? 20_000)

const OFFENDERS = [
  { name: 'progress', re: /\/progress\/[0-9a-f-]+/i },
  { name: 'notifications-unread-count', re: /\/notifications\/unread-count/i },
  { name: 'messaging-stream', re: /\/messaging\/stream/i },
]

const requests = []
const responses = []
const consoleErrors = []

const browser = await chromium.launch()
const ctx = await browser.newContext()
const page = await ctx.newPage()

page.on('request', (r) => requests.push({ url: r.url(), method: r.method() }))
page.on('response', (r) => responses.push({ url: r.url(), status: r.status() }))
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})

await page.goto(`${BASE}/en/applications/new`, {
  waitUntil: 'domcontentloaded',
  timeout: 45_000,
})

// Destination picker → Canada → start. Guest identity is minted by the funnel.
// Same selectors as run-scenarios.mjs: the picker stays disabled while
// GET /countries is in flight, and a bare getByRole('option') would also match
// the sidebar language <select>.
const combo = page.locator('#country')
await combo.waitFor({ state: 'visible', timeout: 60_000 })
await page.waitForFunction(
  () => {
    const el = document.querySelector('#country')
    return el instanceof HTMLInputElement && !el.disabled
  },
  undefined,
  { timeout: 60_000 },
)
await combo.click({ timeout: 20_000 })
await combo.fill('Canada')
const option = page.locator('#country-listbox [role="option"]').first()
await option.waitFor({ state: 'visible', timeout: 15_000 })
await option.click()
await page.getByRole('button', { name: /start application/i }).click()

try {
  await page.waitForURL(/\/intake\//, { timeout: 60_000, waitUntil: 'commit' })
} catch (err) {
  await page.screenshot({
    path: resolve(ROOT, 'screenshots/BUG-002-verify-stuck.png'),
    fullPage: true,
  })
  console.error('did not reach /intake — url:', page.url())
  console.error('page text:', (await page.locator('body').innerText()).slice(0, 600))
  console.error('console errors:', consoleErrors.slice(0, 10))
  console.error(
    'non-2xx:',
    responses.filter((r) => r.status >= 400).slice(0, 15),
  )
  throw err
}
const intakeUrl = page.url()

await page.waitForTimeout(DWELL_MS)

const report = {
  ts: new Date().toISOString(),
  base: BASE,
  intake_url: intakeUrl,
  dwell_ms: DWELL_MS,
  offenders: OFFENDERS.map(({ name, re }) => {
    const hits = requests.filter((r) => re.test(r.url))
    const forbidden = responses.filter((r) => re.test(r.url) && r.status === 403)
    return { name, requests: hits.length, http_403: forbidden.length }
  }),
  total_403: responses.filter((r) => r.status === 403).length,
  console_errors: consoleErrors.length,
  console_error_samples: consoleErrors.slice(0, 5),
}
report.status =
  report.offenders.every((o) => o.requests === 0) && report.total_403 === 0
    ? 'PASS'
    : 'FAIL'

await page.screenshot({
  path: resolve(ROOT, 'screenshots/BUG-002-verify.png'),
  fullPage: true,
})
mkdirSync(resolve(ROOT, 'evidence'), { recursive: true })
writeFileSync(
  resolve(ROOT, 'evidence/BUG-002-verify.json'),
  JSON.stringify(report, null, 2),
)

console.log(JSON.stringify(report, null, 2))
await browser.close()
process.exit(report.status === 'PASS' ? 0 : 1)
