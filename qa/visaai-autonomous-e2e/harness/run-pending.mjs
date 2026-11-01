/**
 * The three remaining untested areas: document UPLOADS, an axe ACCESSIBILITY
 * audit, and PAYMENT presentation.
 *
 * Payment boundary, deliberately enforced: this harness inspects plan
 * visibility, paywall timing and entitlement gating. It NEVER types card
 * details and NEVER completes a purchase — no real charge and no card data,
 * even in test mode. Anything past the checkout boundary is left to a human.
 *
 *   node qa/visaai-autonomous-e2e/harness/run-pending.mjs --area uploads
 *   node qa/visaai-autonomous-e2e/harness/run-pending.mjs --area a11y
 *   node qa/visaai-autonomous-e2e/harness/run-pending.mjs --area payments
 */
import { readFileSync, appendFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REPO = join(ROOT, '..', '..');
const requireFromWeb = createRequire(join(REPO, 'apps', 'web', 'package.json'));
const pw = await import(pathToFileURL(requireFromWeb.resolve('@playwright/test')).href);
const { chromium } = pw.default ?? pw;
const axeMod = await import(pathToFileURL(requireFromWeb.resolve('@axe-core/playwright')).href);
const AxeBuilder = axeMod.default?.default ?? axeMod.default ?? axeMod.AxeBuilder;

const BASE = process.env.VISAAI_TEST_BASE_URL ?? 'http://localhost:3100';
const EMAIL = process.env.E2E_FIXTURE_EMAIL ?? 'qa.stage.fixture@example.invalid';
const PASSWORD = process.env.E2E_FIXTURE_PASSWORD ?? 'QaFixture!2026Stage';

const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const AREA = flag('area', 'all');

const LEDGER = join(ROOT, 'state', 'pending-ledger.jsonl');
const BUGS = join(ROOT, 'state', 'bug-ledger.jsonl');
const SHOTS = join(ROOT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const UPLOADS = join(ROOT, 'fixtures', 'upload');

const inventory = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'inventory.json'), 'utf8'));
const COUNTRY_NAME = new Map(inventory.countries.map((c) => [c.code, c.name]));
const record = (r) => appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...r }) + '\n');
const fileBug = (b) => appendFileSync(BUGS, JSON.stringify({
  found_at: new Date().toISOString(), source: 'pending-harness', status: 'OPEN', ...b,
}) + '\n');

const browser = await chromium.launch({ headless: true });

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
  const email = page.locator('#login-email');
  const pass = page.locator('#login-password');
  await email.waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4; i++) {
    await email.fill(EMAIL);
    await pass.fill(PASSWORD);
    await page.waitForTimeout(400);
    if ((await email.inputValue()) !== EMAIL) { await page.waitForTimeout(1000); continue; }
    await page.locator('button[type="submit"]').click();
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 }).catch(() => {});
    if (!page.url().includes('/login')) break;
  }
  const ok = !page.url().includes('/login');
  await page.close();
  return ok;
}

/** Create an application and return its id (authenticated context). */
async function newApplication(context, code) {
  const page = await context.newPage();
  await page.goto(`${BASE}/en/applications/new`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const combo = page.locator('#country');
  await combo.waitFor({ state: 'visible', timeout: 60_000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('#country');
    return el instanceof HTMLInputElement && !el.disabled;
  }, undefined, { timeout: 60_000 });
  await combo.click();
  await combo.fill(COUNTRY_NAME.get(code) ?? code);
  const opt = page.locator('#country-listbox [role="option"]').first();
  await opt.waitFor({ state: 'visible', timeout: 15_000 });
  await opt.click();
  await page.getByRole('button', { name: /start application/i }).click();
  await page.waitForURL(/\/intake\//, { timeout: 45_000, waitUntil: 'commit' });
  const id = page.url().split('/intake/')[1]?.split(/[?#]/)[0];
  await page.close();
  return id;
}

/** Run a couple of interview turns so a real checklist (and its upload zones) exists. */
async function seedIntake(context, appId) {
  const page = await context.newPage();
  await page.goto(`${BASE}/en/intake/${appId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const input = page.getByPlaceholder(/type your answer/i);
  const answers = [
    'Tourism — a three week holiday, visiting family.',
    'I am a citizen of IN and I currently live in AE. I am a salaried software engineer.',
  ];
  for (const answer of answers) {
    await page.waitForTimeout(1500);
    if (!(await input.isVisible().catch(() => false))) break;
    await input.fill(answer);
    await page.getByRole('button', { name: /^send$/i }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('Thinking…'),
      undefined, { timeout: 90_000 }).catch(() => {});
  }
  await page.close();
}

// ---------------------------------------------------------------- UPLOADS
async function testUploads(context) {
  // Expectation derived from the product's OWN rules (documents-client.tsx):
  // ACCEPTED_TYPES '.jpg,.jpeg,.png,.heic,.pdf', MAX_FILE_SIZE 50MB, and a
  // check that passes if EITHER the MIME type is allowed OR the extension is.
  const cases = [
    ['valid-passport.pdf', 'accept', 'valid PDF within limits'],
    ['valid-photo.png', 'accept', 'valid PNG'],
    ['tiny.png', 'accept', '1x1 px PNG — tiny but structurally valid'],
    ['unicode-имя-文件-café.pdf', 'accept', 'Unicode filename'],
    [readdirSync(UPLOADS).find((f) => f.startsWith('long-')), 'accept', 'very long filename'],
    ['duplicate-passport.pdf', 'accept', 'duplicate of an already-uploaded file'],
    ['misleading-extension.pdf', 'accept', 'text bytes with a .pdf extension — extension check passes by design'],
    ['corrupt.pdf', 'accept', 'corrupt PDF body, valid extension'],
    ['rejected-type.exe', 'reject', 'disallowed extension'],
    ['oversized.pdf', 'reject', 'exceeds the 50MB cap'],
  ];

  // Upload drop-zones render PER CHECKLIST ITEM, so an application with no
  // interview behind it has no file inputs at all. Seed the profile first.
  const appId = await newApplication(context, 'CA');
  await seedIntake(context, appId);
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/en/documents/${appId}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(3000);

  const input = page.locator('input[type="file"]').first();
  const results = [];
  for (const [file, expected, why] of cases) {
    if (!file) continue;
    const before = await page.locator('main').innerText().catch(() => '');
    try {
      await input.setInputFiles(join(UPLOADS, file));
    } catch (err) {
      // An ERROR is a FAILED case, not a neutral one — counting it as
      // "no mismatch" would have reported 0 problems while nothing ran at all.
      results.push({ file, expected, why, outcome: 'ERROR', matches: false,
        detail: String(err).slice(0, 200) });
      continue;
    }
    // Detection must use a REAL signal. An earlier version regex-matched the
    // whole page for /max|invalid/, which always matched: the drop-zone hint
    // literally reads "Max 50 MB", so every single upload looked rejected.
    // Rejections surface as a role="alert" toast; acceptances put the file name
    // into the document list.
    // Toasts auto-dismiss after 4s (toast-provider.tsx:55), so sampling once at
    // 6s misses every rejection message. Poll instead, and keep whatever we saw.
    const alertsSeen = new Set();
    for (let tick = 0; tick < 26; tick++) {
      for (const a of await page.locator('[role="alert"]').allInnerTexts().catch(() => [])) {
        if (a.trim()) alertsSeen.add(a.trim());
      }
      await page.waitForTimeout(300);
    }
    const after = await page.locator('main').innerText().catch(() => '');
    const alertText = [...alertsSeen].join(' | ');
    const rejected = /too large|unsupported|not supported|couldn't|failed/i.test(alertText);
    const stem = file.replace(/\.[^.]+$/, '').slice(0, 24);
    const listed = stem.length > 3 && after.includes(stem);
    const outcome = rejected ? 'REJECTED' : listed ? 'ACCEPTED'
                  : after !== before ? 'CHANGED_NOT_LISTED' : 'NO_VISIBLE_CHANGE';
    const matches = expected === 'reject'
      ? outcome === 'REJECTED'
      : outcome === 'ACCEPTED' || outcome === 'CHANGED_NOT_LISTED';
    results.push({ file, expected, why, outcome, matches, alert: alertText.slice(0, 200) });
  }

  const shot = join(SHOTS, 'PENDING-uploads.png');
  await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
  const mismatches = results.filter((r) => r.matches === false);
  record({ area: 'uploads', application_id: appId, cases: results,
    mismatches: mismatches.length, console_errors: errors.length, evidence: shot,
    status: mismatches.length ? 'FAIL' : 'PASS' });
  for (const m of mismatches) {
    fileBug({ id: `BUG-UPLOAD-${m.file}`, severity: 'P2',
      title: `upload handling: ${m.file} expected to be ${m.expected}ed, observed ${m.outcome} (${m.why})`,
      evidence: { screenshot: shot } });
  }
  console.log(`[uploads] ${results.length} cases, ${mismatches.length} mismatches`);
  for (const r of results) console.log(`   ${r.outcome.padEnd(17)} ${r.expected.padEnd(6)} ${r.file?.slice(0, 42)}`);
  await page.close();
  return appId;
}

// ------------------------------------------------------------------- A11Y
async function testA11y(context, appId) {
  const pages = [
    ['/en', 'marketing home'],
    ['/en/login', 'login'],
    ['/en/applications/new', 'new application (funnel entry)'],
    ['/en/pricing', 'pricing'],
    [`/en/intake/${appId}`, 'intake interview'],
    [`/en/documents/${appId}`, 'documents'],
    [`/en/readiness/${appId}`, 'readiness'],
    [`/en/submission/${appId}`, 'submission'],
  ];
  const all = [];
  for (const [path, label] of pages) {
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await page.waitForTimeout(2500);
      const res = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      const violations = res.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        sample: v.nodes[0]?.target?.join(' ')?.slice(0, 120),
      }));
      all.push({ path, label, violations, count: violations.length,
        serious: violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').length });
      console.log(`[a11y] ${label.padEnd(32)} ${violations.length} violations `
        + `(${violations.filter((v) => ['serious', 'critical'].includes(v.impact)).length} serious/critical)`);
    } catch (err) {
      all.push({ path, label, error: String(err).slice(0, 200) });
      console.log(`[a11y] ${label} ERROR`);
    }
    await page.close();
  }
  const serious = all.reduce((n, p) => n + (p.serious ?? 0), 0);
  record({ area: 'accessibility', ruleset: 'axe-core wcag2a/2aa/21a/21aa',
    pages: all, total_violations: all.reduce((n, p) => n + (p.count ?? 0), 0),
    serious_or_critical: serious, status: serious ? 'FAIL' : 'PASS' });
  for (const p of all) {
    for (const v of (p.violations ?? []).filter((v) => ['serious', 'critical'].includes(v.impact))) {
      fileBug({ id: `BUG-A11Y-${p.label.replace(/\W+/g, '-')}-${v.id}`,
        severity: v.impact === 'critical' ? 'P1' : 'P2',
        title: `a11y ${v.impact}: ${v.id} on ${p.label} — ${v.help} (${v.nodes} node(s), e.g. ${v.sample})`,
        evidence: { page: p.path } });
    }
  }
  return all;
}

// --------------------------------------------------------------- PAYMENTS
async function testPayments(context, appId) {
  const out = [];
  for (const [path, label] of [['/en/pricing', 'pricing'], [`/en/readiness/${appId}`, 'readiness paywall']]) {
    const page = await context.newPage();
    const failed = [];
    page.on('response', (r) => { if (r.status() >= 500) failed.push(`${r.status()} ${r.url()}`); });
    await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const text = await page.locator('main').innerText().catch(() => '');
    const prices = [...text.matchAll(/[$€£]\s?\d[\d,]*(?:\.\d{2})?/g)].map((m) => m[0]);
    const ctas = await page.getByRole('button').allInnerTexts().catch(() => []);
    const shot = join(SHOTS, `PENDING-payments-${label.replace(/\W+/g, '-')}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    out.push({ path, label, prices_shown: [...new Set(prices)],
      buttons: ctas.map((c) => c.trim()).filter(Boolean).slice(0, 12),
      duplicate_price_conflict: new Set(prices).size !== prices.length && prices.length > 3,
      server_errors: failed, evidence: shot });
    console.log(`[payments] ${label.padEnd(20)} prices=${[...new Set(prices)].join(',') || 'none'} `
      + `buttons=${ctas.length} 5xx=${failed.length}`);
    await page.close();
  }
  record({ area: 'payments', pages: out,
    boundary: 'Presentation and gating only. No card details were entered and no checkout was completed — the harness stops at the checkout boundary by policy, so no charge (real or test) can occur.',
    status: out.some((p) => p.server_errors.length) ? 'FAIL' : 'PASS' });
  return out;
}

// ------------------------------------------------------------------- main
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
if (!(await login(context))) {
  console.error('[pending] login failed — cannot run authenticated areas');
  await browser.close();
  process.exit(1);
}
console.log('[pending] authenticated OK');

let appId = null;
if (AREA === 'uploads' || AREA === 'all') appId = await testUploads(context);
if (!appId) appId = await newApplication(context, 'CA');
if (AREA === 'a11y' || AREA === 'all') await testA11y(context, appId);
if (AREA === 'payments' || AREA === 'all') await testPayments(context, appId);

await context.close();
await browser.close();
console.log('[pending] done');
