#!/usr/bin/env node
/**
 * Generate docs/execution/CURRENT_STATE_AUDIT.md — spec §0.1's requirement that
 * EVERY numbered section be mapped to status, evidence, remaining work,
 * dependencies and a verification command.
 *
 * WHY THE INDEX IS GENERATED FROM THE SPECIFICATION ITSELF
 *
 * The §84 checklist in docs/exec/EXECUTION_STATUS.md was transcribed by hand.
 * It tracked 60 of the spec's 68 items, and the eight it omitted were invisible
 * precisely because they were omitted — nothing downstream ever asked about a
 * row that did not exist. One of them ("all 195 baseline countries present")
 * stayed invisible while three destinations were built on top of it.
 *
 * A hand-written audit of 89 sections would fail the same way, and worse: an
 * audit is the artefact whose whole job is to make gaps visible. So the section
 * list is READ OUT OF THE SPECIFICATION at generation time. Sections cannot be
 * omitted — only assessed or explicitly marked NOT_ASSESSED.
 *
 * The assessments live in docs/execution/section-assessments.json. A section
 * with no entry is not silently dropped and is not assumed fine; it is printed
 * as NOT_ASSESSED, which is a true statement about our knowledge rather than a
 * blank that reads as absence of a problem.
 *
 * Usage:  node scripts/execution/generate-current-state-audit.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const SPEC = '../VisaAI_Claude_Master_Execution_Spec.md';
const ASSESSMENTS = 'docs/execution/section-assessments.json';
const OUT = 'docs/execution/CURRENT_STATE_AUDIT.md';

if (!existsSync(SPEC)) {
  console.error(`Specification not found at ${SPEC}. Refusing to generate an audit of nothing.`);
  process.exit(2);
}

const spec = readFileSync(SPEC, 'utf8');

/** Every `## N. Title` heading, in document order. The spec is the index. */
const sections = [];
for (const line of spec.split('\n')) {
  const m = /^##\s+(\d+)\.\s+(.+?)\s*$/.exec(line);
  if (m) sections.push({ number: Number(m[1]), title: m[2] });
}
if (sections.length === 0) {
  console.error('No numbered sections found. The heading format changed — fix this script rather than shipping an empty audit.');
  process.exit(2);
}

const assessments = existsSync(ASSESSMENTS)
  ? JSON.parse(readFileSync(ASSESSMENTS, 'utf8'))
  : {};

/** The §0.1 vocabulary, verbatim. Nothing else is a legal status. */
const LEGAL = new Set([
  'VERIFIED_COMPLETE',
  'IMPLEMENTED_NOT_VERIFIED',
  'PARTIAL',
  'NOT_STARTED',
  'BLOCKED',
  'NOT_APPLICABLE',
  'NOT_ASSESSED',
]);

const bad = Object.entries(assessments)
  .filter(([k]) => k !== '_comment')
  .filter(([, v]) => !LEGAL.has(v.status));
if (bad.length) {
  console.error('Illegal status value(s) — §0.1 defines the vocabulary:');
  for (const [k, v] of bad) console.error(`  §${k}: ${v.status}`);
  process.exit(2);
}

const rows = sections.map((s) => {
  const a = assessments[String(s.number)] ?? {};
  return {
    ...s,
    status: a.status ?? 'NOT_ASSESSED',
    evidence: a.evidence ?? '—',
    remaining: a.remaining ?? '—',
    depends_on: a.depends_on ?? '—',
    verify: a.verify ?? '—',
  };
});

const tally = {};
for (const r of rows) tally[r.status] = (tally[r.status] ?? 0) + 1;

const esc = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

const out = [];
const w = (s = '') => out.push(s);

w('# Current State Audit');
w('');
w('GENERATED FILE — `node scripts/execution/generate-current-state-audit.mjs`.');
w('Do not hand-edit. Edit `docs/execution/section-assessments.json` and regenerate.');
w('');
w('## Why this file is generated');
w('');
w('The §84 checklist tracked in `docs/exec/EXECUTION_STATUS.md` was transcribed by');
w('hand. It carried 60 of the specification’s 68 Definition-of-Done items, and the');
w('eight it omitted were invisible **because** they were omitted — nothing');
w('downstream can ask about a row that does not exist. One of them, "all 195');
w('baseline countries present exactly once", stayed invisible while three');
w('destinations were built on top of it.');
w('');
w('So the section list below is read out of the specification at generation time.');
w('A section cannot go missing from this audit. It can only be assessed, or');
w('printed as `NOT_ASSESSED` — which is a true statement about what we know,');
w('rather than a blank row that reads as nothing to worry about.');
w('');
w(`The specification currently has **${sections.length}** numbered sections.`);
w('');

w('## Status tally');
w('');
w('| Status | Sections |');
w('|---|---|');
for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1])) w(`| \`${k}\` | ${v} |`);
w(`| **Total** | **${rows.length}** |`);
w('');
if ((tally.NOT_ASSESSED ?? 0) > 0) {
  w(`> **${tally.NOT_ASSESSED} section(s) have not been assessed.** That is the honest`);
  w('> state of this reconciliation, not an oversight to be read past. §84 item 61');
  w('> stays `PARTIAL` until this number reaches zero.');
  w('');
}

w('## Vocabulary');
w('');
w('§0.1 defines exactly six statuses and the generator rejects anything else:');
w('`VERIFIED_COMPLETE`, `IMPLEMENTED_NOT_VERIFIED`, `PARTIAL`, `NOT_STARTED`,');
w('`BLOCKED`, `NOT_APPLICABLE`. `NOT_ASSESSED` is added here for sections nobody');
w('has looked at yet, because calling those `NOT_STARTED` would assert knowledge');
w('we do not have — the work may well be done.');
w('');
w('`NOT_APPLICABLE` requires a justification in the evidence column. §0.1 is');
w('explicit that it must never be used merely to reduce scope.');
w('');

w('## Every numbered section');
w('');
w('| § | Section | Status | Evidence | Remaining work | Depends on | Verification command |');
w('|---|---|---|---|---|---|---|');
for (const r of rows) {
  w(
    `| ${r.number} | ${esc(r.title)} | \`${r.status}\` | ${esc(r.evidence)} | ` +
      `${esc(r.remaining)} | ${esc(r.depends_on)} | ${esc(r.verify)} |`,
  );
}
w('');

writeFileSync(OUT, out.join('\n') + '\n');
console.log(`Wrote ${OUT} — ${rows.length} sections, ${tally.NOT_ASSESSED ?? 0} not assessed.`);
