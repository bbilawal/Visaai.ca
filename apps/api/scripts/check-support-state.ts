#!/usr/bin/env ts-node
/**
 * Does every country's `support_state` describe what the registry actually
 * holds for it?
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-26 Finland was found marked `supported` while publishing zero
 * pages. It held 5 visa types, 12 registered sources, 0 source versions and 0
 * requirements: not one Finnish page had ever been fetched from production
 * egress, because migri.fi WAF-challenges the VPS. The types and the URLs came
 * from research; the content never arrived.
 *
 * That is not a small mislabel. `supported` is defined in the core migration as
 * "VisaAI has verified data and serves this destination", and New Zealand was
 * deliberately held at `preview` for having only ONE extracted visa type — the
 * reasoning being that claiming more "would be the same unearned claim the
 * registry exists to prevent". Finland had none and carried the stronger claim.
 *
 * It survived several coverage reviews because every one of them counted
 * SUPPORTED COUNTRIES. A count reads as coverage, and one of the things being
 * counted was empty. Nothing in the schema forbade it, so nothing caught it.
 *
 * THE TWO INVARIANTS
 *
 *   supported  => publishes at least one page. Otherwise the label is a claim
 *                with nothing behind it, and the country inflates every
 *                coverage number it appears in.
 *
 *   preview    => has an authority AND at least one visa type. `preview` is
 *                justified in listPublishedCountries as "verified authorities,
 *                verified visa types and verified official source links, which
 *                is a genuinely useful hub page". A preview with neither is a
 *                hub page with nothing on it, which is the thin programmatic
 *                output rule 29 forbids — and is exactly what publishing the
 *                eighteen blocked countries would have produced.
 *
 * Run it after any promotion and in any coverage review, BEFORE quoting a
 * number of supported destinations.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/check-support-state.ts --docker <container>
 *   DATABASE_URL=... npx ts-node -P tsconfig.json scripts/check-support-state.ts
 */
import { execFileSync } from 'node:child_process';

const QUERY = `
select
  c.support_state,
  c.code,
  c.name,
  (select count(*) from public.visa_publishable_pages p where p.country_code = c.code) as pages,
  (select count(*) from public.visa_types t
    where t.country_id = c.id and t.lifecycle_state = 'active') as types,
  (c.immigration_authority is not null) as has_authority
from public.visa_countries c
where c.support_state <> 'unsupported'
order by c.support_state, c.code;
`;

function run(sql: string): string {
  const i = process.argv.indexOf('--docker');
  if (i > -1 && process.argv[i + 1]) {
    return execFileSync(
      'docker',
      ['exec', '-i', process.argv[i + 1], 'psql', '-U', 'postgres', '-d', 'postgres',
       '-t', '-A', '-F', '\t', '-c', sql],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Pass --docker <container> or set DATABASE_URL.');
  return execFileSync('psql', [url, '-t', '-A', '-F', '\t', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

interface Row {
  state: string; code: string; name: string;
  pages: number; types: number; hasAuthority: boolean;
}

const rows: Row[] = run(QUERY)
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [state, code, name, pages, types, auth] = line.split('\t');
    return {
      state, code, name,
      pages: Number(pages), types: Number(types),
      hasAuthority: auth === 't',
    };
  });

const supported = rows.filter((r) => r.state === 'supported');
const preview = rows.filter((r) => r.state === 'preview');

const emptySupported = supported.filter((r) => r.pages === 0);
const emptyPreview = preview.filter((r) => !r.hasAuthority || r.types === 0);

console.log(`supported: ${supported.length}   preview: ${preview.length}`);
console.log(
  `pages published: ${rows.reduce((n, r) => n + r.pages, 0)} across ${
    rows.filter((r) => r.pages > 0).length
  } countries`,
);

for (const r of rows) {
  console.log(
    `  ${r.state.padEnd(9)} ${r.code}  ${String(r.pages).padStart(3)} pages  ` +
      `${String(r.types).padStart(3)} types  ${r.hasAuthority ? 'authority' : 'NO AUTHORITY'}  ${r.name}`,
  );
}

let failed = false;

if (emptySupported.length > 0) {
  failed = true;
  console.error(
    `\n${emptySupported.length} country/countries claim supported while publishing NOTHING:`,
  );
  for (const r of emptySupported) console.error(`  ${r.code} ${r.name} — ${r.types} types, 0 pages`);
  console.error(
    '\nEither publish a page or move it to preview. A supported destination that\n' +
      'publishes nothing inflates every coverage number it appears in.',
  );
}

if (emptyPreview.length > 0) {
  failed = true;
  console.error(`\n${emptyPreview.length} preview country/countries have nothing to preview:`);
  for (const r of emptyPreview) {
    console.error(
      `  ${r.code} ${r.name} — ${r.hasAuthority ? 'authority ok' : 'NO authority'}, ${r.types} types`,
    );
  }
  console.error(
    '\nA preview hub is justified by a real authority and real visa types. Without\n' +
      'them it is an empty page asserting coverage that does not exist.',
  );
}

if (failed) process.exit(1);
console.log('\nEvery support_state describes what the registry actually holds.');
