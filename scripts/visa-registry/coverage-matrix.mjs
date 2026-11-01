#!/usr/bin/env node
/**
 * Generate the country x visa coverage matrix from the database.
 *
 * The spec (§80) requires this to be REPRODUCIBLE — every row derived from the
 * registry, not typed by hand. A hand-written matrix is a claim; a generated
 * one is a measurement, and the difference matters because this table is where
 * "we support N countries" either becomes true or becomes marketing.
 *
 * Statuses, and what each actually means:
 *
 *   PASS                       active visa type, >=1 active OFFICIAL
 *                              requirement, >=1 reachable official source.
 *                              This is what visa_publishable_pages requires,
 *                              so a PASS row is exactly a publishable page.
 *   PASS WITH LIMITATION       sources verified and reachable, but no
 *                              requirement has been extracted and reviewed
 *                              yet. The hub page publishes; the detail page
 *                              renders noindex.
 *   BLOCKED BY OFFICIAL SOURCE every source is unreachable, robots-disallowed
 *                              or persistently failing. Not a VisaAI bug — the
 *                              authority is not letting us read it, and no
 *                              amount of engineering changes that.
 *   FAILED                     sources exist and are reachable, but the last
 *                              sync run could not parse them.
 *   UNSUPPORTED                the country is explicitly out of scope.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/visa-registry/coverage-matrix.mjs
 *   node scripts/visa-registry/coverage-matrix.mjs --docker supabase_db_VisaAI
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const dockerIdx = args.indexOf('--docker');
const container = dockerIdx >= 0 ? args[dockerIdx + 1] : null;

const QUERY = `
select
  c.code,
  c.name                          as country,
  c.support_state,
  c.data_quality,
  c.last_verified_at,
  t.visaai_id,
  t.official_name,
  t.official_code,
  t.category,
  t.lifecycle_state,
  coalesce(r.official_count, 0)   as official_requirements,
  coalesce(r.recommended_count,0) as recommended_items,
  coalesce(s.total, 0)            as sources,
  coalesce(s.reachable, 0)        as reachable_sources,
  coalesce(s.blocked, 0)          as blocked_sources,
  coalesce(k.parse_errors, 0)     as parse_errors,
  coalesce(k.client_rendered, 0)  as client_rendered,
  coalesce(f.form_count, 0)       as official_forms
from visa_countries c
left join visa_types t on t.country_id = c.id
left join lateral (
  select
    count(*) filter (where status = 'active' and officially_required) as official_count,
    count(*) filter (where status = 'active' and kind = 'recommended') as recommended_count
  from visa_requirements where visa_type_id = t.id
) r on true
left join lateral (
  select
    count(*)                                                  as total,
    count(*) filter (where active and robots_state <> 'disallowed'
                       and failure_streak < 3)                as reachable,
    count(*) filter (where robots_state = 'disallowed'
                       or failure_streak >= 3)                as blocked
  from visa_sources where visa_type_id = t.id
) s on true
left join lateral (
  select count(*) as form_count
  from visa_sources where visa_type_id = t.id and role = 'forms'
) f on true
left join lateral (
  select
    count(*) filter (where ck.status = 'parse_error')    as parse_errors,
    count(*) filter (where ck.status = 'client_rendered') as client_rendered
  from visa_source_checks ck
  join visa_sources src on src.id = ck.source_id
  where src.visa_type_id = t.id
    and ck.checked_at > now() - interval '7 days'
) k on true
order by c.name, t.category, t.official_name;
`;

function runQuery() {
  if (container) {
    return execFileSync(
      'docker',
      [
        'exec',
        '-i',
        container,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '--csv',
        '-c',
        QUERY,
      ],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error(
      'Set DATABASE_URL, or pass --docker <container>. Refusing to guess a connection.',
    );
    process.exit(2);
  }
  return execFileSync('psql', [url, '--csv', '-c', QUERY], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
}

/** Minimal CSV parse: psql --csv quotes fields containing commas or quotes. */
function parseCsv(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function classify(r) {
  const n = (k) => Number(r[k] ?? 0);
  if (r.support_state === 'unsupported') return ['UNSUPPORTED', 'Country is out of scope.'];
  if (!r.visaai_id) return ['FAILED', 'Country has no visa types.'];
  if (r.lifecycle_state !== 'active')
    return ['UNSUPPORTED', `Visa type is ${r.lifecycle_state}.`];
  if (n('sources') === 0) return ['FAILED', 'No official source is registered.'];
  if (n('reachable_sources') === 0)
    return [
      'BLOCKED BY OFFICIAL SOURCE',
      `All ${n('sources')} source(s) are robots-disallowed or persistently failing.`,
    ];
  // Asked BEFORE the parse-error question. A page that serves no
  // server-rendered text is not a parser failure, and reporting it as one puts
  // an unfixable item in the parser backlog — where it stays red forever and
  // teaches everyone to skip the whole column.
  if (n('client_rendered') > 0 && n('parse_errors') === 0 && n('official_requirements') === 0)
    return [
      'BLOCKED BY OFFICIAL SOURCE',
      `The page renders its content with script — ${n('client_rendered')} check(s) in the last ` +
        '7 days found no server-rendered text. Not a parser bug and not a refusal; ' +
        'there is nothing in the markup to read.',
    ];
  if (n('parse_errors') > 0 && n('official_requirements') === 0)
    return ['FAILED', `${n('parse_errors')} parse error(s) in the last 7 days.`];
  if (n('official_requirements') === 0)
    return [
      'PASS WITH LIMITATION',
      'Sources verified; no requirement extracted and reviewed yet, so the detail page is noindex.',
    ];
  if (r.support_state !== 'supported')
    return [
      'PASS WITH LIMITATION',
      `Requirements exist but the country is '${r.support_state}', so pages are not published.`,
    ];
  return ['PASS', ''];
}

const rows = parseCsv(runQuery());

const out = [];
const w = (s = '') => out.push(s);

w('# Country × Visa Coverage Matrix');
w('');
w('GENERATED FILE — `node scripts/visa-registry/coverage-matrix.mjs --docker <container>`.');
w('Every cell is read from the registry. Do not hand-edit; regenerate.');
w('');

/**
 * The matrix is a table of VISA TYPES. A country with none contributes an empty
 * row, and since the 195-country baseline landed there are 180+ of those —
 * countries present in the canonical registry that nobody has researched yet.
 * Listing them as blank matrix rows would bury the 60-odd real ones.
 *
 * They are not dropped from the REPORT, though: the baseline section below
 * counts them, because "13 of 195" is the fact the baseline exists to state.
 */
const typeRows = rows.filter((r) => r.visaai_id);
const baselineOnly = rows.filter((r) => !r.visaai_id);
const countries = new Set(typeRows.map((r) => r.code));

const counts = {};
for (const r of typeRows) {
  const [status] = classify(r);
  counts[status] = (counts[status] ?? 0) + 1;
}

w('## Totals');
w('');
w('| Status | Rows |');
w('|---|---|');
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  w(`| ${k} | ${v} |`);
}
w(`| **Total** | **${typeRows.length}** |`);
w('');

const withReqs = rows.filter((r) => Number(r.official_requirements) > 0).length;
const totalSources = rows.reduce((s, r) => s + Number(r.sources ?? 0), 0);
const totalForms = rows.reduce((s, r) => s + Number(r.official_forms ?? 0), 0);

w('## Registry counts');
w('');
w(`- Countries with at least one visa type: **${countries.size}**`);
w(`- Countries in the canonical registry: **${rows.length - typeRows.length + countries.size}**`);
w(`- Visa types: **${typeRows.length}**`);
w(`- Visa types with at least one active official requirement: **${withReqs}**`);
w(`- Official source URLs registered: **${totalSources}**`);
w(`- Official form sources registered: **${totalForms}**`);
w('');

const scopeFile = 'data/country-scope.json';
const scopeMap = existsSync(scopeFile)
  ? JSON.parse(readFileSync(scopeFile, 'utf8')).in_scope
  : null;
const scopedOnly = scopeMap
  ? baselineOnly.filter((r) => Object.hasOwn(scopeMap, r.code))
  : baselineOnly;
const outOfScopeCount = baselineOnly.length - scopedOnly.length;

/**
 * An in-scope country with no visa types is NOT automatically unexamined.
 *
 * This report said "in scope, not yet researched: 18" on 2026-08-26, on a day
 * when all eighteen carried probe evidence — measured page sizes, robots
 * states, uniqueness ratios, taken from the VPS. Read literally it announced
 * eighteen countries nobody had looked at, which is the exact confusion
 * `country-probe-evidence.json` was created to end, and the coverage matrix was
 * the one generator still making it.
 *
 * So the split is read from the same file `generate-global-catalog.mjs` reads.
 * "Assessed" is what §84 accepts as an evidence-backed exception; "not yet
 * examined" is the number that has to reach zero.
 */
const evidenceFile = 'data/country-probe-evidence.json';
const probeEvidence = existsSync(evidenceFile)
  ? JSON.parse(readFileSync(evidenceFile, 'utf8'))
  : {};
const assessed = scopedOnly.filter((r) => Object.hasOwn(probeEvidence, r.code));
const unexamined = scopedOnly.filter((r) => !Object.hasOwn(probeEvidence, r.code));

/** conclusion -> how many in-scope, unresearched countries carry it. */
const byConclusion = new Map();
for (const r of assessed) {
  const c = probeEvidence[r.code].conclusion ?? 'unrecorded';
  byConclusion.set(c, (byConclusion.get(c) ?? 0) + 1);
}

w('## Scope coverage');
w('');
w('\u00a74.1 previously set a 195-country floor. It was replaced on 2026-08-24 by a');
w('deliberate scope decision, and the countries VisaAI covers are listed in');
w('`data/country-scope.json` \u2014 read here at generation time so this table and the');
w('spec cannot drift apart.');
w('');
w(`- In scope: **${scopeMap ? Object.keys(scopeMap).length : countries.size}**`);
w(`- Researched, with at least one visa type: **${countries.size}**`);
w(`- In scope, assessed with evidence but not admitted: **${assessed.length}**`);
w(`- In scope, NOT YET EXAMINED BY ANYONE: **${unexamined.length}**`);
w(`- In the registry but out of scope: **${outOfScopeCount}** \u2014 not outstanding work`);
w('');
w('The last two lines used to be one line reading "not yet researched", which');
w('made an evidenced refusal and an unopened file look identical. They are');
w('opposite states: the first is a finding, the second is a gap. Only the second');
w('is outstanding work, and \u00a784 accepts the first as an exception because each');
w('carries a measurement rather than a status.');
w('');
if (assessed.length > 0) {
  w('Assessed, by what was found (see `data/country-probe-evidence.json`):');
  w('');
  for (const [c, n] of [...byConclusion].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    w(`- \`${c}\`: **${n}**`);
  }
  w('');
}
w('Out-of-scope rows are kept rather than deleted: their ISO codes and names are');
w('verified data, `support_state` keeps them off the public site, and widening');
w('scope is an edit to one file. Counting them as a gap would report a decision');
w('as a debt.');
w('');
w('Neither an assessed nor an unexamined country publishes anything:');
w('`support_state` is `unsupported`, and the public country list filters those');
w('out, so none of them adds a hub page or a sitemap URL.');
w('');

w('## Matrix');
w('');
w('| Country | Visa type | Code | Category | Official reqs | Forms | Sources (reachable/blocked) | Status | Note |');
w('|---|---|---|---|---|---|---|---|---|');
for (const r of typeRows) {
  const [status, note] = classify(r);
  w(
    `| ${r.country} (${r.code}) | ${r.official_name ?? '—'} | ${r.official_code || '—'} | ` +
      `${r.category ?? '—'} | ${r.official_requirements} | ${r.official_forms} | ` +
      `${r.sources} (${r.reachable_sources}/${r.blocked_sources}) | ${status} | ${note} |`,
  );
}
w('');

w('## Explanation of every non-PASS class');
w('');
w(
  '**PASS WITH LIMITATION** — the dominant status today, and it is the quality gate ' +
    'working rather than a gap. The official sources for these visas were fetched and ' +
    'verified, but VisaAI publishes a REQUIREMENT only after it has been extracted from ' +
    'a specific source version and reviewed by a person. Until the first sync run has ' +
    'gone through that cycle, the country hub page publishes (authority, visa catalog and ' +
    'official links are all verified facts) and the per-visa detail page renders ' +
    '`noindex, follow`. Listing an unverified requirement would be the fabrication the ' +
    'spec forbids; listing nothing is the honest state.',
);
w('');
w(
  '**BLOCKED BY OFFICIAL SOURCE** — the authority disallows automated reading of the ' +
    'page, or it has failed repeatedly. This is not fixable by engineering: VisaAI keeps ' +
    "the metadata and links the applicant to the authority's own page instead of caching " +
    'it. Respecting that is non-negotiable (spec rule 9).',
);
w('');
w(
  '**FAILED** — sources are reachable but the extractor could not produce usable text. ' +
    'This IS a VisaAI bug and belongs in the parser backlog.',
);
w('');

process.stdout.write(out.join('\n') + '\n');
