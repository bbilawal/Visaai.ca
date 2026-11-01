/**
 * VisaAI autonomous E2E scenario harness.
 *
 * Drives the REAL product through a real Chromium browser (Playwright, the
 * stack this repo already uses) as an ordinary user would: pick a destination
 * on /applications/new, start the application, answer the AI intake interview
 * in natural language, then inspect the generated result, the console and every
 * failed network request.
 *
 * Resumable by design — every scenario appends one line to scenario-ledger.jsonl
 * and already-recorded scenario_ids are skipped, so a crash, a browser restart
 * or a context reset never repeats finished work.
 *
 *   node qa/visaai-autonomous-e2e/harness/run-scenarios.mjs --limit 10
 *   node qa/visaai-autonomous-e2e/harness/run-scenarios.mjs --mode matrix
 *
 * Flags:
 *   --limit N      stop after N newly executed scenarios (default: all)
 *   --mode X       'scenarios' (persona program) | 'matrix' (country x visa)
 *   --workers N    parallel browser contexts (default 4)
 *   --turns N      max intake turns per scenario (default 4)
 *   --headed       run headed instead of headless
 */
import { readFileSync, appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const REPO = join(ROOT, '..', '..');

// The harness lives outside apps/web, so resolve Playwright from the workspace
// that actually owns it rather than relying on the harness's own node_modules.
const requireFromWeb = createRequire(join(REPO, 'apps', 'web', 'package.json'));
const playwright = await import(
  pathToFileURL(requireFromWeb.resolve('@playwright/test')).href
);
const { chromium } = playwright.default ?? playwright;
const BASE = process.env.VISAAI_TEST_BASE_URL ?? 'http://localhost:3100';

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(`--${name}`);

const MODE = flag('mode', 'scenarios');
const LIMIT = Number(flag('limit', '0')) || Infinity;
const WORKERS = Number(flag('workers', '4'));
const MAX_TURNS = Number(flag('turns', '4'));
const HEADED = has('headed');

const LEDGER = join(ROOT, 'state', 'scenario-ledger.jsonl');
const BUGS = join(ROOT, 'state', 'bug-ledger.jsonl');
const CHECKPOINTS = join(ROOT, 'state', 'checkpoints.jsonl');
const SHOTS = join(ROOT, 'screenshots');
const CONSOLE_DIR = join(ROOT, 'console');
const NETWORK_DIR = join(ROOT, 'network');
for (const d of [SHOTS, CONSOLE_DIR, NETWORK_DIR]) mkdirSync(d, { recursive: true });

const inventory = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'inventory.json'), 'utf8'));
const personas = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'personas.json'), 'utf8')).personas;

/** Every form code the product legitimately owns, indexed by country. */
const FORMS_BY_COUNTRY = new Map();
for (const r of inventory.rows) {
  const set = FORMS_BY_COUNTRY.get(r.country_code) ?? new Set();
  for (const f of r.forms) set.add(f.toUpperCase().replace(/\s+/g, ' '));
  FORMS_BY_COUNTRY.set(r.country_code, set);
}
/** All form codes the product knows about anywhere — used to spot leakage. */
const ALL_FORMS = new Map();
for (const [country, set] of FORMS_BY_COUNTRY) {
  for (const f of set) {
    if (!ALL_FORMS.has(f)) ALL_FORMS.set(f, new Set());
    ALL_FORMS.get(f).add(country);
  }
}

const COUNTRY_NAME = new Map(inventory.countries.map((c) => [c.code, c.name]));

// Country names that must NOT appear in a result for a different destination.
// Only unambiguous, single-token-safe names are checked so ordinary prose
// ("the Canadian embassy in Paris") cannot produce a false positive on its own.
const DISTINCTIVE = new Map(
  [...COUNTRY_NAME.entries()].filter(([, n]) => !/^(Malta|Chile)$/.test(n)),
);

/** Phrases a compliant immigration product must never emit. */
const FORBIDDEN_CLAIMS = [
  /guarantee(d|s)?\s+(your\s+)?(visa\s+)?approval/i,
  /100%\s+(approval|success)/i,
  /we\s+are\s+(a|an)\s+(government|official)\s+(agency|department)/i,
  /your\s+visa\s+will\s+be\s+approved/i,
  /approval\s+is\s+guaranteed/i,
];

/** Placeholder / debug residue that must never reach a user. */
const PLACEHOLDER = [
  /lorem ipsum/i,
  /\bTODO\b/,
  /\bFIXME\b/,
  /\{\{\s*\w+\s*\}\}/,
  /\[INSERT[^\]]*\]/i,
  /undefined\s+undefined/,
  /\bNaN\b/,
  /system prompt/i,
  /"role"\s*:\s*"system"/i,
];

/** Defect signatures already in the bug ledger — keeps it one row per defect. */
const bugSignatures = new Set();
if (existsSync(BUGS)) {
  for (const line of readFileSync(BUGS, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const b = JSON.parse(line);
      if (b.signature) bugSignatures.add(b.signature);
    } catch { /* partial line */ }
  }
}

const seen = new Set();
if (existsSync(LEDGER)) {
  for (const line of readFileSync(LEDGER, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { seen.add(JSON.parse(line).scenario_id); } catch { /* partial line */ }
  }
}

/**
 * Persona → natural-language answer for whatever the interview just asked.
 * Keyword-routed so the same persona always answers the same way (replayable),
 * with a purpose-led fallback that keeps the interview moving.
 */
function answerFor(question, p) {
  const q = question.toLowerCase();
  const dest = COUNTRY_NAME.get(p.intended_destination) ?? p.intended_destination;
  const pick = (...pairs) => {
    for (const [re, ans] of pairs) if (re.test(q)) return ans;
    return null;
  };
  return pick(
    [/purpose|why.*(visit|travel|going)|reason for/, `${p.travel_purpose.replace(/_/g, ' ')} — I am planning a trip to ${dest}.`],
    [/nationality|citizen|passport.*(country|issued)|country of.*(residence|origin)/,
      `I am a citizen of ${p.nationality} and I currently live in ${p.residence_country}.`],
    [/passport.*(expir|valid)|expiry/, `My passport ${p.passport_expiry_band.replace(/_/g, ' ')}. Passport number ${p.synthetic_passport}.`],
    [/name|who are you/, `My full name is ${p.synthetic_name}.`],
    [/date of birth|birth|how old|age/, `I was born on ${p.synthetic_dob}.`],
    [/employ|job|work|occupation|profession/,
      p.occupation
        ? `I am ${p.employment_status.replace(/_/g, ' ')}, working as a ${p.occupation}.`
        : `I am currently ${p.employment_status.replace(/_/g, ' ')}.`],
    [/education|study|school|degree|qualification/, `My highest qualification is ${p.education}.`],
    [/fund|financ|money|afford|bank|savings|income|salary|cost/,
      `The trip is funded by ${p.funding_method.replace(/_/g, ' ')}. My income band is ${p.income_band.replace(/_/g, ' ')}.`],
    [/married|marital|spouse|partner/, `I am ${p.marital_status.replace(/_/g, ' ')}.`],
    [/child|depend|family.*(travel|accompany)|who.*travelling with/,
      p.dependants ? `I have ${p.dependants} dependants.` : `I have no dependants.`],
    [/refus|reject|denied|previous.*(visa|application)/,
      p.prior_refusal === 'none'
        ? `I have never been refused a visa.`
        : `Yes — ${p.prior_refusal.replace(/_/g, ' ')}.`],
    [/travel(led)? (before|history)|visited|been to|prior travel/, `My travel history: ${p.prior_travel.replace(/_/g, ' ')}.`],
    [/when|date|how long|duration|stay|depart|arriv/, `I plan to travel ${p.intended_dates}.`],
    [/where.*stay|accommodat|address|hotel/, `I will stay in ${dest} at a booked hotel; my home address is in ${p.residence_country}.`],
    [/email|contact|phone/, `Email ${p.email}, phone ${p.phone}.`],
    [/tie|return|come back|home country/, `I have ongoing ties in ${p.residence_country} and will return after the trip.`],
    [/sponsor|invit|host|relative/, `Funding is ${p.funding_method.replace(/_/g, ' ')}.`],
    [/criminal|convict|offence|security|medical|health/, `No — nothing to declare.`],
  ) ?? `${p.travel_purpose.replace(/_/g, ' ')} trip to ${dest}. ${p.synthetic_name}, ${p.nationality} national living in ${p.residence_country}.`;
}

/** Everything an evaluator needs to judge one scenario's final page. */
function evaluate({ text, persona, consoleErrors, failedRequests }) {
  const findings = [];
  const dest = persona.intended_destination;
  const destName = COUNTRY_NAME.get(dest) ?? dest;

  // 1. Wrong-country result: a DIFFERENT destination named more often than ours.
  for (const [code, name] of DISTINCTIVE) {
    if (code === dest) continue;
    const hits = (text.match(new RegExp(`\\b${name}\\b`, 'gi')) ?? []).length;
    if (hits > 0 && !new RegExp(`\\b${destName}\\b`, 'i').test(text)) {
      findings.push({ type: 'wrong_country_result', severity: 'P1', detail: `mentions ${name} but never ${destName}` });
    }
  }

  // 2. Government form belonging to another country's programme.
  for (const [form, owners] of ALL_FORMS) {
    if (owners.has(dest)) continue;
    const pattern = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
    if (new RegExp(`\\b${pattern}\\b`, 'i').test(text)) {
      findings.push({
        type: 'cross_country_form_leak', severity: 'P1',
        detail: `form ${form} (owned by ${[...owners].join('/')}) shown for ${dest}`,
      });
    }
  }

  // 3. Compliance-forbidden claims.
  for (const re of FORBIDDEN_CLAIMS) {
    const m = text.match(re);
    if (m) findings.push({ type: 'forbidden_claim', severity: 'P0', detail: m[0] });
  }

  // 4. Placeholder / debug / prompt residue.
  for (const re of PLACEHOLDER) {
    const m = text.match(re);
    if (m) findings.push({ type: 'placeholder_or_debug_residue', severity: 'P1', detail: m[0] });
  }

  // 5. Browser + network health.
  if (consoleErrors.length) {
    findings.push({ type: 'console_error', severity: 'P2', detail: consoleErrors.slice(0, 3).join(' | ').slice(0, 500) });
  }
  // status 0 = the request never completed. An ABORTED one is almost always the
  // browser tearing down a long-lived stream (SSE/websocket) because the page
  // navigated or reloaded — normal teardown, not a server failure. Counting it
  // would mark every scenario that reloads mid-stream as a P1.
  const criticalFailures = failedRequests.filter(
    (r) => r.status >= 500 || (r.status === 0 && !/ABORTED|CANCEL/i.test(r.error ?? '')),
  );
  if (criticalFailures.length) {
    findings.push({
      type: 'network_failure', severity: 'P1',
      detail: criticalFailures.slice(0, 3).map((r) => `${r.status} ${r.url}`).join(' | ').slice(0, 500),
    });
  }
  return findings;
}

async function runScenario(context, persona) {
  const started = new Date().toISOString();
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  const allConsole = [];

  page.on('console', (m) => {
    allConsole.push(`[${m.type()}] ${m.text()}`);
    // Next.js dev overlay and HMR chatter are environment noise, not product
    // defects. So is a 429 from /analytics/collect: that limiter is per-IP and
    // only trips because N parallel workers share one host — a real user at
    // human rates never reaches it, so counting it as a defect would be a
    // false positive manufactured by the harness itself.
    const noise = /favicon|Download the React DevTools|hot-update|_next\/static|429/i;
    if (m.type() === 'error' && !noise.test(m.text())) consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failedRequests.push({ url: r.url(), status: 0, error: r.failure()?.errorText }));
  page.on('response', (r) => {
    if (r.status() >= 400) failedRequests.push({ url: r.url(), status: r.status() });
  });

  const row = {
    scenario_id: persona.scenario_id, persona_id: persona.persona_id,
    bucket: persona.bucket, family: persona.family,
    destination_country: persona.intended_destination,
    target_visa_category: persona.target_visa_category,
    mode: MODE, started_at: started,
  };

  try {
    await page.goto(`${BASE}/en/applications/new`, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    // --- pick the destination through the real combobox ---
    const combo = page.locator('#country');
    // The picker renders disabled + aria-busy while GET /countries is in flight
    // (including its retry ladder). Under parallel workers on a dev server that
    // can take a while, so wait for it to become ENABLED rather than merely
    // present — clicking a busy control just burns the timeout.
    await combo.waitFor({ state: 'visible', timeout: 60_000 });
    await page
      .waitForFunction(
        () => {
          const el = document.querySelector('#country');
          return el instanceof HTMLInputElement && !el.disabled;
        },
        undefined,
        { timeout: 60_000 },
      );
    await combo.click({ timeout: 20_000 });
    await combo.fill(COUNTRY_NAME.get(persona.intended_destination) ?? persona.intended_destination);
    // Scope to the combobox's OWN listbox — a bare getByRole('option') also
    // matches the sidebar language <select>, which is hidden and never resolves.
    const option = page.locator('#country-listbox [role="option"]').first();
    await option.waitFor({ state: 'visible', timeout: 15_000 });
    await option.click();

    row.form_reachable = true;

    await page.getByRole('button', { name: /start application/i }).click();
    // 'commit' not the default 'load': the intake page holds a WebSocket and an
    // SSE stream open, so the load event can stay pending indefinitely under
    // contention even though navigation succeeded. The URL change is the real
    // signal that the application was created.
    await page.waitForURL(/\/intake\//, { timeout: 45_000, waitUntil: 'commit' });
    row.application_id = page.url().split('/intake/')[1]?.split(/[?#]/)[0] ?? null;

    // --- drive the AI interview ---
    const input = page.getByPlaceholder(/type your answer/i);
    const turns = [];
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      await page.waitForTimeout(1500);
      const body = await page.locator('main').innerText().catch(() => '');
      const question = body.split('Next question:').pop()?.split('\n').slice(0, 3).join(' ').trim() ?? '';
      if (!question) break;
      const answer = answerFor(question, persona);
      turns.push({ turn, question: question.slice(0, 300), answer });
      if (!(await input.isVisible().catch(() => false))) break;
      await input.fill(answer);
      await page.getByRole('button', { name: /^send$/i }).click();
      // The interview streams over a websocket; wait for the thinking state to clear.
      await page.waitForFunction(
        () => !document.body.innerText.includes('Thinking…'),
        undefined,
        { timeout: 90_000 },
      ).catch(() => {});
    }
    row.turns = turns.length;
    row.form_completed = turns.length > 0;
    row.transcript = turns;

    await page.waitForTimeout(2000);
    const finalText = await page.locator('main').innerText().catch(() => '');
    row.result_generated = /Required Forms|Supporting Documents|Required Documents/i.test(finalText);

    // --- persistence: the checklist must survive a full reload ---
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    const afterReload = await page.locator('main').innerText().catch(() => '');
    row.persisted_correctly = row.result_generated
      ? /Required Forms|Supporting Documents/i.test(afterReload)
      : null;

    const findings = evaluate({ text: finalText + '\n' + afterReload, persona, consoleErrors, failedRequests });
    row.findings = findings;
    row.console_clean = consoleErrors.length === 0;
    row.network_clean = failedRequests.filter((r) => r.status >= 500 || r.status === 0).length === 0;
    row.status = findings.some((f) => f.severity === 'P0' || f.severity === 'P1')
      ? 'FAIL'
      : findings.length ? 'PASS_WITH_FINDINGS'
      : row.result_generated ? 'PASS' : 'INCOMPLETE';
    row.result_accuracy_checked = row.result_generated ? 'HEURISTIC_ONLY_NEEDS_OFFICIAL_VERIFICATION' : 'N/A';

    if (row.status !== 'PASS') {
      const shot = join(SHOTS, `${persona.scenario_id}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      row.evidence_path = shot;
      writeFileSync(join(CONSOLE_DIR, `${persona.scenario_id}.log`), allConsole.join('\n'));
      writeFileSync(join(NETWORK_DIR, `${persona.scenario_id}.json`), JSON.stringify(failedRequests, null, 2));
      for (const f of findings) {
        // One ledger entry per DISTINCT defect, not per scenario that hits it.
        // Without this the same known 403 would file a thousand identical bugs
        // and drown the real findings.
        const signature = `${f.type}|${persona.intended_destination}|${f.detail.slice(0, 120)}`;
        if (bugSignatures.has(signature)) continue;
        bugSignatures.add(signature);
        appendFileSync(BUGS, JSON.stringify({
          id: `BUG-AUTO-${persona.scenario_id}-${f.type}`, severity: f.severity,
          found_at: new Date().toISOString(), first_seen_scenario: persona.scenario_id,
          country: persona.intended_destination, visa_category: persona.target_visa_category,
          title: `${f.type}: ${f.detail}`.slice(0, 300), evidence: { screenshot: shot },
          status: 'OPEN', source: 'harness', signature,
        }) + '\n');
      }
    }
  } catch (err) {
    row.status = 'ERROR';
    row.error = String(err).slice(0, 500);
    const shot = join(SHOTS, `${persona.scenario_id}-error.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    row.evidence_path = shot;
  } finally {
    row.finished_at = new Date().toISOString();
    appendFileSync(LEDGER, JSON.stringify(row) + '\n');
    await page.close().catch(() => {});
  }
  return row;
}

// --- work list ------------------------------------------------------------
let queue;
if (MODE === 'matrix') {
  // One representative persona per country x visa-category row.
  queue = inventory.rows.map((r, i) => {
    const base = personas.find(
      (p) => p.intended_destination === r.country_code && p.target_visa_category === r.program_id,
    ) ?? personas[i % personas.length];
    return { ...base, scenario_id: `MTX-${String(i + 1).padStart(3, '0')}`,
      intended_destination: r.country_code, target_visa_category: r.program_id,
      bucket: 'matrix', family: 'country_visa_matrix' };
  });
} else {
  // Interleave buckets round-robin instead of running them in blocks. The
  // personas file is generated bucket-by-bucket, so a sequential queue spends
  // its first 350 scenarios entirely on happy paths — and any interruption
  // would leave whole scenario families at zero coverage. Round-robin keeps
  // every family represented at every prefix of the run, which is what the
  // coverage requirement actually asks for.
  const lanesByBucket = new Map();
  for (const p of personas) {
    if (!lanesByBucket.has(p.bucket)) lanesByBucket.set(p.bucket, []);
    lanesByBucket.get(p.bucket).push(p);
  }
  const buckets = [...lanesByBucket.values()];
  queue = [];
  for (let i = 0; queue.length < personas.length; i++) {
    for (const b of buckets) if (b[i]) queue.push(b[i]);
  }
}
queue = queue.filter((p) => !seen.has(p.scenario_id)).slice(0, LIMIT === Infinity ? undefined : LIMIT);

console.log(`[harness] mode=${MODE} queued=${queue.length} skipped=${seen.size} workers=${WORKERS} base=${BASE}`);

const browser = await chromium.launch({ headless: !HEADED });
let done = 0;
const counts = {};

// A context accumulates cache, service workers and storage for every page it
// has ever opened. Held for a 1000-scenario run that grows without bound and
// the OS eventually reaps the process — which is exactly what killed two
// earlier runs. Recycling on a fixed interval keeps the footprint flat.
const CONTEXTS_RECYCLE_EVERY = 25;

async function worker(items) {
  let context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  let sinceRecycle = 0;
  for (const persona of items) {
    if (sinceRecycle >= CONTEXTS_RECYCLE_EVERY) {
      await context.close().catch(() => {});
      context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      sinceRecycle = 0;
    }
    sinceRecycle += 1;
    const row = await runScenario(context, persona);
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    done += 1;
    console.log(`[${done}/${queue.length}] ${row.scenario_id} ${row.destination_country}/${row.target_visa_category} → ${row.status}${row.findings?.length ? ` (${row.findings.length} findings)` : ''}`);
    if (done % 10 === 0) {
      appendFileSync(CHECKPOINTS, JSON.stringify({
        ts: new Date().toISOString(), event: 'batch_checkpoint', mode: MODE,
        scenarios_completed: seen.size + done, counts,
        next_action: 'continue scenario queue',
      }) + '\n');
    }
  }
  await context.close();
}

const lanes = Array.from({ length: WORKERS }, () => []);
queue.forEach((p, i) => lanes[i % WORKERS].push(p));
await Promise.all(lanes.map(worker));
await browser.close();

console.log(`[harness] done. counts=${JSON.stringify(counts)}`);
appendFileSync(CHECKPOINTS, JSON.stringify({
  ts: new Date().toISOString(), event: 'run_complete', mode: MODE,
  executed: done, counts, next_action: 'triage findings / continue remaining queue',
}) + '\n');
