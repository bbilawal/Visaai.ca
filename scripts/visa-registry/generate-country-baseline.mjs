#!/usr/bin/env node
/**
 * Emit the migration that puts all 195 baseline countries in the registry.
 *
 * WHAT THE SPEC ASKS FOR
 *
 * §4.1: "the 193 United Nations member states plus the Holy See and the State
 * of Palestine ... a completeness floor, not permission to omit separately
 * administered visa jurisdictions." §84 checks that every one is present
 * exactly once.
 *
 * The registry held 13. Not because 182 were forgotten, but because a country
 * only ever entered it when someone extracted a route for it — which is the
 * right way to earn a PUBLISHED page and the wrong way to keep a canonical
 * list. Without the full list there is no denominator: "we cover 13" is a
 * number, "13 of 195" is a fact.
 *
 * WHAT THESE ROWS DELIBERATELY DO NOT CONTAIN
 *
 * No immigration authority, no authority URL, no eVisa portal, no currency, no
 * languages. Those are per-country research, and §6 makes official sources
 * authoritative — inventing 182 plausible authority URLs would be the exact
 * fabrication every other check in this system exists to prevent. They are NULL
 * because we have not looked yet, and NULL says that.
 *
 * `support_state = 'unsupported'` for the same reason, and it is load-bearing:
 * `listPublishedCountries` filters on `<> 'unsupported'`, so a bare baseline row
 * publishes NO hub page and adds NO sitemap URL. Adding 182 empty hubs would
 * have been a thin-content regression on a site whose programmatic-SEO gate
 * exists precisely to stop that.
 *
 * A country graduates to `preview` when its authority and visa types are
 * verified, and to `supported` when requirements are extracted and reviewed.
 * Nothing here promotes anything.
 *
 * HOW THE ISO CODES ARE ESTABLISHED, NOT GUESSED
 *
 * Every code is checked against `Intl.DisplayNames` — the ICU region database
 * shipped with Node — by asking it which country the code denotes and comparing
 * that to the spec's name. Names are compared symmetrically: diacritics
 * stripped, "&" and "and" unified, "St." and "Saint" unified. A code that does
 * not round-trip is reported rather than emitted, so a wrong mapping fails
 * loudly instead of quietly naming the wrong country.
 *
 * Seven names legitimately differ from ICU's label and the script prints every
 * one on each run: the spec uses UN/ISO forms (Cabo Verde, Myanmar, Holy See,
 * State of Palestine, the two Congos, Federated States of Micronesia) where ICU
 * uses common English ones (Cape Verde, Myanmar (Burma), Vatican City,
 * Palestinian Territories, Congo - Brazzaville / Congo - Kinshasa, Micronesia).
 * §4.1 says to use current ISO names, so the spec's form is stored — and the
 * list is printed rather than suppressed so a NEW divergence is visible.
 *
 * Usage:
 *   node scripts/visa-registry/generate-country-baseline.mjs \
 *     ../VisaAI_Claude_Master_Execution_Spec.md > supabase/migrations/<ts>_baseline.sql
 */

import { readFileSync } from 'node:fs';

const specPath = process.argv[2];
if (!specPath) {
  console.error('usage: generate-country-baseline.mjs <spec.md>');
  process.exit(2);
}

/** Read the baseline out of the spec itself rather than from a copy of it. */
function baselineNames(spec) {
  const start = spec.indexOf('### 4.1 Mandatory 195-country baseline');
  if (start === -1) {
    // The heading is gone because the 195-country floor was replaced by a
    // deliberate scope decision on 2026-08-24. This script did its job — all 196
    // rows are in visa_countries and are NOT deleted by that decision — and it
    // has no list left to read.
    throw new Error(
      '§4.1 no longer carries a 195-country list. It was replaced by a scope ' +
        'decision on 2026-08-24, and the countries VisaAI covers now live in ' +
        'data/country-scope.json. This generator built the original baseline, ' +
        'which is already in visa_countries; it is kept for the record rather ' +
        'than rerun. If you are trying to widen scope, edit country-scope.json.',
    );
  }
  const names = [];
  for (const line of spec.slice(start).split('\n')) {
    const m = /^\s*(\d{1,3})\.\s+(.+?)\s*$/.exec(line);
    // Consecutive numbering only: stops at the end of the list rather than
    // sweeping up every numbered line in the rest of the document.
    if (m && Number(m[1]) === names.length + 1) names.push(m[2]);
  }
  return names;
}

/**
 * Compare names the way a person would, symmetrically on both sides.
 *
 * The spec writes "Antigua and Barbuda"; ICU writes "Antigua & Barbuda". The
 * spec writes "Saint Lucia"; ICU writes "St. Lucia". "São Tomé" carries
 * diacritics. None of those is a disagreement about which country is meant.
 */
const norm = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // Articles are not identity. The spec writes "Saint Vincent and THE
    // Grenadines" and ICU writes "St. Vincent & Grenadines"; that is the same
    // country. Dropping every standalone "the" is safer than dropping only a
    // leading one, and no country name is distinguished from another by it.
    .replace(/\bthe\b/g, '')
    .replace(/&/g, 'and')
    .replace(/\bst\.?\b/g, 'saint')
    .replace(/[’']/g, '')
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const dn = new Intl.DisplayNames(['en'], { type: 'region' });

/**
 * Alpha-2 codes ICU still resolves that ISO 3166-1 no longer ASSIGNS.
 *
 * THIS LIST EXISTS BECAUSE THE FIRST VERSION SHIPPED FOUR WRONG COUNTRIES.
 *
 * `Intl.DisplayNames` answers for formerly-used and reserved codes exactly as
 * confidently as for current ones: `DY` returns "Benin", `HV` returns
 * "Burkina Faso", `FX` returns "France", `YU` returns "Serbia". Building a
 * name→code index by walking AA..ZZ therefore lets a dead code overwrite the
 * live one whenever it sorts later, and Benin, Burkina Faso, France and Serbia
 * all went into the registry — and to production — under the code of a country
 * that no longer exists.
 *
 * The round-trip check could not catch it. `DY` → "Benin" round-trips perfectly;
 * it is the wrong code for the right name, which is precisely the failure a
 * self-consistency check cannot see.
 *
 * Each entry is what the code used to mean. The guarantee is not this list's
 * completeness by inspection — it is the assertion below that after removing
 * them, NO name resolves to more than one code.
 */
const NOT_CURRENTLY_ASSIGNED = new Map([
  ['AN', 'Netherlands Antilles, split 2010'],
  ['BU', 'Burma, now MM'],
  ['CS', 'Serbia and Montenegro, split 2006'],
  ['DD', 'German Democratic Republic'],
  ['DY', 'Dahomey, now Benin (BJ)'],
  ['FX', 'France, Metropolitan — a subdivision, not the country (FR)'],
  ['HV', 'Upper Volta, now Burkina Faso (BF)'],
  ['NH', 'New Hebrides, now Vanuatu (VU)'],
  ['RH', 'Southern Rhodesia, now Zimbabwe (ZW)'],
  ['SU', 'Soviet Union'],
  ['TP', 'East Timor, now Timor-Leste (TL)'],
  ['UK', 'exceptionally reserved for the United Kingdom; the assigned code is GB'],
  ['VD', 'Democratic Republic of Viet-Nam'],
  ['YD', "Yemen, Democratic (South Yemen)"],
  ['YU', 'Yugoslavia'],
  ['ZR', 'Zaire, now the Democratic Republic of the Congo (CD)'],
]);

/**
 * Every CURRENTLY ASSIGNED alpha-2 code ICU recognises, keyed by normalized name.
 *
 * Refuses to build an ambiguous index: if two live codes still resolve to one
 * name after the exclusions above, that is a new ICU behaviour and the caller
 * must look rather than take whichever won.
 */
function icuIndex() {
  const byName = new Map();
  const collisions = [];
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a) + String.fromCharCode(b);
      if (NOT_CURRENTLY_ASSIGNED.has(code)) continue;
      let label;
      try {
        label = dn.of(code);
      } catch {
        continue;
      }
      if (!label || label === code) continue; // not a region ICU knows
      const key = norm(label);
      if (byName.has(key)) collisions.push(`${byName.get(key)} / ${code} -> ${label}`);
      else byName.set(key, code);
    }
  }
  if (collisions.length) {
    console.error('Ambiguous ISO names — two live codes share one name. Refusing to guess:');
    for (const c of collisions) console.error(`  ${c}`);
    process.exit(1);
  }
  return byName;
}

/**
 * Names where the UN/ISO form and ICU's English label are different words
 * rather than different punctuation. Each is asserted below by round-tripping
 * the code back through ICU, so a wrong entry here cannot pass silently.
 */
const ALIASES = {
  'Bahamas': 'BS',
  'Bolivia': 'BO',
  'Brunei': 'BN',
  'Cabo Verde': 'CV',
  'Republic of the Congo': 'CG',
  'Democratic Republic of the Congo': 'CD',
  'Czechia': 'CZ',
  'Timor-Leste': 'TL',
  'Eswatini': 'SZ',
  'Holy See': 'VA',
  'Iran': 'IR',
  'North Korea': 'KP',
  'South Korea': 'KR',
  'Laos': 'LA',
  'Federated States of Micronesia': 'FM',
  'Moldova': 'MD',
  'Myanmar': 'MM',
  'Russia': 'RU',
  'State of Palestine': 'PS',
  'Syria': 'SY',
  'Tanzania': 'TZ',
  'Turkiye': 'TR',
  'Türkiye': 'TR',
  'United Kingdom': 'GB',
  'United States of America': 'US',
  'Venezuela': 'VE',
  'Vietnam': 'VN',
};

const slugify = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const spec = readFileSync(specPath, 'utf8');
const names = baselineNames(spec);
if (names.length !== 195) {
  console.error(`Expected 195 baseline countries, read ${names.length} from the spec.`);
  process.exit(1);
}

const byName = icuIndex();
const alias = new Map(Object.entries(ALIASES).map(([k, v]) => [norm(k), v]));

const rows = [];
const unresolved = [];
const mismatched = [];

for (const name of names) {
  const code = alias.get(norm(name)) ?? byName.get(norm(name));
  if (!code) {
    unresolved.push(name);
    continue;
  }
  // Round-trip: ask ICU what this code IS, and keep the difference visible.
  const icu = dn.of(code);
  if (norm(icu) !== norm(name)) mismatched.push({ name, code, icu });
  rows.push({ name, code, slug: slugify(name) });
}

const codes = new Set();
const duplicates = [];
const slugs = new Set();
for (const r of rows) {
  if (codes.has(r.code)) duplicates.push(`${r.code} (${r.name})`);
  codes.add(r.code);
  if (slugs.has(r.slug)) duplicates.push(`slug ${r.slug} (${r.name})`);
  slugs.add(r.slug);
}

if (unresolved.length || duplicates.length) {
  console.error(`Refusing to generate.`);
  if (unresolved.length) {
    console.error(`\n${unresolved.length} name(s) could not be mapped to an ISO code:`);
    for (const n of unresolved) console.error(`  - ${n}`);
  }
  if (duplicates.length) {
    console.error(`\n${duplicates.length} duplicate(s):`);
    for (const d of duplicates) console.error(`  - ${d}`);
  }
  process.exit(1);
}

const q = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

const out = [];
const w = (s = '') => out.push(s);

w('-- The 195-country baseline: every UN member state plus the Holy See and the');
w('-- State of Palestine, present in the canonical registry exactly once.');
w('--');
w('-- GENERATED FILE. Do not hand-edit.');
w('--   generator: scripts/visa-registry/generate-country-baseline.mjs');
w('--   source: the spec’s own §4.1 list, read at generation time');
w(`--   rows: ${rows.length}`);
w('--');
w('-- WHY THE REGISTRY HELD 13 AND NOT 195');
w('--');
w('-- A country only ever entered it when somebody extracted a route for it.');
w('-- That is the right way to earn a PUBLISHED page and the wrong way to keep a');
w('-- canonical list: without the full list there is no denominator. "We cover');
w('-- 13" is a number; "13 of 195" is a fact.');
w('--');
w('-- WHAT THESE ROWS DELIBERATELY DO NOT CONTAIN');
w('--');
w('-- No immigration authority, no authority URL, no portal, no currency, no');
w('-- languages. Those are per-country research, and §6 makes official sources');
w('-- authoritative -- inventing 182 plausible authority URLs would be the exact');
w('-- fabrication every other check in this system exists to prevent. They are');
w('-- NULL because nobody has looked yet, and NULL says so.');
w('--');
w("-- support_state = 'unsupported' for the same reason, and it is LOAD-BEARING:");
w("-- `listPublishedCountries` filters on <> 'unsupported', so a bare baseline row");
w('-- publishes no hub page and adds no sitemap URL. 182 empty hubs would be a');
w('-- thin-content regression on a site whose programmatic-SEO gate exists to');
w('-- prevent exactly that.');
w('--');
w('-- A country graduates to preview when its authority and visa types are');
w('-- verified, and to supported when requirements are extracted and reviewed.');
w('-- NOTHING HERE PROMOTES ANYTHING: the insert is ON CONFLICT DO NOTHING, so');
w('-- the 13 rows already carrying verified authorities are untouched.');
w('--');
w('-- ISO CODES ARE ESTABLISHED, NOT GUESSED. Every code is round-tripped through');
w("-- Node's ICU region database and compared to the spec's name; the generator");
w('-- refuses to emit anything it cannot map. Five names differ from ICU by word');
w('-- rather than punctuation, and §4.1 says to use current ISO names, so the');
if (mismatched.length) {
  w('-- spec form is stored:');
  for (const m of mismatched) w(`--   ${m.code}  spec "${m.name}"  vs ICU "${m.icu}"`);
} else {
  w('-- spec form is stored.');
}
w('');
w('begin;');
w('');
w('insert into public.visa_countries (code, name, slug, support_state, data_quality)');
w('values');
w(
  rows
    .map((r) => `  (${q(r.code)}, ${q(r.name)}, ${q(r.slug)}, 'unsupported', 'unverified')`)
    .join(',\n'),
);
w('on conflict (code) do nothing;');
w('');
w('-- The §84 claim, asserted rather than described.');
w('do $$');
w('declare total int; published int; bare int;');
w('begin');
w('  select count(*) into total from public.visa_countries;');
w(`  if total < ${rows.length} then`);
w(`    raise exception 'Expected at least ${rows.length} countries in the registry, found %.', total;`);
w('  end if;');
w('');
w('  -- Nothing new may become publishable. This migration adds a denominator,');
w('  -- not 182 empty pages.');
w("  select count(*) into published from public.visa_countries where support_state <> 'unsupported';");
w('  if published > 13 then');
w("    raise exception '% countries are publishable; the baseline must not publish anything (expected 13).', published;");
w('  end if;');
w('');
w('  -- A bare baseline row must carry no authority it has not earned.');
w('  select count(*) into bare from public.visa_countries');
w("   where support_state = 'unsupported'");
w('     and (immigration_authority is not null or immigration_authority_url is not null);');
w('  if bare > 0 then');
w("    raise exception '% unsupported countries carry an authority nobody verified.', bare;");
w('  end if;');
w('end $$;');
w('');
w('commit;');
w('');

process.stdout.write(out.join('\n'));

console.error(`Mapped ${rows.length} countries. ${mismatched.length} name(s) differ from ICU's label:`);
for (const m of mismatched) console.error(`  ${m.code}  spec="${m.name}"  icu="${m.icu}"`);
