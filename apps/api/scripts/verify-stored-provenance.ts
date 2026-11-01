#!/usr/bin/env ts-node
/**
 * Does every published requirement appear in the STORED text of the version it
 * is bound to?
 *
 * WHY THIS IS A DIFFERENT QUESTION
 *
 * `verify-excerpts.ts` re-fetches the LIVE page and checks the quote is on it.
 * `verify-quotes-against-raw.ts` does the same against raw HTML. Both ask about
 * the page as it is today. Neither asks about the SNAPSHOT.
 *
 * `visa_requirements.source_version_id` is NOT NULL precisely so a reviewer can
 * open the exact version a claim was read from and find the sentence there. If
 * the excerpt is not in that snapshot, the claim may still be true — and the
 * audit trail is broken, because the thing it points at does not support it.
 * That can happen without anyone noticing: an extractor bump re-normalises
 * pages, a requirement is attached to a version filed earlier, or a page moves
 * between filing and extraction.
 *
 * WHAT COUNTS AS FOUND, AND WHY IT IS NOT A RAW SUBSTRING MATCH
 *
 * The first version of this check compared with a plain substring and reported
 * 59 failures across 21 routes — every one of them on the oldest extractor,
 * which made a tidy and completely wrong story about extractor drift. They were
 * line breaks. `normalize.ts` keeps newlines because list structure is signal,
 * and `flat()` exists so a quote spanning one is still a match: "compare the
 * way a reader would". Comparing any other way measures the formatting, not the
 * claim. Flattened, all 780 auditable requirements pass.
 *
 * A version whose `normalized_text` is NULL is reported SEPARATELY and is not a
 * failure. That is B-29's legacy — text was only retained per version from that
 * fix onward — and `backfill-version-text.ts` deliberately refuses to invent it
 * where the hash cannot prove the content is unchanged. An unauditable snapshot
 * is a known gap; a snapshot that contradicts its own requirement is a defect.
 *
 * Usage:
 *   npx ts-node -P tsconfig.json scripts/verify-stored-provenance.ts --docker <container>
 *   DATABASE_URL=... npx ts-node -P tsconfig.json scripts/verify-stored-provenance.ts
 */
import { execFileSync } from 'child_process';

const args = process.argv.slice(2);
const dockerIdx = args.indexOf('--docker');
const container = dockerIdx >= 0 ? args[dockerIdx + 1] : null;

/**
 * Flattening happens in SQL so the comparison runs where the text lives — the
 * corpus is tens of megabytes and shipping it to Node to compare strings would
 * make a fast check slow for no gain.
 */
const QUERY = `
with f as (
  select t.visaai_id, r.requirement_code,
         regexp_replace(r.source_excerpt, '\\s+', ' ', 'g') as ex,
         regexp_replace(v.normalized_text, '\\s+', ' ', 'g') as txt
    from visa_requirements r
    join visa_types t on t.id = r.visa_type_id
    join visa_source_versions v on v.id = r.source_version_id
   where r.status = 'active'
     and r.source_excerpt is not null
     and v.normalized_text is not null
),
checked as (
  select visaai_id, requirement_code, ex,
         case when ex like '% ... %' then (
                select bool_and(position(btrim(frag) in txt) > 0)
                  from unnest(string_to_array(ex, ' ... ')) as frag)
              else position(ex in txt) > 0
         end as found
    from f
)
select
  (select count(*) from visa_requirements where status='active' and source_excerpt is not null) as active_total,
  (select count(*) from checked) as auditable,
  (select count(*) from checked where found) as ok,
  (select count(*) from checked where found is false) as broken,
  coalesce((select string_agg(visaai_id || ' / ' || requirement_code, E'\\n  ')
              from checked where found is false), '') as detail;
`;

function run(sql: string): string {
  if (container) {
    return execFileSync(
      'docker',
      ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-F', '\t', '-c', sql],
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

const raw = run(QUERY).trim();
const [activeTotal, auditable, ok, broken, ...rest] = raw.split('\t');
const detail = rest.join('\t').trim();

const unauditable = Number(activeTotal) - Number(auditable);

console.log(`Published requirements with an excerpt:      ${activeTotal}`);
console.log(`  auditable (bound version retains text):    ${auditable}`);
console.log(`    excerpt present in that snapshot:        ${ok}`);
console.log(`    excerpt ABSENT from that snapshot:       ${broken}`);
console.log(`  NOT auditable (snapshot retains no text):  ${unauditable}`);

if (unauditable > 0) {
  console.log(
    `\n${unauditable} requirement(s) are bound to a version filed before per-version text\n` +
      'was retained (B-29). That is a KNOWN GAP, not a defect: backfill-version-text.ts\n' +
      'fills a snapshot only where the stored hash proves the content is unchanged, and\n' +
      'refuses to invent the rest. State the denominator rather than the failure count.',
  );
}

if (Number(broken) > 0) {
  console.error(`\n${broken} requirement(s) are not supported by the snapshot they cite:\n  ${detail}`);
  console.error(
    '\nThe claim may still be true of the live page — verify-excerpts.ts answers that.\n' +
      'What is broken is the audit trail: the version this cites does not contain it.',
  );
  process.exit(1);
}

console.log('\nEvery auditable requirement is present in the version it cites.');
