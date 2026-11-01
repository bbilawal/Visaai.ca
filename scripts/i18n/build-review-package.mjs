import {
  readFileSync,
  readdirSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flattenMessages, toCsv, buildManifest } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MSG_DIR = join(ROOT, 'apps/web/messages');
const OUT_DIR = join(ROOT, 'docs/i18n/review');

const locales = readdirSync(MSG_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''))
  .sort(); // stable, platform-independent order (manifest locales array + perLocale keys)
const data = Object.fromEntries(
  locales.map((l) => [
    l,
    JSON.parse(readFileSync(join(MSG_DIR, `${l}.json`), 'utf8')),
  ]),
);

const rows = flattenMessages(data, locales);
const others = locales.filter((l) => l !== 'en');
const generatedAt = new Date().toISOString().slice(0, 10);

mkdirSync(OUT_DIR, { recursive: true });
for (const l of others) writeFileSync(join(OUT_DIR, `${l}.csv`), toCsv(rows, l));
writeFileSync(
  join(OUT_DIR, 'status-manifest.json'),
  JSON.stringify(buildManifest(rows, locales, generatedAt), null, 2) + '\n',
);
writeFileSync(join(OUT_DIR, 'README.md'), readme(rows, others, generatedAt));

console.log(
  `i18n review package: ${others.length} locale CSVs + manifest + README for ${rows.length} keys -> docs/i18n/review/`,
);

function readme(rows, others, generatedAt) {
  const identical = rows
    .filter((r) => r.identical)
    .map((r) => `\`${r.ns}.${r.key}\` = ${JSON.stringify(r.en)}`);
  return `# i18n Translation Review Package

_Generated ${generatedAt} by \`pnpm i18n:review\`. Do not hand-edit the CSVs or
the manifest's \`en\`/\`status\` source fields — regenerate. Reviewers DO edit the
\`status\` column / per-locale state (see Workflow)._

**${rows.length} keys × ${others.length} locales** exported from
\`apps/web/messages/*.json\` (en is the master).

## What's here
- \`<locale>.csv\` (${others.length} files): \`namespace, key, en, <locale>, status\`.
  Open in Sheets; a native reviewer reads \`en\` + the translation and sets
  \`status\` to \`approved\` or \`needs-fix\` (default \`pending\`).
- \`status-manifest.json\`: tracking source of truth — per-key \`status\`
  (\`mt\` | \`english_held_candidate\`) and per-locale review state, plus rollup
  counts. Update as review proceeds.

## Workflow
1. Send each \`<locale>.csv\` to a native speaker of that locale.
2. They flip \`status\` per row: \`approved\` (good) or \`needs-fix\` (+ a corrected
   value in the translation column).
3. Apply \`needs-fix\` corrections back into \`apps/web/messages/<locale>.json\`,
   then re-run \`pnpm i18n:review\` and reconcile the manifest counts.
4. **GA gate:** every locale's \`pending\` + \`needs-fix\` count is 0 in the manifest.

## English-held copy — needs professional LEGAL localization (NOT in the CSVs)
These are deliberately hardcoded English in components (HARD CONSTRAINT §4.1), so
they are NOT in \`messages/*.json\` and not auto-exported. Localize via a
professional legal translator, not MT:
- All pricing strings (e.g. \`$29\`).
- The prefill auto-fill fee explainer.
- The official-forms "verify every value before submitting" caveat.
- The 503 official-template fallback message.
(Identify exact occurrences by grepping the components; they were intentionally
left English pending legal review.)

## Additional MT surface — api email catalog (review alongside)
\`apps/api/src/i18n/email/messages.ts\` (the reminder email, 15 locales) is MT and
also needs native review. Keys: \`reminder.{subject, body, bodyWithCountry,
nextStepPrefix, resume, unsubscribe}\` and \`nextStep.{intake, documents, narrative,
readiness, prefill, submission}\`. Not in this CSV export (different source file).

## Flagged: identical across all locales (verify intentional)
${identical.length ? identical.map((s) => `- ${s}`).join('\n') : '- (none)'}

These render the same in every locale — usually an intentional brand/placeholder
string (e.g. an acronym + \`{placeholder}\`), but confirm none are accidental
untranslated drift.
`;
}
