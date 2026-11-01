/**
 * Live browser E2E for the Canada-only site (https://visaai.ca).
 *
 * Run (from repo root):
 *   apps/web/node_modules/.bin/playwright test -c qa/canada-e2e/playwright.config.ts
 *
 * Every test gets a fresh browser context, so every visa type starts as a brand
 * new anonymous guest. Console errors, page errors, failed requests and API /
 * Supabase responses >= 400 are captured per test into evidence/*.json and
 * attached to the report; screenshots go to evidence/.
 */
import { test, expect, type Page, type TestInfo } from '@playwright/test'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
import { join } from 'node:path'

const EVIDENCE = join(__dirname, 'evidence')
mkdirSync(EVIDENCE, { recursive: true })
const CREATED_IDS_FILE = join(EVIDENCE, 'browser-created-application-ids.txt')

const VISA_TYPES = [
  { id: 'ca-visitor-visa-temporary-resident-visa', name: 'Visitor visa (temporary resident visa)', msg: 'I am an Indian citizen visiting my cousin in Toronto for three weeks.' },
  { id: 'ca-super-visa', name: 'Super visa for parents and grandparents', msg: 'I am a Pakistani citizen and my daughter is a Canadian citizen in Calgary.' },
  { id: 'ca-business-visitors', name: 'Business visitors', msg: 'I am a Nigerian citizen attending a business conference in Vancouver.' },
  { id: 'ca-study-permit', name: 'Study permit', msg: 'I am from India with an acceptance letter from the University of Toronto.' },
  { id: 'ca-work-permit', name: 'Work permit', msg: 'I am Filipino with a job offer from an Ontario employer and an approved LMIA.' },
  { id: 'ca-electronic-travel-authorization-eta', name: 'Electronic travel authorization (eTA)', msg: 'I am a British citizen flying to Montreal for a one-week holiday.' },
  { id: 'ca-express-entry', name: 'Express Entry', msg: 'I am a software engineer from India with four years of experience and IELTS 8.' },
  { id: 'ca-sponsor-your-spouse-partner-or-child', name: 'Sponsor your spouse, partner or child', msg: 'I am a Canadian citizen sponsoring my wife who lives in Pakistan.' },
]

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const INTAKE_URL = new RegExp(`/intake/(${UUID})(?:[/?#]|$)`)

interface Capture {
  consoleErrors: string[]
  pageErrors: string[]
  failedRequests: string[]
  badResponses: string[]
  analyticsThrottled: string[]
  navigations: string[]
  countryPickerSeen: string[]
}

/** Benign noise that is not an app defect (third-party beacons aborted by navigation). */
const IGNORE_FAILED = /google-analytics|googletagmanager|doubleclick|clarity\.ms|posthog|sentry|_vercel|favicon/i

function capture(page: Page): Capture {
  const c: Capture = { consoleErrors: [], pageErrors: [], failedRequests: [], badResponses: [], analyticsThrottled: [], navigations: [], countryPickerSeen: [] }
  page.on('console', (m) => { if (m.type() === 'error' && !/status of 429/.test(m.text())) c.consoleErrors.push(`${m.text()} @ ${m.location()?.url ?? ''}`.slice(0, 500)) })
  page.on('pageerror', (e) => c.pageErrors.push(String(e?.stack ?? e).slice(0, 500)))
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? ''
    // A navigation away aborts in-flight requests; that is not a failure.
    if (f.includes('ERR_ABORTED') || IGNORE_FAILED.test(r.url())) return
    c.failedRequests.push(`${r.method()} ${r.url()} -> ${f}`)
  })
  page.on('response', (r) => {
    const u = r.url()
    if (r.status() === 429 && u.includes('/analytics/collect')) { c.analyticsThrottled.push(`${r.status()} ${u}`); return }
    if (r.status() >= 400 && (u.includes('api.visaai.ca') || u.includes('supabase.co') || u.startsWith('https://visaai.ca'))) {
      c.badResponses.push(`${r.status()} ${r.request().method()} ${u}`)
    }
  })
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) c.navigations.push(f.url()) })
  return c
}

function dump(name: string, c: Capture, info: TestInfo, extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({ ...extra, ...c }, null, 2)
  writeFileSync(join(EVIDENCE, `${name}.json`), body)
  void info.attach(`${name}.json`, { body, contentType: 'application/json' })
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(EVIDENCE, `${name}.png`), fullPage: true }).catch(() => {})
}

/** Watches the DOM for any destination-country picker while the funnel runs. */
async function armCountryPickerWatch(page: Page) {
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __countryPicker: string[] }).__countryPicker = seen
    const check = () => {
      const txt = document.body?.innerText ?? ''
      if (/where are you applying|choose (your )?destination|select (a )?country|destination country/i.test(txt)) seen.push(`${location.pathname}: text`)
      if (document.querySelector('[data-country-combobox], [aria-label*="country" i][role="combobox"], input[placeholder*="country" i]')) seen.push(`${location.pathname}: combobox`)
    }
    new MutationObserver(check).observe(document, { subtree: true, childList: true, characterData: true })
    document.addEventListener('DOMContentLoaded', check)
  })
}

for (const vt of VISA_TYPES) {
  test(`intake: ${vt.id}`, async ({ page }, info) => {
    const c = capture(page)
    await armCountryPickerWatch(page)
    const extra: Record<string, unknown> = { visaType: vt.id }
    try {
      // 1. `/` -> /applications/new -> guest session + CA application -> /intake/<uuid>
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await page.waitForURL(INTAKE_URL, { timeout: 60_000 })
      const appId = page.url().match(INTAKE_URL)![1]
      extra.applicationId = appId
      appendFileSync(CREATED_IDS_FILE, `${appId} ${vt.id}\n`)
      extra.landedOn = page.url()

      // 2. Visa-type selector loads the 8 CA routes.
      const select = page.getByLabel('Which visa are you applying for?')
      await expect(select).toBeVisible({ timeout: 45_000 })
      const options = await select.locator('option').allTextContents()
      extra.options = options
      expect(options.length, 'placeholder + 8 Canadian routes').toBe(9)
      const label = options.find((o) => o.startsWith(vt.name))
      expect(label, `option for ${vt.name}`).toBeTruthy()

      // 3. Choose it; the PATCH must succeed and the choice must stick.
      const patch = page.waitForResponse((r) => r.url().endsWith(`/intake/applications/${appId}/visa-type`) && r.request().method() === 'PATCH')
      await select.selectOption({ label: label! })
      const pr = await patch
      extra.patchStatus = pr.status()
      extra.patchBody = await pr.json().catch(() => null)
      expect(pr.status()).toBe(200)
      await expect(select.locator('option:checked')).toHaveText(label!)
      // Next.js' route announcer is role=alert too, so only look inside <main>.
      await page.waitForTimeout(1500)
      const alerts = await page.locator('main [role="alert"]').allInnerTexts()
      extra.alertsAfterSelect = alerts
      expect(alerts.filter((a) => /could not|couldn.t|failed|try again|error/i.test(a)), 'save error shown').toEqual([])

      // 4. Intake chat: the opening question arrives, a message gets a reply.
      const input = page.getByPlaceholder('Type your answer…')
      await expect(input).toBeEnabled({ timeout: 60_000 })
      await shot(page, `intake-${vt.id}-1-selected`)
      const bubbles = page.locator('div.whitespace-pre-wrap')
      const before = await bubbles.count()
      extra.openingBubbles = before
      await input.fill(vt.msg)
      await page.getByRole('button', { name: 'Send' }).click()
      // user bubble + assistant reply
      await expect.poll(async () => bubbles.count(), { timeout: 150_000, intervals: [1000] }).toBeGreaterThanOrEqual(before + 2)
      await expect(input).toBeEnabled({ timeout: 150_000 })
      const texts = await bubbles.allTextContents()
      extra.lastReply = texts[texts.length - 1]?.slice(0, 600)
      expect((texts[texts.length - 1] ?? '').length).toBeGreaterThan(15)
      await expect(page.getByText(/AI service is unavailable|could not reach your application|not sent/i)).toHaveCount(0)
      await shot(page, `intake-${vt.id}-2-replied`)

      // 5. No country picker ever rendered; no console/page errors; no failed API calls.
      c.countryPickerSeen = await page.evaluate(() => (window as unknown as { __countryPicker?: string[] }).__countryPicker ?? [])
      expect(c.countryPickerSeen, 'country picker shown').toEqual([])
      expect(c.navigations.some((u) => /\/applications\/new/.test(u)), 'went through /applications/new').toBeTruthy()
      expect.soft(c.pageErrors, 'page errors').toEqual([])
      expect.soft(c.consoleErrors, 'console errors').toEqual([])
      expect.soft(c.failedRequests, 'failed requests').toEqual([])
      expect.soft(c.badResponses, 'API/Supabase responses >= 400').toEqual([])
    } finally {
      await shot(page, `intake-${vt.id}-final`)
      dump(`intake-${vt.id}`, c, info, extra)
    }
  })
}

const FOREIGN = /\b(United States|U\.S\.|USA|Australia|United Kingdom|\bUK\b|Schengen|Germany|France|Japan|New Zealand|Ireland|Türkiye|Turkey|UAE|Singapore)\b/g

const PUBLIC_PAGES: { path: string; strictForeign: boolean }[] = [
  { path: '/applications/new', strictForeign: true },
  { path: '/pricing', strictForeign: true },
  { path: '/visas', strictForeign: true },
  { path: '/visas/canada', strictForeign: false },
  { path: '/privacy', strictForeign: false },
  { path: '/terms', strictForeign: false },
]

for (const p of PUBLIC_PAGES) {
  test(`public page ${p.path}`, async ({ page }, info) => {
    const c = capture(page)
    const extra: Record<string, unknown> = { path: p.path }
    try {
      // Fetch the server HTML first: proves 200 without the guest funnel's client redirect.
      const res = await page.request.get(p.path, { maxRedirects: 0 })
      extra.status = res.status()
      expect(res.status()).toBe(200)
      const html = await res.text()
      const titleMatch = html.match(/<title>([^<]*)<\/title>/)
      extra.title = titleMatch?.[1]
      const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)
      extra.canonical = canonical?.[1]
      if (canonical) expect(canonical[1].startsWith('https://visaai.ca')).toBeTruthy()

      if (p.path !== '/applications/new') {
        await page.goto(p.path, { waitUntil: 'networkidle' })
        await shot(page, `public-${p.path.replace(/\W+/g, '_')}`)
        const text = await page.locator('main, body').first().innerText()
        extra.mentionsCanada = /Canad/i.test(text)
        const foreign = [...new Set(text.match(FOREIGN) ?? [])]
        extra.foreignMentions = foreign
        extra.foreignContext = foreign.map((f) => { const i = text.indexOf(f); return text.slice(Math.max(0, i - 80), i + 80).replace(/\s+/g, ' ') })
        expect.soft(/Canad/i.test(text), 'page body mentions Canada').toBeTruthy()
        if (p.strictForeign) expect.soft(foreign, 'other countries mentioned').toEqual([])
        expect.soft(c.pageErrors, 'page errors').toEqual([])
        expect.soft(c.consoleErrors, 'console errors').toEqual([])
        expect.soft(c.badResponses, 'responses >= 400').toEqual([])
      } else {
        expect(html).toMatch(/Canada/)
        // The translation catalogue is serialised into the RSC payload, so check
        // what is RENDERED, not the raw HTML.
        await page.goto(p.path, { waitUntil: 'domcontentloaded' })
        const visible = await page.locator('body').innerText()
        extra.visibleHead = visible.slice(0, 300)
        expect(visible).not.toMatch(/Where are you applying/i)
        await page.waitForURL(INTAKE_URL, { timeout: 60_000 })
        appendFileSync(CREATED_IDS_FILE, `${page.url().match(INTAKE_URL)![1]} public-applications-new\n`)
      }
    } finally {
      dump(`public-${p.path.replace(/\W+/g, '_')}`, c, info, extra)
    }
  })
}

test('robots.txt and sitemap.xml are Canada-only', async ({ request }, info) => {
  const robots = await request.get('/robots.txt')
  expect(robots.status()).toBe(200)
  const rtxt = await robots.text()
  expect(rtxt).toMatch(/Sitemap: https:\/\/visaai\.ca\/sitemap\.xml/)
  expect(rtxt).toMatch(/Disallow: \/admin/)
  expect(rtxt).not.toMatch(/visaai\.co\b/)

  const sm = await request.get('/sitemap.xml')
  expect(sm.status()).toBe(200)
  const xml = await sm.text()
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  const visaLocs = locs.filter((u) => /\/visas\/[^/]+/.test(u))
  const nonCa = visaLocs.filter((u) => !/\/visas\/canada(\/|$)/.test(u))
  const offHost = locs.filter((u) => !u.startsWith('https://visaai.ca'))
  const caVisaSlugs = [...new Set(visaLocs.map((u) => u.match(/\/visas\/canada\/([^/]+)/)?.[1]).filter(Boolean))]
  const body = JSON.stringify({ robots: rtxt, locCount: locs.length, nonCa, offHost, caVisaSlugs }, null, 2)
  writeFileSync(join(EVIDENCE, 'robots-sitemap.json'), body)
  await info.attach('robots-sitemap.json', { body, contentType: 'application/json' })
  expect(nonCa).toEqual([])
  expect(offHost).toEqual([])
  expect(caVisaSlugs.length).toBe(8)
})

// Each sitemap visa page should render (200) and be about Canada.
test('every Canadian visa page renders', async ({ request }) => {
  const xml = await (await request.get('/sitemap.xml')).text()
  const paths = [...new Set([...xml.matchAll(/<loc>https:\/\/visaai\.ca(\/visas\/canada\/[^<]+)<\/loc>/g)].map((m) => m[1]))]
  const out: Record<string, number> = {}
  for (const p of paths) {
    const r = await request.get(p)
    out[p] = r.status()
    expect.soft(r.status(), p).toBe(200)
    expect.soft(await r.text(), p).toMatch(/Canad/)
  }
  writeFileSync(join(EVIDENCE, 'visa-pages.json'), JSON.stringify(out, null, 2))
})

const GATED = ['/admin', '/admin/billing', '/users', '/audit', '/applications', '/assignments', '/consultant/dashboard', '/consultant/applications', '/consultant/payouts', '/my-applications', '/billing']

test('gated routes: logged-out visitor is sent to /login', async ({ page }) => {
  const out: Record<string, string> = {}
  for (const p of GATED) {
    const res = await page.request.get(p, { maxRedirects: 0 })
    out[p] = `${res.status()} ${res.headers()['location'] ?? ''}`
    expect.soft([307, 308, 302, 303], p).toContain(res.status())
    expect.soft(res.headers()['location'] ?? '', p).toMatch(/\/login$/)
  }
  writeFileSync(join(EVIDENCE, 'gating-logged-out.json'), JSON.stringify(out, null, 2))
})

test('gated routes: anonymous guest cannot reach admin/consultant', async ({ page }, info) => {
  const c = capture(page)
  // Become a guest the way a visitor does.
  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForURL(INTAKE_URL, { timeout: 60_000 })
  appendFileSync(CREATED_IDS_FILE, `${page.url().match(INTAKE_URL)![1]} gating-guest\n`)
  const out: Record<string, string> = {}
  for (const p of GATED) {
    await page.goto(p, { waitUntil: 'domcontentloaded' })
    const url = new URL(page.url()).pathname
    const body = (await page.locator('body').innerText()).slice(0, 200).replace(/\s+/g, ' ')
    out[p] = `${url} | ${body}`
    // Allowed outcomes: login, forbidden, sign-up gate. Never the protected page itself.
    // A guest on a dashboard route is sent back into the guest funnel
    // (/applications/new -> their /intake/<id>) — that is a gate too.
    const gated = /\/(login|forbidden|signup|applications\/new|intake\/)/.test(url) || /sign in|create (an|your) account|forbidden|not authori[sz]ed|requires a VisaAI account/i.test(body)
    expect.soft(gated, `${p} -> ${url}: ${body}`).toBeTruthy()
    if (!gated) await shot(page, `gating-guest-${p.replace(/\W+/g, '_')}`)
  }
  await shot(page, 'gating-guest-last')
  dump('gating-guest', c, info, { results: out })
})
