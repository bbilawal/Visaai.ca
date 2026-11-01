/**
 * Browser check for the stage rename/reorder and the removal of the documents
 * page's "Generate official documents" button — driven through the real UI, as
 * the applicant sees it.
 *
 *   source qa/prefill-matrix/api-env.sh
 *   node qa/prefill-matrix/seed-ui-fixture.mjs
 *   node qa/prefill-matrix/run-ui-check.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const requireFromWeb = createRequire(join(REPO, 'apps', 'web', 'package.json'));
const playwright = await import(pathToFileURL(requireFromWeb.resolve('@playwright/test')).href);
const { chromium } = playwright.default ?? playwright;

const BASE = process.env.WEB_URL ?? 'http://localhost:3100';
const fixture = JSON.parse(readFileSync(join(HERE, 'results', 'ui-fixture.json'), 'utf8'));
const SHOTS = join(HERE, 'results', 'screenshots');
mkdirSync(SHOTS, { recursive: true });

const checks = [];
const record = (name, ok, detail = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
// EventSource streams are aborted by design on navigation, so they are not
// evidence of a broken page.
const IGNORED_REQUESTS = /\/messaging\/stream|\/notifications\/stream|\/events\/stream/;
const failedRequests = [];
page.on('requestfailed', (r) => {
  if (IGNORED_REQUESTS.test(r.url())) return;
  failedRequests.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`);
});
// /analytics/collect carries its OWN 30/min throttle (analytics.controller.ts),
// which a scripted run trips from a single IP no matter what THROTTLE_LIMIT
// says. Recorded separately: it is load shedding working, not a page defect.
const THROTTLED_BY_DESIGN = /\/analytics\/collect/;
const badResponses = [];
const throttled = [];
page.on('response', (r) => {
  if (r.status() < 400 || IGNORED_REQUESTS.test(r.url())) return;
  const line = `${r.status()} ${r.request().method()} ${r.url()}`;
  if (r.status() === 429 && THROTTLED_BY_DESIGN.test(r.url())) throttled.push(line);
  else badResponses.push(line);
});

// ── login ─────────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="email"]', fixture.email);
await page.fill('input[type="password"]', fixture.password);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 30_000 });
record('login', true, page.url());

// ── Forms stage (was "Prefill") ───────────────────────────────────────────────
await page.goto(`${BASE}/en/prefill/${fixture.applicationId}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);

const h1 = (await page.locator('h1').first().textContent())?.trim() ?? '';
record('page title renamed', h1 === 'Your application forms', `h1="${h1}"`);

const steps = await page.locator('.stage-nav__step').allTextContents();
const cleaned = steps.map((s) => s.replace(/^[✓🔒\d]+\s*/, '').trim());
record(
  'stage nav order: Forms 4th, Readiness 5th',
  cleaned[3] === 'Forms' && cleaned[4] === 'Readiness',
  cleaned.join(' > '),
);
record('stage nav no longer says "Prefill"', !cleaned.includes('Prefill'), cleaned.join(' > '));

const inputs = await page.locator('input:not([type="email"]):not([type="password"])').count();
record('prefilled fields render', inputs >= 10, `${inputs} inputs`);

const bodyText = await page.locator('body').innerText();
record('save-edits control present', /save edits/i.test(bodyText));
record('paywall present, preview free', /unlock/i.test(bodyText) && /\$29/.test(bodyText));
record('official government forms section', /official government forms/i.test(bodyText) && /IMM 5257/.test(bodyText));
await page.screenshot({ path: join(SHOTS, 'forms-stage.png'), fullPage: true });

// ── Documents stage ───────────────────────────────────────────────────────────
await page.goto(`${BASE}/en/documents/${fixture.applicationId}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
const docsText = await page.locator('body').innerText();

record(
  'no "Generate official documents" button',
  !/generate official documents/i.test(docsText),
  /generate official documents/i.test(docsText) ? 'STILL PRESENT' : '',
);
record(
  'handoff to the Forms stage still offered',
  (await page.locator(`a[href$="/prefill/${fixture.applicationId}"]`).count()) > 0,
);
record('official reference sections revealed', /official forms/i.test(docsText));
await page.screenshot({ path: join(SHOTS, 'documents-stage.png'), fullPage: true });

// ── Readiness still reachable at position 5 ───────────────────────────────────
await page.goto(`${BASE}/en/readiness/${fixture.applicationId}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
record('readiness stage still loads', /readiness|visa readiness index/i.test(await page.locator('body').innerText()));

// The 429s above surface in the console as a bare "Failed to load resource",
// with no URL to correlate — so they are filtered by count, using the response
// listener (which does have the URL) as the authority.
const ignorableConsole = /favicon|Download the React DevTools|hydrat|429 \(Too Many Requests\)/i;
const realErrors = consoleErrors.filter((e) => !ignorableConsole.test(e));
record('no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
record('no failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));
record('no 4xx/5xx responses', badResponses.length === 0, badResponses.slice(0, 5).join(' | '));
if (throttled.length) {
  console.log(`   note: ${throttled.length} analytics/collect 429s (per-route 30/min limit, expected under scripted load)`);
}

await browser.close();

const failed = checks.filter((c) => !c.ok);
writeFileSync(
  join(HERE, 'results', 'ui-check.json'),
  JSON.stringify({ ran_at: new Date().toISOString(), base: BASE, fixture: fixture.applicationId, checks, consoleErrors, failedRequests, badResponses, throttled }, null, 2) + '\n',
);
console.log(`\n${checks.length - failed.length}/${checks.length} UI checks passed`);
process.exit(failed.length ? 1 : 0);
