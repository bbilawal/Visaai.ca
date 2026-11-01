#!/usr/bin/env node
/**
 * DEBT-001 ratchet.
 *
 * apps/api carried 1,865 lint errors. At that scale lint has no signal: a
 * genuine new error is one of thousands and nobody sees it — which is how a
 * broken money-path e2e (TEST-011) sat unnoticed in the suite CI runs to gate
 * payments.
 *
 * Fixing all of them at once is a multi-day campaign. This is the alternative
 * that works today: the count may go DOWN freely, and CI fails the moment it
 * goes UP. New code is held to zero without blocking on old code.
 *
 * Deliberately NOT `--max-warnings 0` with a pile of eslint-disable comments —
 * that hides the debt instead of bounding it.
 *
 * Usage:
 *   npx eslint "{src,apps,libs,test}/**\/*.ts" -f json | node scripts/lint-ratchet.mjs
 *   ... | node scripts/lint-ratchet.mjs --write   # lower the baseline
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Resolved from THIS FILE, not the cwd. The natural way to run eslint is from
// apps/api (that is where the config lives), and a cwd-relative path then looks
// for apps/api/apps/api/.lint-baseline.json.
const BASELINE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'apps/api/.lint-baseline.json',
);
const write = process.argv.includes('--write');

const raw = readFileSync(0, 'utf8');
let results;
try {
  results = JSON.parse(raw);
} catch {
  console.error('lint-ratchet: could not parse eslint JSON from stdin');
  process.exit(1);
}

const errors = results.reduce((n, f) => n + f.errorCount, 0);
const warnings = results.reduce((n, f) => n + f.warningCount, 0);

if (!existsSync(BASELINE)) {
  console.error(`lint-ratchet: no baseline at ${BASELINE}; run with --write first`);
  process.exit(1);
}
const base = JSON.parse(readFileSync(BASELINE, 'utf8'));

if (write) {
  writeFileSync(BASELINE, JSON.stringify({ ...base, errors, warnings }, null, 1) + '\n');
  console.log(`lint-ratchet: baseline set to ${errors} errors, ${warnings} warnings`);
  process.exit(0);
}

console.log(`lint-ratchet: ${errors} errors (baseline ${base.errors})`);

if (errors > base.errors) {
  console.error(
    `::error::lint errors rose from ${base.errors} to ${errors}. ` +
      `Fix the new ones — do not raise the baseline.`,
  );
  process.exit(1);
}
if (errors < base.errors) {
  console.log(
    `lint-ratchet: down ${base.errors - errors}. Lower the baseline with ` +
      `\`--write\` so the gain is locked in.`,
  );
}
process.exit(0);
