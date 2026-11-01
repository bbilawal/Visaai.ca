/**
 * Stages 2-6 harness — the half of the product the 1,015-scenario run could
 * never reach.
 *
 * The public funnel only ever mints an ANONYMOUS Supabase identity, and
 * JwtGuard is fail-closed for those, so every earlier scenario stopped at
 * Intake. This harness logs in as a seeded fixture user first, then walks
 * Documents -> Generate -> Readiness -> Prefill -> Submit for a real
 * application, capturing console, failed requests and a screenshot per stage.
 *
 *   node qa/visaai-autonomous-e2e/harness/run-stages.mjs --limit 5
 *
 * Env: E2E_FIXTURE_EMAIL / E2E_FIXTURE_PASSWORD (seeded user).
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REPO = join(ROOT, '..', '..');
const requireFromWeb = createRequire(join(REPO, 'apps', 'web', 'package.json'));
const playwright = await import(
  pathToFileURL(requireFromWeb.resolve('@playwright/test')).href
);
const { chromium } = playwright.default ?? playwright;

const BASE = process.env.VISAAI_TEST_BASE_URL ?? 'http://localhost:3100';
const EMAIL = process.env.E2E_FIXTURE_EMAIL ?? 'qa.stage.fixture@example.invalid';
const PASSWORD = process.env.E2E_FIXTURE_PASSWORD ?? 'QaFixture!2026Stage';

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i === -1 ? d : argv[i + 1];
};
const LIMIT = Number(flag('limit', '5'));
const HEADED = argv.includes('--headed');

const LEDGER = join(ROOT, 'state', 'stage-ledger.jsonl');
const BUGS = join(ROOT, 'state', 'bug-ledger.jsonl');
const SHOTS = join(ROOT, 'screenshots');
const CONSOLE_DIR = join(ROOT, 'console');
const NETWORK_DIR = join(ROOT, 'network');
for (const d of [SHOTS, CONSOLE_DIR, NETWORK_DIR]) mkdirSync(d, { recursive: true });

const inventory = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'inventory.json'), 'utf8'));
const personas = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'personas.json'), 'utf8')).personas;
const COUNTRY_NAME = new Map(inventory.countries.map((c) => [c.code, c.name]));

// Stage slugs come from the product itself (components/layout/stage-nav.tsx).
const STAGES = [
  { slug: 'documents', label: 'Documents', expect: /document|upload|checklist|required/i },
  { slug: 'narrative', label: 'Generate', expect: /letter|narrative|generate|draft|cover/i },
  { slug: 'readiness', label: 'Readiness', expect: /readiness|score|recommend|vri/i },
  { slug: 'prefill', label: 'Prefill', expect: /prefill|form|field|portal/i },
  { slug: 'submission', label: 'Submit', expect: /submit|portal|session|extension/i },
];

const FORBIDDEN = [
  /guarantee(d|s)?\s+(your\s+)?(visa\s+)?approval/i,
  /100%\s+(approval|success)/i,
  /your\s+visa\s+will\s+be\s+approved/i,
];
const PLACEHOLDER = [
  /lorem ipsum/i, /\bTODO\b/, /\bFIXME\b/, /\{\{\s*\w+\s*\}\}/,
  /\[INSERT[^\]]*\]/i, /undefined\s+undefined/, /\bNaN\b/,
  /system prompt/i, /"role"\s*:\s*"system"/i,
];

const seen = new Set();
if (existsSync(LEDGER)) {
  for (const l of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    try { seen.add(JSON.parse(l).run_id); } catch { /* partial */ }
  }
}

function answerFor(question, p) {
  const q = question.toLowerCase();
  const dest = COUNTRY_NAME.get(p.intended_destination) ?? p.intended_destination;
  if (/purpose|why.*(visit|travel)|reason for/.test(q))
    return `${p.travel_purpose.replace(/_/g, ' ')} — trip to ${dest}.`;
  if (/nationality|citizen|residence/.test(q))
    return `Citizen of ${p.nationality}, living in ${p.residence_country}.`;
  if (/employ|job|work|occupation/.test(q))
    return `I am ${p.employment_status.replace(/_/g, ' ')}${p.occupation ? `, a ${p.occupation}` : ''}.`;
  if (/fund|financ|money|bank|income/.test(q))
    return `Funded by ${p.funding_method.replace(/_/g, ' ')}; income band ${p.income_band.replace(/_/g, ' ')}.`;
  return `${p.travel_purpose.replace(/_/g, ' ')} trip to ${dest}. ${p.synthetic_name}, ${p.nationality} national.`;
}

const browser = await chromium.launch({ headless: !HEADED });

// --- one login, reused for every run -------------------------------------
const authCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const loginPage = await authCtx.newPage();
await loginPage.goto(`${BASE}/en/login`, { waitUntil: 'domcontentloaded' });
// Filling before React hydration completes silently loses the value — the
// controlled input is reset when hydration takes over, and the form then
// submits with an empty email and no error. Fill, then VERIFY it stuck.
// Verifying once is not enough: hydration can reset the field AFTER the check
// and before the click, which submits an empty email and trips the browser's
// own "Please fill out this field". So re-verify immediately before clicking
// and retry the whole fill+submit if either value has been dropped.
const email = loginPage.locator('#login-email');
const pw = loginPage.locator('#login-password');
await email.waitFor({ state: 'visible', timeout: 30_000 });
// Let hydration settle before typing at all — a human would.
await loginPage.waitForLoadState('networkidle').catch(() => {});
await loginPage.waitForTimeout(1500);

for (let attempt = 1; attempt <= 4; attempt++) {
  await email.fill(EMAIL);
  await pw.fill(PASSWORD);
  await loginPage.waitForTimeout(400);
  if ((await email.inputValue()) !== EMAIL || (await pw.inputValue()) !== PASSWORD) {
    await loginPage.waitForTimeout(1000);
    continue; // values were dropped — refill before we ever click
  }
  await loginPage.locator('button[type="submit"]').click();
  await loginPage.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 30_000 })
    .catch(() => {});
  if (!loginPage.url().includes('/login')) break;
  console.log(`[stages] login attempt ${attempt} did not navigate; retrying`);
  await loginPage.waitForTimeout(1500);
}
const loggedIn = !loginPage.url().includes('/login');
console.log(`[stages] login as ${EMAIL} -> ${loggedIn ? 'OK' : 'FAILED'} (${loginPage.url()})`);
if (!loggedIn) {
  const shot = join(SHOTS, 'STAGE-login-failed.png');
  await loginPage.screenshot({ path: shot, fullPage: true }).catch(() => {});
  console.error(`[stages] cannot proceed without a session. evidence: ${shot}`);
  await browser.close();
  process.exit(1);
}
const storageState = await authCtx.storageState();
await authCtx.close();

// Guarantee EVERY visa category is represented before spreading across
// countries. A plain stride over inventory.rows silently skipped student_visa,
// work_permit and family_sponsorship, because the rare categories sit on rows
// the stride steps over — which would have left three of six categories with
// no gated-stage coverage at all while the report showed "14 runs".
const toPick = (row, i) => {
  const base = personas.find((p) => p.intended_destination === row.country_code)
    ?? personas[i % personas.length];
  return { ...base, intended_destination: row.country_code, target_visa_category: row.program_id };
};
const picks = [];
const takenCells = new Set();
for (const category of new Set(inventory.rows.map((r) => r.program_id))) {
  const row = inventory.rows.find((r) => r.program_id === category);
  if (!row) continue;
  picks.push(toPick(row, picks.length));
  takenCells.add(`${row.country_code}|${row.program_id}`);
}
const stride = Math.max(1, Math.floor(inventory.rows.length / Math.max(1, LIMIT)));
for (let i = 0; picks.length < LIMIT && i < inventory.rows.length; i += stride) {
  const row = inventory.rows[i];
  if (takenCells.has(`${row.country_code}|${row.program_id}`)) continue;
  takenCells.add(`${row.country_code}|${row.program_id}`);
  picks.push(toPick(row, i));
}

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, storageState });
let done = 0;
const counts = {};

for (const persona of picks) {
  const runId = `STAGE-${persona.intended_destination}-${persona.target_visa_category}`;
  if (seen.has(runId)) continue;
  const started = new Date().toISOString();
  const page = await context.newPage();
  const consoleErrors = [];
  const failed = [];
  const allConsole = [];
  page.on('console', (m) => {
    allConsole.push(`[${m.type()}] ${m.text()}`);
    const noise = /favicon|React DevTools|hot-update|_next\/static|429|script tag/i;
    if (m.type() === 'error' && !noise.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failed.push({ url: r.url(), status: 0, error: r.failure()?.errorText }));
  page.on('response', (r) => { if (r.status() >= 400) failed.push({ url: r.url(), status: r.status() }); });

  const row = { run_id: runId, persona_id: persona.persona_id, mode: 'stages',
    destination_country: persona.intended_destination,
    target_visa_category: persona.target_visa_category, started_at: started, stages: {} };

  try {
    // --- create an application as the AUTHENTICATED user ---
    await page.goto(`${BASE}/en/applications/new`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const combo = page.locator('#country');
    await combo.waitFor({ state: 'visible', timeout: 60_000 });
    await page.waitForFunction(() => {
      const el = document.querySelector('#country');
      return el instanceof HTMLInputElement && !el.disabled;
    }, undefined, { timeout: 60_000 });
    await combo.click();
    await combo.fill(COUNTRY_NAME.get(persona.intended_destination) ?? persona.intended_destination);
    const opt = page.locator('#country-listbox [role="option"]').first();
    await opt.waitFor({ state: 'visible', timeout: 15_000 });
    await opt.click();
    await page.getByRole('button', { name: /start application/i }).click();
    await page.waitForURL(/\/intake\//, { timeout: 45_000, waitUntil: 'commit' });
    const appId = page.url().split('/intake/')[1]?.split(/[?#]/)[0];
    row.application_id = appId;

    // --- seed the profile with a couple of interview turns so downstream
    //     stages have something real to work from ---
    const input = page.getByPlaceholder(/type your answer/i);
    for (let t = 0; t < 2; t++) {
      await page.waitForTimeout(1500);
      const body = await page.locator('main').innerText().catch(() => '');
      const q = body.split('Next question:').pop()?.split('\n').slice(0, 3).join(' ').trim() ?? '';
      if (!q || !(await input.isVisible().catch(() => false))) break;
      await input.fill(answerFor(q, persona));
      await page.getByRole('button', { name: /^send$/i }).click();
      await page.waitForFunction(() => !document.body.innerText.includes('Thinking…'),
        undefined, { timeout: 90_000 }).catch(() => {});
    }

    // --- walk every gated stage ---
    for (const stage of STAGES) {
      const before = failed.length;
      const url = `${BASE}/en/${stage.slug}/${appId}`;
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => null);
      await page.waitForTimeout(2500);
      const text = await page.locator('main').innerText().catch(() => '');
      const redirectedToLogin = page.url().includes('/login');
      const findings = [];

      if (redirectedToLogin) {
        findings.push({ severity: 'P1', type: 'stage_unreachable_when_authenticated',
          detail: `${stage.slug} redirected an AUTHENTICATED user to /login` });
      }
      for (const re of FORBIDDEN) {
        const m = text.match(re);
        if (m) findings.push({ severity: 'P0', type: 'forbidden_claim', detail: m[0] });
      }
      for (const re of PLACEHOLDER) {
        const m = text.match(re);
        if (m) findings.push({ severity: 'P1', type: 'placeholder_or_debug_residue', detail: m[0] });
      }
      const stageFailures = failed.slice(before).filter(
        (r) => r.status >= 500 || (r.status === 0 && !/ABORTED|CANCEL/i.test(r.error ?? '')),
      );
      if (stageFailures.length) {
        findings.push({ severity: 'P1', type: 'network_failure',
          detail: stageFailures.slice(0, 3).map((r) => `${r.status} ${r.url}`).join(' | ').slice(0, 400) });
      }

      const rendered = stage.expect.test(text);
      const shot = join(SHOTS, `${runId}-${stage.slug}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

      row.stages[stage.slug] = {
        http: resp?.status() ?? null,
        reachable: !redirectedToLogin && (resp?.status() ?? 0) < 400,
        content_rendered: rendered,
        text_len: text.length,
        findings,
        evidence: shot,
        status: findings.some((f) => f.severity === 'P0' || f.severity === 'P1') ? 'FAIL'
              : !rendered ? 'REACHED_NO_EXPECTED_CONTENT' : 'PASS',
      };
    }

    row.console_clean = consoleErrors.length === 0;
    row.network_clean = failed.filter((r) => r.status >= 500).length === 0;
    const all = Object.values(row.stages);
    row.stages_passed = all.filter((s) => s.status === 'PASS').length;
    row.stages_total = all.length;
    row.status = all.some((s) => s.status === 'FAIL') ? 'FAIL'
               : row.stages_passed === all.length ? 'PASS' : 'PARTIAL';

    writeFileSync(join(CONSOLE_DIR, `${runId}.log`), allConsole.join('\n'));
    writeFileSync(join(NETWORK_DIR, `${runId}.json`), JSON.stringify(failed, null, 2));

    for (const [slug, st] of Object.entries(row.stages)) {
      for (const f of st.findings) {
        appendFileSync(BUGS, JSON.stringify({
          id: `BUG-STAGE-${runId}-${slug}-${f.type}`, severity: f.severity,
          found_at: new Date().toISOString(), scenario_id: runId,
          country: persona.intended_destination, visa_category: persona.target_visa_category,
          stage: slug, title: `${f.type} on ${slug}: ${f.detail}`.slice(0, 300),
          evidence: { screenshot: st.evidence }, status: 'OPEN', source: 'stages-harness',
          signature: `${f.type}|${slug}|${f.detail.slice(0, 100)}`,
        }) + '\n');
      }
    }
  } catch (err) {
    row.status = 'ERROR';
    row.error = String(err).slice(0, 400);
  } finally {
    row.finished_at = new Date().toISOString();
    appendFileSync(LEDGER, JSON.stringify(row) + '\n');
    await page.close().catch(() => {});
  }

  counts[row.status] = (counts[row.status] ?? 0) + 1;
  done += 1;
  const per = Object.entries(row.stages ?? {}).map(([k, v]) => `${k}:${v.status?.[0] ?? '?'}`).join(' ');
  console.log(`[${done}/${picks.length}] ${runId} → ${row.status} (${row.stages_passed ?? 0}/${row.stages_total ?? 0}) ${per}`);
}

await context.close();
await browser.close();
console.log(`[stages] done. counts=${JSON.stringify(counts)}`);
