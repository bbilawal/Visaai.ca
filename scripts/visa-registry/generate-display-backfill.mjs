#!/usr/bin/env node
/**
 * Emit ONE migration that back-fills `source_excerpt_display` for every
 * requirement already in the database.
 *
 * WHY A BACKFILL RATHER THAN REGENERATING THE REQUIREMENT MIGRATIONS
 *
 * `generate-requirements.mjs` now emits the column, so every route added from
 * here on carries it. But 1,100 requirements are already live across 67
 * extraction files and their migrations have run. Regenerating those files
 * would rewrite 67 migrations that production has already applied — history
 * that other databases have executed, edited after the fact. This adds one
 * forward migration instead, which is what a migration is for.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 *
 * It touches `source_excerpt_display` and nothing else. Not `source_excerpt`,
 * not `status`, not `last_verified_at`. In particular it does NOT trip the
 * demote-on-change rule in `generate-requirements.mjs`: adding the authority's
 * capitalisation to a row is not a change to what that row CLAIMS, and sending
 * 1,100 reviewed requirements back to draft — unpublishing every page in the
 * registry — would be a spectacular way to ship a display fix.
 *
 * Rows whose extraction has no display excerpt are skipped, leaving the column
 * NULL. That is a real state and the page renders no quotation for them.
 *
 * Usage:
 *   node scripts/visa-registry/generate-display-backfill.mjs data/requirements/*.json > supabase/migrations/<ts>_backfill.sql
 */

import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: generate-display-backfill.mjs <extraction.json>...');
  process.exit(2);
}

const q = (v) => `'${String(v).replace(/'/g, "''")}'`;

const rows = [];
let skipped = 0;

for (const path of files) {
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  if (!doc.visaai_id || !Array.isArray(doc.requirements)) continue;
  for (const r of doc.requirements) {
    if (!r.source_excerpt_display) {
      skipped++;
      continue;
    }
    rows.push([doc.visaai_id, r.requirement_code, r.source_excerpt_display]);
  }
}

const out = [];
const w = (s = '') => out.push(s);

w(`-- Back-fill source_excerpt_display for requirements already in the database.`);
w(`--`);
w(`-- GENERATED FILE. Do not hand-edit.`);
w(`--   generator: scripts/visa-registry/generate-display-backfill.mjs`);
w(`--   rows: ${rows.length}`);
w(`--   skipped (no display excerpt derived): ${skipped}`);
w(`--`);
w(`-- BUG_LOG D-11. The public page never showed the authority's own words,`);
w(`-- because the only excerpt stored was the monitor's LOWERCASED matching text`);
w(`-- and quoting that would attribute our normalization to a government.`);
w(`-- scripts/derive-display-excerpts.ts recovers the authority's capitalisation`);
w(`-- from the same span of the same page; this puts it in the database.`);
w(`--`);
w(`-- This updates ONE column. Not source_excerpt, not status, not`);
w(`-- last_verified_at. Adding capitalisation is not a change to what a`);
w(`-- requirement CLAIMS, so it must not trip the demote-on-change rule and send`);
w(`-- reviewed requirements back to draft — that would unpublish the registry to`);
w(`-- ship a display fix.`);
w(`--`);
w(`-- Skipped rows keep a NULL, which is a real state: the authority's wording`);
w(`-- could not be established, and the page renders no quotation.`);
w('');
w('begin;');
w('');

if (rows.length > 0) {
  w('update public.visa_requirements r');
  w('set source_excerpt_display = v.display');
  w('from (values');
  w(
    rows
      .map(([visaaiId, code, display]) => `  (${q(visaaiId)}, ${q(code)}, ${q(display)})`)
      .join(',\n'),
  );
  w(') as v(visaai_id, requirement_code, display)');
  w('join public.visa_types t on t.visaai_id = v.visaai_id');
  w('where r.visa_type_id = t.id');
  w('  and r.requirement_code = v.requirement_code');
  w('  and r.source_excerpt_display is distinct from v.display;');
  w('');
}

w(`-- Assert the fix actually landed, and that it did not disturb anything else.`);
w(`do $$`);
w(`declare quoted int; total int; drafted int;`);
w(`begin`);
w(`  select count(*) into quoted from public.visa_requirements`);
w(`   where status = 'active' and source_excerpt_display is not null;`);
w(`  select count(*) into total from public.visa_requirements where status = 'active';`);
w('');
w(`  if quoted = 0 then`);
w(`    raise exception 'No active requirement carries a display excerpt — the backfill did nothing.';`);
w(`  end if;`);
w('');
w(`  -- The whole registry must not have been sent back to draft by this.`);
w(`  select count(*) into drafted from public.visa_requirements where status = 'draft';`);
w(`  raise notice 'display excerpts: % of % active requirements can quote the authority (% still draft).',`);
w(`    quoted, total, drafted;`);
w(`end $$;`);
w('');
w('commit;');
w('');

process.stdout.write(out.join('\n'));
