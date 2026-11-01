#!/usr/bin/env node
/**
 * Generate the seven global catalog artifacts §5.1 asks for, from the database.
 *
 * WHY THESE ARE GENERATED AND NOT WRITTEN
 *
 * §5.1: "The JSON/CSV exports must be generated from the source-of-truth
 * database/configuration, not maintained as contradictory hand-edited copies."
 *
 * That is the whole design. A hand-maintained catalog drifts from the registry
 * the first time anybody adds a route and forgets a file, and the drift is
 * invisible — two documents that disagree both look authoritative. These are
 * derived, so they cannot disagree with the database; they can only be stale,
 * and re-running fixes stale.
 *
 * WHAT IT WRITES (§5.1's list, at this repo's conventions)
 *
 *   docs/visa-data/GLOBAL_COUNTRY_SCOPE.md
 *   docs/visa-data/GLOBAL_VISA_CATALOG.md
 *   docs/visa-data/GLOBAL_COVERAGE_EXCEPTIONS.md
 *   artifacts/visa-data/global-country-registry.json
 *   artifacts/visa-data/global-visa-catalog.json
 *   artifacts/visa-data/global-visa-catalog.csv
 *   artifacts/visa-data/global-official-source-ledger.csv
 *
 * WHAT THE EXCEPTIONS FILE IS, AND IS NOT
 *
 * §84 asks that every baseline country be "researched, or named in the
 * evidence-backed exception ledger". Those are two different things and this
 * file keeps them apart:
 *
 *   * BLOCKED — a route whose authority refuses to be read. Every one carries
 *     evidence: the failure count the monitor recorded, and the robots state.
 *     These are genuine evidence-backed exceptions.
 *
 *   * NOT YET RESEARCHED — a country in the canonical baseline that nobody has
 *     looked at. "Not yet researched" is a STATUS, not evidence, and listing
 *     183 of them does not turn absence of work into a documented exception.
 *
 * The file says which is which, and the §84 row for that item stays NOT DONE
 * until the second list carries real per-country reasons. A ledger that blurred
 * the two would let 183 unexamined countries read as 183 considered decisions.
 *
 * Usage:
 *   node scripts/visa-registry/generate-global-catalog.mjs --docker supabase_db_VisaAI
 *   DATABASE_URL=... node scripts/visa-registry/generate-global-catalog.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const dockerIdx = args.indexOf('--docker');
const container = dockerIdx >= 0 ? args[dockerIdx + 1] : null;

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');

function query(sql) {
  const argv = container
    ? ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '--csv', '-c', sql]
    : null;
  if (argv) {
    return execFileSync('docker', argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL, or pass --docker <container>. Refusing to guess a connection.');
    process.exit(2);
  }
  return execFileSync('psql', [url, '--csv', '-c', sql], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** Minimal CSV parse: psql --csv quotes fields containing commas or quotes. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift() ?? [];
  return rows
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const COUNTRY_SQL = `
select c.code, c.name, c.slug, c.support_state, c.data_quality,
       coalesce(c.immigration_authority, '')     as immigration_authority,
       coalesce(c.immigration_authority_url, '') as immigration_authority_url,
       coalesce(c.foreign_affairs_authority, '') as foreign_affairs_authority,
       coalesce(c.official_visa_url, '')         as official_visa_url,
       coalesce(c.evisa_portal_url, '')          as evisa_portal_url,
       coalesce(array_to_string(c.official_languages, ' '), '') as official_languages,
       coalesce(c.fee_currency, '')              as fee_currency,
       coalesce(c.last_verified_at::date::text, '') as last_verified_at,
       coalesce(c.jurisdiction_note, '')         as jurisdiction_note,
       (select count(*) from visa_types t where t.country_id = c.id) as visa_types
from visa_countries c
order by c.name`;

const CATALOG_SQL = `
select c.code as country_code, c.name as country, t.visaai_id, t.slug as visa_slug,
       t.official_name, coalesce(t.official_code,'') as official_code, t.category,
       t.lifecycle_state, t.data_quality,
       coalesce(t.last_verified_at::date::text,'') as last_verified_at,
       (select count(*) from visa_requirements r
         where r.visa_type_id = t.id and r.status = 'active')            as active_requirements,
       (select count(*) from visa_requirements r
         where r.visa_type_id = t.id and r.status = 'active'
           and r.source_excerpt_display is not null)                     as quotable_requirements,
       (select count(*) from visa_sources s where s.visa_type_id = t.id and s.active) as active_sources
from visa_types t
join visa_countries c on c.id = t.country_id
order by c.name, t.official_name`;

const SOURCE_SQL = `
select c.code as country_code, coalesce(t.visaai_id,'') as visaai_id,
       s.role, s.authority, s.authority_rank, s.source_url, s.language,
       s.robots_state, s.active, s.failure_streak,
       coalesce(s.last_success_at::date::text,'') as last_success_at,
       (select count(*) from visa_source_versions v where v.source_id = s.id) as versions
from visa_sources s
join visa_countries c on c.id = s.country_id
left join visa_types t on t.id = s.visa_type_id
order by c.code, s.source_url`;

const countries = parseCsv(query(COUNTRY_SQL));
const catalog = parseCsv(query(CATALOG_SQL));
const sources = parseCsv(query(SOURCE_SQL));

if (countries.length === 0) {
  console.error('The registry returned no countries. Refusing to write empty artifacts.');
  process.exit(1);
}

const n = (v) => Number(v || 0);
const researched = countries.filter((c) => n(c.visa_types) > 0);
const unresearched = countries.filter((c) => n(c.visa_types) === 0);

/** A route nobody can read: every one of its sources is blocked or failing. */
const blocked = catalog.filter((t) => {
  const own = sources.filter((s) => s.visaai_id === t.visaai_id);
  return (
    n(t.active_requirements) === 0 &&
    own.length > 0 &&
    own.every((s) => s.robots_state === 'disallowed' || n(s.failure_streak) >= 3)
  );
});
const pending = catalog.filter(
  (t) => n(t.active_requirements) === 0 && !blocked.includes(t),
);

const GENERATED = (name) =>
  [
    `<!-- GENERATED FILE — do not hand-edit.`,
    `     generator: scripts/visa-registry/generate-global-catalog.mjs`,
    `     §5.1 requires these to be produced FROM the registry, never maintained`,
    `     beside it: two documents that disagree both look authoritative. -->`,
    ``,
    `# ${name}`,
    ``,
  ].join('\n');

const csv = (rows, cols) =>
  [cols.join(',')]
    .concat(
      rows.map((r) =>
        cols
          .map((c) => {
            const v = String(r[c] ?? '');
            return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
          })
          .join(','),
      ),
    )
    .join('\n') + '\n';

const write = (rel, body) => {
  const path = join(REPO, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, 'utf8');
  console.log(`wrote ${rel}`);
};

// ---------------------------------------------------------------- country scope
{
  const out = [GENERATED('Global country scope')];
  out.push(
    `The registry holds **${countries.length}** countries: the spec's §4.1 baseline of 195`,
    `(193 UN member states, the Holy See and the State of Palestine) plus any separately`,
    `administered visa jurisdiction admitted in its own right.`,
    ``,
    `- Researched, with at least one visa type: **${researched.length}**`,
    `- In the canonical registry, not yet researched: **${unresearched.length}**`,
    ``,
    `A country with no visa types carries a name, an ISO code and a slug and nothing`,
    `else. It has no authority and no official URL because nobody has looked yet —`,
    `not because none exists — and \`support_state = 'unsupported'\` keeps it off the`,
    `public site entirely.`,
    ``,
    `## Researched`,
    ``,
    `| Code | Country | Support | Authority | Visa types | Currency | Last verified |`,
    `|---|---|---|---|---|---|---|`,
  );
  for (const c of researched) {
    out.push(
      `| ${c.code} | ${c.name} | ${c.support_state} | ${c.immigration_authority || '—'} | ${c.visa_types} | ${c.fee_currency || '—'} | ${c.last_verified_at || '—'} |`,
    );
  }
  /**
   * Countries somebody has actually looked at, and what they found.
   *
   * Without this, the ledger could say only "researched" or "not yet
   * researched", and there was nowhere to record a country that WAS
   * investigated and not admitted. Researching one and rejecting it left no
   * trace, so the next session started from the same blank — which is how 183
   * countries stay 183 countries.
   *
   * "Not yet researched" remains an honest status for the rest. It is just no
   * longer the only thing this file can say.
   */
  const evidencePath = 'data/country-probe-evidence.json';
  const evidence = existsSync(evidencePath)
    ? JSON.parse(readFileSync(evidencePath, 'utf8'))
    : {};
  const assessed = unresearched.filter((c) => evidence[c.code]);
  const untouched = unresearched.filter((c) => !evidence[c.code]);

  if (assessed.length > 0) {
    out.push('', '## Assessed, not admitted — with evidence', '');
    out.push(
      'These were probed FROM THE VPS, because a local result is not evidence',
      'about production: Finland passed every reachability check from a laptop',
      'and failed from the syncing host. Each row is a measurement, not a guess',
      'about what a government probably publishes.',
      '',
    );
    for (const c of assessed) {
      const e = evidence[c.code];
      out.push(`### ${c.name} (${c.code}) — \`${e.conclusion}\``, '');
      out.push(`Probed ${e.probed_at} from ${e.probed_from}.`, '');
      out.push('| Authority | Role | Verdict | Evidence |');
      out.push('|---|---|---|---|');
      for (const a of e.authorities ?? []) {
        out.push(
          `| [${a.name}](${a.url}) | ${a.role} | **${a.verdict}** | ${a.evidence} |`,
        );
      }
      if (e.note) out.push('', e.note);
      out.push('');
    }
  }

  out.push('', '## In the registry, nobody has looked yet', '');
  out.push(
    `**${untouched.length}** countries. This is the honest gap, and it is stated`,
    'as a count rather than dressed up: no authority has been identified, nothing',
    'has been probed, and nothing is known about whether these could be read.',
    '',
  );
  out.push(untouched.map((c) => `${c.code} ${c.name}`).join(' · '));
  out.push('');
  write('docs/visa-data/GLOBAL_COUNTRY_SCOPE.md', out.join('\n'));
}

// --------------------------------------------------------------- visa catalog
{
  const out = [GENERATED('Global visa catalog')];
  const totalReq = catalog.reduce((a, t) => a + n(t.active_requirements), 0);
  const totalQuote = catalog.reduce((a, t) => a + n(t.quotable_requirements), 0);
  out.push(
    `**${catalog.length}** visa types across **${researched.length}** countries.`,
    `**${totalReq}** active requirements, of which **${totalQuote}** can quote their`,
    `authority verbatim.`,
    ``,
    `\`quotable\` counts requirements carrying \`source_excerpt_display\` — the`,
    `authority's own wording, not the monitor's lowercased matching text. A route`,
    `showing 0 there publishes no quotations, which is the honest state for a source`,
    `nobody can re-read.`,
    ``,
    `| Country | Visa type | Code | Category | Active reqs | Quotable | Sources |`,
    `|---|---|---|---|---|---|---|`,
  );
  for (const t of catalog) {
    out.push(
      `| ${t.country} | ${t.official_name} | ${t.official_code || '—'} | ${t.category} | ${t.active_requirements} | ${t.quotable_requirements} | ${t.active_sources} |`,
    );
  }
  out.push('');
  write('docs/visa-data/GLOBAL_VISA_CATALOG.md', out.join('\n'));
}

// ------------------------------------------------------------------ exceptions
{
  const out = [GENERATED('Global coverage exceptions')];
  out.push(
    `Two different things live here, and the difference is the point.`,
    ``,
    `## Blocked by the authority — evidence-backed exceptions`,
    ``,
    `${blocked.length} visa type(s). Every source for these routes is either`,
    `robots-disallowed or has failed repeatedly, so no requirement can be extracted`,
    `and none is published. The evidence is the monitor's own record.`,
    ``,
    `| Country | Visa type | Sources | Evidence |`,
    `|---|---|---|---|`,
  );
  for (const t of blocked) {
    const own = sources.filter((s) => s.visaai_id === t.visaai_id);
    const ev = own
      .map((s) =>
        s.robots_state === 'disallowed'
          ? 'robots disallows'
          : `${s.failure_streak} consecutive failures`,
      )
      .filter((v, i, a) => a.indexOf(v) === i)
      .join('; ');
    out.push(`| ${t.country} | ${t.official_name} | ${own.length} | ${ev} |`);
  }

  out.push(
    ``,
    `## Registered but not yet extracted`,
    ``,
    `${pending.length} visa type(s) whose sources are readable and whose requirements`,
    `have simply not been extracted yet. Not an exception — unfinished work.`,
    ``,
  );
  if (pending.length) {
    out.push(`| Country | Visa type |`, `|---|---|`);
    for (const t of pending) out.push(`| ${t.country} | ${t.official_name} |`);
  } else {
    out.push(`None: every registered visa type with a readable source has been extracted.`);
  }

  // Split by whether anybody has actually looked. Before this, the ledger could
  // only say "not yet researched" about all 183, so a country that WAS
  // investigated and not admitted left no trace and the next session started
  // from the same blank.
  /**
   * Scope, set by decision on 2026-08-24 (spec §4.1). Countries outside it are
   * not work that is outstanding — they are places VisaAI has chosen not to
   * cover, and counting them as a gap would report a decision as a debt.
   */
  const scopePath = 'data/country-scope.json';
  const scope = existsSync(scopePath)
    ? JSON.parse(readFileSync(scopePath, 'utf8')).in_scope
    : null;
  const inScope = (c) => !scope || Object.hasOwn(scope, c.code);

  const exEvidencePath = 'data/country-probe-evidence.json';
  const exEvidence = existsSync(exEvidencePath)
    ? JSON.parse(readFileSync(exEvidencePath, 'utf8'))
    : {};
  const scoped = unresearched.filter(inScope);
  const outOfScope = unresearched.filter((c) => !inScope(c) && !exEvidence[c.code]);
  // Evidence survives a scope change. Austria, Denmark, France, Japan and
  // Portugal were probed before the 2026-08-24 decision and are now out of
  // scope; dropping their findings because the scope moved would recreate the
  // exact problem this section was built to fix — research done and no trace
  // left of it. They are shown, and labelled.
  const exAssessed = unresearched.filter((c) => exEvidence[c.code]);
  const exUntouched = scoped.filter((c) => !exEvidence[c.code]);

  out.push(
    ``,
    `## Assessed and not admitted — evidence-backed`,
    ``,
    `${exAssessed.length} ${exAssessed.length === 1 ? 'country' : 'countries'} probed, some since moved out of scope —`,
    `their findings are kept because research that leaves no trace is the problem`,
    `this section exists to fix. Probed FROM THE VPS, because a local result is`,
    `not evidence about production — Finland passed every reachability check from a`,
    `laptop and failed from the syncing host. These DO satisfy §84's "named in the`,
    `evidence-backed exception ledger", because each carries a measurement.`,
    ``,
  );
  if (exAssessed.length === 0) {
    out.push(`None yet.`, ``);
  } else {
    for (const c of exAssessed) {
      const e = exEvidence[c.code];
      const mark = inScope(c) ? 'in scope' : 'OUT OF SCOPE since 2026-08-24';
      out.push(`### ${c.name} (${c.code}) — \`${e.conclusion}\` — ${mark}`, ``);
      out.push(`Probed ${e.probed_at} from ${e.probed_from}.`, ``);
      out.push(`| Authority | Role | Verdict | Evidence |`, `|---|---|---|---|`);
      for (const a of e.authorities ?? []) {
        out.push(`| [${a.name}](${a.url}) | ${a.role} | **${a.verdict}** | ${a.evidence} |`);
      }
      if (e.note) out.push(``, e.note);
      out.push(``);
    }
  }

  out.push(
    ``,
    `## Nobody has looked yet — NOT an evidence-backed exception`,
    ``,
    `${exUntouched.length} ${exUntouched.length === 1 ? 'country' : 'countries'}, all IN SCOPE. §84 asks that every`,
    `in-scope country be "researched, or named in the evidence-backed exception`,
    `ledger". A country listed HERE is named and nothing more: nobody has probed`,
    `its authority, so nothing is known about whether it could be read, and naming`,
    `it does not convert absence of work into a documented decision.`,
    ``,
    // The old wording said "the §84 row stays open until this number reaches
    // zero" and kept saying it AFTER the number reached zero, which reads as an
    // open item on the day it closed. The sentence has to know which side of
    // zero it is on, or the report contradicts its own count.
    ...(exUntouched.length
      ? [
          `**§84 item 65 stays OPEN**: ${exUntouched.length} in-scope ${exUntouched.length === 1 ? 'country has' : 'countries have'} not been examined by anyone.`,
          ``,
          exUntouched.map((c) => `${c.code} ${c.name}`).join(' · '),
        ]
      : [
          `**None — and that is the §84 item 65 condition.** Every in-scope country is`,
          `either researched or carries a per-country measurement in the section above.`,
          `The distinction this section exists to protect still holds: it is not that`,
          `every country was admitted, it is that none was skipped.`,
        ]),
    ``,
    `## Out of scope — not a gap`,
    ``,
    `${outOfScope.length} countries are in the registry and outside VisaAI's scope`,
    `as set on 2026-08-24 (spec §4.1, list in \`data/country-scope.json\`). They are`,
    `NOT counted as outstanding work: covering fewer places properly is a decision,`,
    `and reporting a decision as a debt would make the remaining work look`,
    `permanently unfinishable.`,
    ``,
    `Their rows are kept rather than deleted — ISO code, canonical name and slug are`,
    `verified data, \`support_state = 'unsupported'\` already keeps them off the`,
    `public site, and widening scope is an edit to one file.`,
    ``,
  );
  write('docs/visa-data/GLOBAL_COVERAGE_EXCEPTIONS.md', out.join('\n'));
}

// -------------------------------------------------------------------- exports
write(
  'artifacts/visa-data/global-country-registry.json',
  JSON.stringify(
    {
      generated_by: 'scripts/visa-registry/generate-global-catalog.mjs',
      countries_total: countries.length,
      countries_researched: researched.length,
      countries_not_yet_researched: unresearched.length,
      countries,
    },
    null,
    2,
  ) + '\n',
);

write(
  'artifacts/visa-data/global-visa-catalog.json',
  JSON.stringify(
    {
      generated_by: 'scripts/visa-registry/generate-global-catalog.mjs',
      visa_types: catalog.length,
      active_requirements: catalog.reduce((a, t) => a + n(t.active_requirements), 0),
      quotable_requirements: catalog.reduce((a, t) => a + n(t.quotable_requirements), 0),
      catalog,
    },
    null,
    2,
  ) + '\n',
);

write(
  'artifacts/visa-data/global-visa-catalog.csv',
  csv(catalog, [
    'country_code', 'country', 'visaai_id', 'visa_slug', 'official_name', 'official_code',
    'category', 'lifecycle_state', 'data_quality', 'active_requirements',
    'quotable_requirements', 'active_sources', 'last_verified_at',
  ]),
);

write(
  'artifacts/visa-data/global-official-source-ledger.csv',
  csv(sources, [
    'country_code', 'visaai_id', 'role', 'authority', 'authority_rank', 'source_url',
    'language', 'robots_state', 'active', 'failure_streak', 'last_success_at', 'versions',
  ]),
);

console.log(
  `\n${countries.length} countries (${researched.length} researched), ` +
    `${catalog.length} visa types, ${sources.length} sources, ` +
    `${blocked.length} blocked, ${unresearched.length} not yet researched.`,
);
