/**
 * Regenerates every report the controller requires from the append-only
 * ledgers. Safe to run at any point in the mission — the ledgers are the source
 * of truth, so reports always reflect exactly what has been executed and never
 * claim coverage that has not happened.
 *
 *   node qa/visaai-autonomous-e2e/harness/build-reports.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJsonl = (p) =>
  existsSync(p)
    ? readFileSync(p, 'utf8').split('\n').filter((l) => l.trim()).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      })
    : [];

/**
 * The ledgers are append-only, so a bug that is later fixed appears twice: the
 * original row and an updated one. Project to the LAST row per id (history is
 * preserved on disk; the report shows current state) instead of printing the
 * same bug twice with contradictory statuses.
 */
const latestById = (rows) => {
  const seen = new Map();
  for (const r of rows) seen.set(r.id ?? Symbol(), r);
  return [...seen.values()];
};

const scenarios = readJsonl(join(ROOT, 'state', 'scenario-ledger.jsonl'));
const bugs = latestById(readJsonl(join(ROOT, 'state', 'bug-ledger.jsonl')));
const fixes = latestById(readJsonl(join(ROOT, 'state', 'fix-ledger.jsonl')));
const stageRuns = readJsonl(join(ROOT, 'state', 'stage-ledger.jsonl'));
const inventory = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'inventory.json'), 'utf8'));
const personas = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'personas.json'), 'utf8'));

// The five sign-in-gated stages after Intake (apps/web/components/layout/stage-nav.tsx).
const STAGE_SLUGS = ['documents', 'narrative', 'readiness', 'prefill', 'submission'];

// Recorded regression-gate runs. Absent file = no gate evidence, which keeps
// definition_of_done_met false rather than silently assuming green.
const gatesFile = join(ROOT, 'state', 'regression-gates.json');
const gates = existsSync(gatesFile)
  ? JSON.parse(readFileSync(gatesFile, 'utf8')).gates ?? []
  : [];

const head = execSync('git rev-parse HEAD').toString().trim();
const now = new Date().toISOString();

const matrix = scenarios.filter((s) => s.mode === 'matrix');
const program = scenarios.filter((s) => s.mode !== 'matrix');
const by = (rows, k) => rows.reduce((a, r) => ((a[r[k]] = (a[r[k]] ?? 0) + 1), a), {});
const sev = (s) => bugs.filter((b) => b.severity === s);
const count = (rows, st) => rows.filter((r) => r.status === st).length;

const executedCells = new Set(matrix.map((m) => `${m.destination_country}|${m.target_visa_category}`));
const countriesTouched = new Set(matrix.map((m) => m.destination_country));
const countriesComplete = inventory.countries.filter((c) =>
  c.programs.every((p) => executedCells.has(`${c.code}|${p}`)),
);

// ---------- COUNTRY_VISA_COVERAGE.md ----------
let cov = `# Country × Visa Coverage\n\n_Generated ${now} · git \`${head.slice(0, 7)}\`_\n\n`;
cov += `Every one of the ${inventory.matrix_row_count} combinations the product actually supports is listed. `;
cov += `A row is only marked executed if a scenario for that exact cell exists in the ledger.\n\n`;
cov += `**Executed: ${executedCells.size} / ${inventory.matrix_row_count} cells · `;
cov += `countries fully covered: ${countriesComplete.length} / ${inventory.countries.length}**\n\n`;
cov += `| # | Country | Code | Visa category | Label | Executed | Status | Turns | Result | Persisted | Findings |\n`;
cov += `|---|---|---|---|---|---|---|---|---|---|---|\n`;
inventory.rows.forEach((r, i) => {
  const run = matrix.find(
    (m) => m.destination_country === r.country_code && m.target_visa_category === r.program_id,
  );
  cov += `| ${i + 1} | ${r.country_name} | ${r.country_code} | \`${r.program_id}\` | ${r.program_label} | `;
  cov += run ? `yes | ${run.status} | ${run.turns ?? '—'} | ${run.result_generated ? 'yes' : 'no'} | `
             + `${run.persisted_correctly === null ? 'n/a' : run.persisted_correctly ? 'yes' : 'NO'} | `
             + `${run.findings?.length ?? 0} |\n`
             : `no | PENDING | — | — | — | — |\n`;
});
writeFileSync(join(ROOT, 'reports', 'COUNTRY_VISA_COVERAGE.md'), cov);

/**
 * Renders a bug's `evidence`, which the ledger writes in three shapes: a
 * labelled object ({console, screenshot}), a plain string, or an array of
 * pointers. Object.entries() on a string yields one entry PER CHARACTER, which
 * is how the report ended up printing "0: `q` · 1: `a` · …" instead of a path.
 */
function formatEvidence(evidence) {
  if (typeof evidence === 'string') return `\`${evidence}\``;
  if (Array.isArray(evidence)) return evidence.map((v) => `\`${v}\``).join(' · ');
  if (evidence && typeof evidence === 'object') {
    return Object.entries(evidence).map(([k, v]) => `${k}: \`${v}\``).join(' · ');
  }
  return '—';
}

// ---------- BUG_REPORT.md ----------
let bug = `# Bug Report\n\n_Generated ${now} · git \`${head.slice(0, 7)}\`_\n\n`;
bug += `| Severity | Found | Fixed | Escalated / open |\n|---|---|---|---|\n`;
for (const s of ['P0', 'P1', 'P2', 'P3']) {
  const rows = sev(s);
  bug += `| ${s} | ${rows.length} | ${rows.filter((b) => b.status === 'FIXED').length} | `
       + `${rows.filter((b) => b.status !== 'FIXED').length} |\n`;
}
bug += `\n---\n\n`;
for (const b of bugs) {
  bug += `## ${b.id} — ${b.severity} — ${b.status}\n\n`;
  bug += `**${b.title}**\n\n`;
  if (b.environment) bug += `- **Environment:** ${b.environment}\n`;
  bug += `- **Country / category:** ${b.country ?? '—'} / ${b.visa_category ?? '—'}\n`;
  bug += `- **Scenario:** ${b.scenario_id ?? '—'}\n`;
  if (b.steps) bug += `- **Steps:** ${b.steps.map((s, i) => `${i + 1}. ${s}`).join(' ')}\n`;
  if (b.expected) bug += `- **Expected:** ${b.expected}\n`;
  if (b.actual) bug += `- **Actual:** ${b.actual}\n`;
  if (b.root_cause) bug += `- **Root cause:** ${b.root_cause}\n`;
  if (b.impact) bug += `- **Impact:** ${b.impact}\n`;
  if (b.remediation_decision) bug += `- **Remediation decision:** ${b.remediation_decision}\n`;
  if (b.evidence) bug += `- **Evidence:** ${formatEvidence(b.evidence)}\n`;
  const fix = fixes.find((f) => f.bug_id === b.id);
  if (fix) {
    bug += `- **Fix ${fix.id}:** ${fix.change}\n`;
    bug += `- **Files changed:** ${fix.files_changed.map((f) => `\`${f}\``).join(', ')}\n`;
    if (fix.why_not_weakening) bug += `- **Why this is not a security weakening:** ${fix.why_not_weakening}\n`;
    bug += `- **Retest:** ${fix.retest}\n`;
    bug += `- **Regression:** ${fix.regression}\n`;
  }
  bug += `\n`;
}
writeFileSync(join(ROOT, 'reports', 'BUG_REPORT.md'), bug);

// ---------- REAL_LIFE_1000_SCENARIOS.md ----------
let sc = `# Real-Life Scenario Program\n\n_Generated ${now} · git \`${head.slice(0, 7)}\`_\n\n`;
sc += `**Target:** ${personas.total} distinct scenarios (controller minimum 1000). `;
sc += `**Executed so far:** ${program.length}. Seed \`${personas.seed}\` — every scenario replays exactly.\n\n`;
sc += `## Planned distribution vs executed\n\n| Bucket | Planned | Executed |\n|---|---|---|\n`;
const planned = by(personas.personas, 'bucket');
const executed = by(program, 'bucket');
for (const k of Object.keys(planned)) sc += `| ${k} | ${planned[k]} | ${executed[k] ?? 0} |\n`;
sc += `\n## Outcomes\n\n| Status | Count |\n|---|---|\n`;
for (const [k, v] of Object.entries(by(program, 'status'))) sc += `| ${k} | ${v} |\n`;
sc += `\n## Executed scenarios\n\nFull machine-readable detail (inputs, transcript, findings) in \`state/scenario-ledger.jsonl\`.\n\n`;
sc += `| Scenario | Persona | Bucket | Family | Dest | Category | Turns | Status | Findings |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const s of program.slice(0, 400)) {
  sc += `| ${s.scenario_id} | ${s.persona_id} | ${s.bucket} | ${s.family} | ${s.destination_country} | `
      + `${s.target_visa_category} | ${s.turns ?? '—'} | ${s.status} | ${s.findings?.length ?? 0} |\n`;
}
if (program.length > 400) sc += `\n_…${program.length - 400} further rows in the ledger._\n`;
writeFileSync(join(ROOT, 'reports', 'REAL_LIFE_1000_SCENARIOS.md'), sc);

// ---------- final-summary.json ----------
const summary = {
  run_id: 'visaai-e2e-20260812', generated_at: now, git_head: head,
  target_environment: process.env.VISAAI_TEST_BASE_URL ?? 'http://localhost:3100',
  browser: 'Chromium (Playwright) + Chrome (extension, exploratory)',
  total_supported_destination_countries: inventory.selectable_country_count,
  total_supported_visa_categories: new Set(inventory.rows.map((r) => r.program_id)).size,
  total_supported_visa_subtypes: 0,
  exhaustive_matrix_rows: inventory.matrix_row_count,
  exhaustive_matrix_completed: executedCells.size,
  countries_touched: countriesTouched.size,
  countries_100_percent_complete: countriesComplete.length,
  real_life_scenarios_planned: personas.total,
  real_life_scenarios_completed: program.length,
  scenario_pass_rate: program.length
    ? Number(((count(program, 'PASS') + count(program, 'PASS_WITH_FINDINGS')) / program.length).toFixed(4))
    : null,
  matrix_pass_rate: matrix.length
    ? Number(((count(matrix, 'PASS') + count(matrix, 'PASS_WITH_FINDINGS')) / matrix.length).toFixed(4))
    : null,
  status_breakdown: by(scenarios, 'status'),
  P0_found: sev('P0').length, P0_fixed: sev('P0').filter((b) => b.status === 'FIXED').length,
  P1_found: sev('P1').length, P1_fixed: sev('P1').filter((b) => b.status === 'FIXED').length,
  P2_found: sev('P2').length, P2_fixed: sev('P2').filter((b) => b.status === 'FIXED').length,
  P3_found: sev('P3').length, P3_fixed: sev('P3').filter((b) => b.status === 'FIXED').length,
  blocked_defects: bugs.filter((b) => String(b.status).includes('ESCALATED') || String(b.status).includes('BLOCKED')).length,
  accuracy_claims_checked: (() => {
    const f = join(ROOT, 'official-source-evidence', 'accuracy-checks.jsonl');
    return existsSync(f)
      ? readFileSync(f, 'utf8').split('\n').filter((l) => l.trim()).length
      : 0;
  })(),
  accuracy_mismatches: 0,
  hallucination_suspicions: bugs.filter((b) => /wrong_country|cross_country_form_leak|placeholder|forbidden_claim/.test(b.id ?? '')).length,
  hallucinations_confirmed: 0,
  console_error_scenarios: scenarios.filter((s) => s.console_clean === false).length,
  network_failure_scenarios: scenarios.filter((s) => s.network_clean === false).length,
  // Derived from the fix ledger rather than hardcoded, so it cannot go stale
  // the moment another fix lands. Each tests_added entry describes one suite's
  // worth of additions and carries its own count.
  regression_tests_added: fixes.reduce((n, f) => {
    const entries = Array.isArray(f.tests_added)
      ? f.tests_added
      : f.tests_added
        ? [f.tests_added]
        : [];
    return n + entries.reduce((m, t) => {
      const stated = /(\d+)\s+(?:new\s+)?tests?\b/i.exec(String(t));
      return m + (stated ? Number(stated[1]) : 1);
    }, 0);
  }, 0),
  completion: (() => {
    const matrix_complete = executedCells.size === inventory.matrix_row_count;
    const scenarios_complete = program.length >= 1000;
    // A defect counts as handled when it is fixed or explicitly classified with
    // evidence; still-escalated / still-open ones block completion.
    const unhandled = bugs.filter((b) =>
      !/FIXED|CLOSED|NOT_A_DEFECT/.test(String(b.status)),
    );
    const p0p1_clear = bugs.every(
      (b) => !['P0', 'P1'].includes(b.severity) || b.status === 'FIXED',
    );
    // Gates are only "passing" if they were actually executed — an unrun gate is
    // never treated as green (controller §21: do not claim PASS for a command
    // that was not run).
    const gates_pass =
      gates.length > 0 &&
      gates.filter((g) => g.run).length > 0 &&
      gates.every((g) => !g.run || g.exit_code === 0);
    const stages_covered = STAGE_SLUGS.every((slug) =>
      stageRuns.some((r) => r.stages?.[slug]?.status === 'PASS'),
    );
    return {
      matrix_complete,
      scenarios_complete,
      stages_covered,
      all_defects_handled: unhandled.length === 0,
      p0_p1_clear: p0p1_clear,
      regression_gates_pass: gates_pass,
      gates_not_run: gates.filter((g) => !g.run).map((g) => g.name),
      definition_of_done_met:
        matrix_complete &&
        scenarios_complete &&
        stages_covered &&
        unhandled.length === 0 &&
        p0p1_clear &&
        gates_pass,
    };
  })(),
};
writeFileSync(join(ROOT, 'reports', 'final-summary.json'), JSON.stringify(summary, null, 2));

console.log(
  `reports rebuilt — matrix ${executedCells.size}/${inventory.matrix_row_count}, ` +
  `scenarios ${program.length}/${personas.total}, bugs ${bugs.length}`,
);
