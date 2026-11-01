/**
 * Stricter second pass over the payloads the matrix run already saved — no LLM
 * calls, no API, just the recorded output.
 *
 * WHY IT EXISTS: the in-run grounding check accepted a value if ANY supplied
 * value was a substring of it, and the supplied set contains one- and two-letter
 * values (sex "F", a currency, a country code). "F" is a substring of almost
 * every sentence, so short ground-truth tokens made the check nearly
 * unfalsifiable. This pass ignores ground-truth tokens shorter than 4 characters
 * and re-reports, so the "no hallucinations" claim rests on a check that can
 * actually fail.
 *
 *   node qa/prefill-matrix/reaudit-grounding.mjs
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAYLOADS = join(HERE, 'results', 'payloads');
const matrix = JSON.parse(readFileSync(join(HERE, 'matrix.json'), 'utf8'));

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const digits = (s) => String(s).replace(/\D+/g, '');

const ACCOUNT = ['QA', 'Matrix', '+3670000000', '1 Test Way', 'Testville', 'Central', '10000', 'HU'];
const GENERIC = new Set([
  'yes', 'no', 'na', 'notapplicable', 'none', 'nil', 'unknown', 'male', 'female', 'other',
  'single', 'married', 'divorced', 'widowed', 'separated', 'f', 'm', 'eur', 'usd', 'gbp', 'cad', 'aud', 'jod',
  'tourism', 'business', 'study', 'work', 'visit', 'family', 'temporaryresidentvisa', 'visitorvisa',
  'selfemployed', 'employed', 'employee', 'student', 'passport', 'ordinary', 'ordinarypassport',
  'english', 'french', 'true', 'false', 'applicant', 'principalapplicant', 'primary', 'tourist',
  'businessvisa', 'touristvisa', 'studentvisa', 'workpermit', 'familysponsorship', 'studypermit',
]);

const findings = [];
let fieldsChecked = 0;
let filesChecked = 0;

for (const file of readdirSync(PAYLOADS).filter((f) => f.endsWith('.json'))) {
  const { persona, payload } = JSON.parse(readFileSync(join(PAYLOADS, file), 'utf8'));
  if (!payload) continue;
  filesChecked++;
  const [countryCode] = file.replace(/\.json$/, '').split('-');
  const pair = matrix.pairs.find((p) => `${p.countryCode}-${p.programId}.json` === file);

  // Everything the applicant actually supplied. Values shorter than 4 chars are
  // dropped: they match by accident, not by provenance.
  const truth = [...Object.values(persona), ...ACCOUNT, pair?.countryName, pair?.countryCode, pair?.label,
    'Hotel Central', 'Banque', 'EUR', '2026-05-01 to 2026-07-31', '2019-03-04', 'MSc Renewable Energy']
    .filter((v) => v != null)
    .map(norm)
    .filter((v) => v.length >= 4);

  for (const f of payload.fields ?? []) {
    const value = String(f.value ?? '').trim();
    if (!value || f.source === 'inferred') continue;
    fieldsChecked++;
    const n = norm(value);
    if (!n || GENERIC.has(n) || n.length < 4) continue;
    const d = digits(value);
    const grounded =
      truth.some((g) => g.includes(n) || n.includes(g)) ||
      (d.length >= 4 && truth.some((g) => digits(g).length >= 4 && (digits(g).includes(d) || d.includes(digits(g)))));
    if (!grounded) {
      findings.push({ scenario: file.replace(/\.json$/, ''), country: countryCode, key: f.key, label: f.label, value, source: f.source });
    }
  }
}

const byValue = {};
for (const f of findings) byValue[`${f.key}=${f.value}`] = (byValue[`${f.key}=${f.value}`] ?? 0) + 1;

writeFileSync(join(HERE, 'results', 'grounding-reaudit.json'), JSON.stringify({
  scenarios: filesChecked, fields_checked: fieldsChecked, ungrounded: findings.length, findings,
}, null, 2) + '\n');

console.log(`re-audited ${filesChecked} payloads / ${fieldsChecked} filled fields (strict: ground-truth tokens >= 4 chars)`);
console.log(`ungrounded values: ${findings.length}`);
for (const [k, n] of Object.entries(byValue).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${n}×  ${k}`);
