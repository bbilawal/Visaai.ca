#!/usr/bin/env ts-node
/**
 * Fail when two extractions of one destination store the same figure under
 * conflicting temporal qualifiers.
 *
 * THE GAP THIS CLOSES
 *
 * `verify-excerpts.ts` proves a quote is on its page. `verify-extraction-bounds.ts`
 * proves it came from the right section. Both operate on ONE file, so neither can
 * see a contradiction that exists only BETWEEN files.
 *
 * Migrationsverket publishes the same six maintenance amounts on two pages, dated
 * 2025 on one and 2026 on the other. Both extractions are individually correct and
 * every excerpt verifies. It was caught only because I read the sentence that
 * introduced the figures rather than the figures alone - which is luck, not a
 * control.
 *
 * ALLOWLIST, NOT SUPPRESSION
 *
 * Known conflicts live in data/KNOWN_FIGURE_CONFLICTS.json with a
 * reason and a date. A reviewed conflict stays visible in the output and does not
 * fail the run; an unreviewed one fails it. That way the Swedish disagreement
 * stays on the record - it is a real fact about the authority's site, not a bug
 * in our data to be cleaned away - while anything new demands a decision.
 *
 * If a conflict in the allowlist has DISAPPEARED, that is reported too: the
 * authority probably fixed its page, and the allowlist entry should go with it.
 *
 * Usage: ts-node scripts/detect-figure-conflicts.ts
 */
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import {
  findFigureConflicts,
  conflictKey,
  type ExtractionFile,
} from '../src/modules/visa-sync/figure-conflicts';

const DIR = join(__dirname, '../../../data/requirements');
// Deliberately OUTSIDE data/requirements: a non-extraction file sitting in
// that directory gets picked up by every loader that globs *.json, which is
// exactly what happened on the first attempt.
const ALLOWLIST = join(DIR, '../KNOWN_FIGURE_CONFLICTS.json');

interface Allowed {
  key: string;
  reason: string;
  reviewed: string;
}

function load(): ExtractionFile[] {
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const doc = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
      return { file: f, visaai_id: doc.visaai_id, requirements: doc.requirements ?? [] };
    })
    // Anything without a visaai_id is not an extraction. Belt and braces after
    // moving the allowlist out of this directory.
    .filter((d) => typeof d.visaai_id === 'string');
}

function main(): void {
  const files = load();
  if (files.length === 0) {
    console.error('No extraction files found - check the path.');
    process.exit(2);
  }

  const allowed: Allowed[] = existsSync(ALLOWLIST)
    ? (JSON.parse(readFileSync(ALLOWLIST, 'utf8')).conflicts ?? [])
    : [];
  const allowedByKey = new Map(allowed.map((a) => [a.key, a]));

  const conflicts = findFigureConflicts(files);
  const seenKeys = new Set(conflicts.map(conflictKey));

  const fresh = conflicts.filter((c) => !allowedByKey.has(conflictKey(c)));
  const known = conflicts.filter((c) => allowedByKey.has(conflictKey(c)));

  console.log(`Checked ${files.length} extraction files.`);

  if (known.length > 0) {
    console.log(`\n${known.length} known conflict(s), previously reviewed:`);
    for (const c of known) {
      const a = allowedByKey.get(conflictKey(c))!;
      console.log(`  ${conflictKey(c)}  (reviewed ${a.reviewed}) - ${a.reason}`);
    }
  }

  // An allowlist entry with no matching conflict is stale. Usually good news:
  // the authority corrected the page. Reported so the entry gets removed rather
  // than silently masking a future conflict on the same figure.
  const stale = allowed.filter((a) => !seenKeys.has(a.key));
  if (stale.length > 0) {
    console.log(`\n${stale.length} allowlist entr(ies) no longer match any conflict:`);
    for (const a of stale) console.log(`  ${a.key} - remove it, or re-check the source`);
  }

  if (fresh.length === 0) {
    console.log('\nNo unreviewed figure conflicts.');
    process.exit(stale.length > 0 ? 1 : 0);
  }

  console.error(`\n${fresh.length} UNREVIEWED figure conflict(s):`);
  for (const c of fresh) {
    console.error(`\n  ${conflictKey(c)}  value ${c.value} under ${c.parameterKey}`);
    for (const s of c.sides) {
      console.error(`    ${s.file}  ${s.requirement_code}  ${s.qualifier}=${s.qualifierValue}`);
    }
  }
  console.error(
    '\nOne of these sources is stale, or the figures mean different things.' +
      '\nRe-read the sentence that INTRODUCES each figure on its page - that is' +
      '\nwhere the year, scope and conditions live - then fix the extraction or' +
      '\nadd an entry to KNOWN_FIGURE_CONFLICTS.json explaining the disagreement.',
  );
  process.exit(1);
}

main();
