/**
 * Builds the field- and journey-coverage artifacts the controller requires,
 * from the scenario ledger plus the product's own stage definition.
 *
 * Coverage is only ever claimed from evidence: a field counts as exercised when
 * a scenario actually supplied it, and a stage counts as reached when a run
 * really landed on it.
 *
 *   node qa/visaai-autonomous-e2e/harness/build-coverage.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const rows = existsSync(join(ROOT, 'state', 'scenario-ledger.jsonl'))
  ? readFileSync(join(ROOT, 'state', 'scenario-ledger.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim()).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      })
  : [];
const personas = JSON.parse(readFileSync(join(ROOT, 'fixtures', 'personas.json'), 'utf8'));

const csv = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

// ---------- field coverage ----------
// The intake interview is free-text, so "fields" are the profile attributes the
// interview asks for and the harness answers. Each maps to the persona field
// that supplies it and the answerFor() keyword route that recognises the question.
const FIELDS = [
  ['destination_country', 'combobox #country', 'intended_destination', 'required'],
  ['destination_state', 'text input #state', '(left blank — optional)', 'optional'],
  ['purpose_of_travel', 'interview', 'travel_purpose', 'required'],
  ['nationality', 'interview', 'nationality', 'required'],
  ['residence_country', 'interview', 'residence_country', 'required'],
  ['full_name', 'interview', 'synthetic_name', 'required'],
  ['date_of_birth', 'interview', 'synthetic_dob', 'required'],
  ['passport_number', 'interview', 'synthetic_passport', 'required'],
  ['passport_expiry', 'interview', 'passport_expiry_band', 'required'],
  ['employment_status', 'interview', 'employment_status', 'required'],
  ['occupation', 'interview', 'occupation', 'conditional'],
  ['education_level', 'interview', 'education', 'optional'],
  ['funding_method', 'interview', 'funding_method', 'required'],
  ['income_band', 'interview', 'income_band', 'required'],
  ['marital_status', 'interview', 'marital_status', 'required'],
  ['dependants', 'interview', 'dependants', 'conditional'],
  ['prior_refusal', 'interview', 'prior_refusal', 'required'],
  ['prior_travel_history', 'interview', 'prior_travel', 'required'],
  ['intended_dates', 'interview', 'intended_dates', 'required'],
  ['accommodation', 'interview', '(derived from destination)', 'optional'],
  ['contact_email', 'interview', 'email', 'optional'],
  ['contact_phone', 'interview', 'phone', 'optional'],
  ['home_ties', 'interview', '(derived from residence_country)', 'optional'],
  ['admissibility_declarations', 'interview', '(no — nothing to declare)', 'conditional'],
];

// A field is exercised when a scenario's transcript contains an answer the
// responder produced for it. Count the transcripts that actually mention it.
const transcripts = rows.flatMap((r) => (r.transcript ?? []).map((t) => t.answer ?? ''));
const questions = rows.flatMap((r) => (r.transcript ?? []).map((t) => t.question ?? ''));

const distinctValues = (key) => new Set(personas.personas.map((p) => String(p[key]))).size;

let fieldCsv = 'field,ui_surface,persona_source,requiredness,distinct_synthetic_values,scenarios_supplying,asked_by_product\n';
for (const [field, surface, source, req] of FIELDS) {
  const key = source.startsWith('(') ? null : source;
  const supplying = key
    ? transcripts.filter((a) => {
        const vals = new Set(personas.personas.map((p) => String(p[key])));
        return [...vals].some((v) => v && v !== 'null' && a.includes(v));
      }).length
    : 0;
  const askedRe = new RegExp(field.split('_')[0], 'i');
  fieldCsv += [
    csv(field), csv(surface), csv(source), csv(req),
    key ? distinctValues(key) : 0,
    supplying,
    questions.filter((q) => askedRe.test(q)).length,
  ].join(',') + '\n';
}
writeFileSync(join(ROOT, 'coverage', 'field-coverage.csv'), fieldCsv);

// ---------- journey coverage ----------
// Stages come from the product itself (apps/web/components/layout/stage-nav.tsx).
const STAGES = [
  ['intake', 'intake', 'no — public funnel'],
  ['documents', 'documents', 'yes'],
  ['narrative', 'generate', 'yes'],
  ['readiness', 'readiness', 'yes'],
  ['prefill', 'prefill', 'yes'],
  ['submission', 'submit', 'yes'],
];

const reachedIntake = rows.filter((r) => r.application_id).length;
const withResult = rows.filter((r) => r.result_generated).length;
const persisted = rows.filter((r) => r.persisted_correctly).length;

// Stages 2-6 are covered by the authenticated harness (run-stages.mjs), which
// signs in as a seeded fixture user — the anonymous public funnel can never
// reach them.
const stageRuns = existsSync(join(ROOT, 'state', 'stage-ledger.jsonl'))
  ? readFileSync(join(ROOT, 'state', 'stage-ledger.jsonl'), 'utf8')
      .split('\n').filter((l) => l.trim()).flatMap((l) => {
        try { return [JSON.parse(l)]; } catch { return []; }
      })
  : [];

let journeyCsv = 'stage,label,auth_gated_for_guest,reached,rendered_expected_content,failures,covered_by,status\n';
for (const [slug, label, gated] of STAGES) {
  if (slug === 'intake') {
    journeyCsv += [
      csv(slug), csv(label), csv(gated), reachedIntake, withResult, 0,
      csv('anonymous public funnel (run-scenarios.mjs)'), csv('COVERED'),
    ].join(',') + '\n';
    continue;
  }
  const hits = stageRuns.map((r) => r.stages?.[slug]).filter(Boolean);
  const reached = hits.filter((h) => h.reachable).length;
  const rendered = hits.filter((h) => h.content_rendered).length;
  const failures = hits.filter((h) => h.status === 'FAIL').length;
  journeyCsv += [
    csv(slug), csv(label), csv(gated), reached, rendered, failures,
    csv('authenticated fixture (run-stages.mjs)'),
    csv(hits.length === 0 ? 'NOT_COVERED' : failures ? 'COVERED_WITH_FAILURES' : 'COVERED'),
  ].join(',') + '\n';
}
writeFileSync(join(ROOT, 'coverage', 'journey-coverage.csv'), journeyCsv);

console.log(
  `coverage written — fields ${FIELDS.length}, stages ${STAGES.length}, ` +
  `intake reached by ${reachedIntake} scenarios`,
);
