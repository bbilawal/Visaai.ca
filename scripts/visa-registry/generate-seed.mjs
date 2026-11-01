#!/usr/bin/env node
/**
 * Generate the visa-registry seed migration from verified official-source data.
 *
 * WHY A GENERATOR AND NOT HAND-WRITTEN SQL
 *
 * Every row in the registry asserts something about a government's rules, and
 * every such assertion has to be traceable to a page someone actually fetched.
 * Hand-written SQL breaks that link the moment anyone edits it: the URL in the
 * INSERT and the URL that was verified drift apart silently, and the
 * `source_version_id` on a requirement stops meaning "this came from there".
 *
 * So the JSON in data/official-sources/ is the input of record, this script is
 * the only thing that writes the seed, and re-running it against updated JSON
 * produces a new migration rather than an edit to an old one.
 *
 * WHAT IT REFUSES TO DO
 *
 * - It does not invent a slug, code, form number or URL. A null in the JSON
 *   becomes a NULL in the database.
 * - It does not emit a `visa_requirements` row. Requirements need the TEXT of
 *   a source version, which this dataset does not carry — only the URLs. The
 *   sync job fetches and extracts those, and a human approves them. Seeding
 *   requirements from URLs alone would be exactly the fabrication the spec
 *   forbids.
 * - It does not mark any country `supported`. Support means "verified data
 *   serving users"; these countries have verified SOURCES and no verified
 *   requirements yet, which is `preview`.
 *
 * Usage: node scripts/visa-registry/generate-seed.mjs > supabase/migrations/<ts>_visa_registry_seed.sql
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = resolve(here, '../../data/official-sources/priority-destinations.json');

const doc = JSON.parse(readFileSync(DATA, 'utf8'));

/** SQL string literal, or NULL. Never interpolate a raw value. */
const q = (v) => {
  if (v === null || v === undefined || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const qArr = (a) =>
  !a || a.length === 0
    ? "'{}'"
    : `array[${a.map((x) => q(x)).join(', ')}]::text[]`;

/**
 * Cap a value at the column's limit. Only used for free-text display fields
 * (official_name, purpose) where a long value is a long sentence, never for
 * identifiers — truncating a CODE would invent one.
 */
const truncate = (v, n) =>
  v === null || v === undefined ? v : String(v).length <= n ? v : `${String(v).slice(0, n - 1)}\u2026`;

/** URL-safe slug. Deterministic: the same official name always yields the same slug. */
const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * URL slugs for countries whose official long-form name makes a poor URL.
 *
 * The slug is VisaAI's choice of address, not a government fact, so shortening
 * it invents nothing: /visas/united-states is the form people type and link,
 * and /visas/united-states-of-america is 12 characters of nothing. The country's
 * `name` column still carries the full official name and is what renders.
 */
const SLUG_OVERRIDES = {
  US: 'united-states',
  GB: 'united-kingdom',
};

/**
 * The JSON's `visaai_category` values come from the pricing_visa_tiers seed and
 * do not all exist in the visa_types.category CHECK constraint. Mapping them
 * here — rather than widening the constraint — keeps the constraint meaningful:
 * a category is a bucket an authority actually issues in, not whatever a
 * pricing table happened to name.
 */
const CATEGORY_MAP = {
  visitor: 'visitor',
  tourist: 'eta', // maps to the travel authorisation (eTA/ESTA/ETA), not a visa
  business: 'business',
  student: 'student',
  work_permit: 'work',
  open_work_permit: 'work',
  family_sponsorship: 'family',
  permanent_residency: 'permanent_residence',
  express_entry: 'permanent_residence',
  investor: 'investor',
  startup: 'entrepreneur',
  digital_nomad: 'digital_nomad',
  citizenship: 'other',
  refugee_humanitarian: 'humanitarian',
  transit: 'transit',
  exchange: 'exchange',
  skilled_worker: 'skilled_worker',
  working_holiday: 'working_holiday',
};

/** Role of each URL we know about, so every source row says what the page IS. */
const URL_ROLES = [
  ['landing_url', 'landing'],
  ['eligibility_url', 'eligibility'],
  ['document_checklist_url', 'documents'],
  ['apply_url', 'application'],
  ['fee_page_url', 'fees'],
];

const out = [];
const w = (s = '') => out.push(s);

w(`-- Visa registry seed: verified official sources for the four priority destinations.`);
w(`--`);
w(`-- GENERATED FILE. Do not hand-edit.`);
w(`--   source: data/official-sources/priority-destinations.json`);
w(`--   generator: scripts/visa-registry/generate-seed.mjs`);
w(`--   dataset generated_at: ${doc.generated_at}`);
w(`--`);
w(`-- Every URL below returned HTTP 200 to a fetch on the dataset's generation`);
w(`-- date and lives on a government-owned domain. Nothing here is transcribed`);
w(`-- from a blog, an aggregator or a law firm.`);
w(`--`);
w(`-- WHAT THIS SEED DOES NOT DO:`);
w(`--   * No visa_requirements rows. A requirement must cite the TEXT of a`);
w(`--     source version; this dataset carries URLs, not page text. The sync`);
w(`--     job fetches and extracts, and a human approves, before any`);
w(`--     requirement exists. Seeding requirements from URLs alone would be`);
w(`--     fabrication.`);
w(`--   * No country is marked 'supported'. These have verified SOURCES and no`);
w(`--     verified requirements yet, which is exactly what 'preview' means.`);
w(`--`);
w(`-- Idempotent: re-running updates in place and never duplicates.`);
w('');
w(`begin;`);
w('');

let countryCount = 0;
let visaCount = 0;
let sourceCount = 0;
const seenSourceUrls = new Set();

for (const d of doc.destinations) {
  const code = d.country_code;
  const name = d.country_name;
  const auth = d.authorities ?? {};
  const imm = auth.immigration_authority ?? {};
  const fa = auth.foreign_affairs_authority ?? {};
  const portals = d.portals ?? {};
  const evisa = portals.evisa_or_travel_authorisation_portal ?? {};

  countryCount++;
  w(`-- ─── ${name} (${code}) ${'─'.repeat(Math.max(0, 56 - name.length))}`);
  w(`insert into public.visa_countries (
  code, is_bloc, name, slug, immigration_authority, immigration_authority_url,
  foreign_affairs_authority, foreign_affairs_authority_url,
  official_visa_url, evisa_portal_url, official_languages,
  support_state, data_quality, last_verified_at
) values (
  ${q(code)}, false, ${q(name)}, ${q(SLUG_OVERRIDES[code] ?? slugify(name))},
  ${q(imm.official_name)}, ${q(imm.root_url)},
  ${q(fa.official_name)}, ${q(fa.root_url)},
  ${q(portals.visa_options_index_url)}, ${q(evisa.url)},
  ${qArr(['en'])},
  'preview', 'verified', ${q(doc.generated_at)}::timestamptz
)
on conflict (code) do update set
  name = excluded.name,
  slug = excluded.slug,
  immigration_authority = excluded.immigration_authority,
  immigration_authority_url = excluded.immigration_authority_url,
  foreign_affairs_authority = excluded.foreign_affairs_authority,
  foreign_affairs_authority_url = excluded.foreign_affairs_authority_url,
  official_visa_url = excluded.official_visa_url,
  evisa_portal_url = excluded.evisa_portal_url,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;`);
  w('');

  for (const v of d.visa_types ?? []) {
    const category = CATEGORY_MAP[v.visaai_category] ?? 'other';

    /**
     * `official_code` is a SINGLE code and the column caps it at 64 chars.
     * Some routes do not have one: the US family route's "code" in the source
     * data is the list "IR1, CR1, F1, F2A, F2B, F3, F4", which is seven codes,
     * not one. Truncating it would mint a code the government never issued, so
     * an over-long or multi-valued code becomes NULL and the individual codes
     * become searchable aliases instead. A missing code is a fact; a fabricated
     * one is a defect.
     */
    const rawCode = v.official_code ?? null;
    const codeIsSingular =
      rawCode !== null && rawCode.length <= 64 && !/[,;]/.test(rawCode);
    const officialCode = codeIsSingular ? rawCode : null;
    const codeAliases =
      rawCode && !codeIsSingular
        ? rawCode
            .replace(/\(.*?\)/g, '')
            .split(/[,;]/)
            .map((x) => x.trim())
            .filter((x) => x && x.length <= 64)
        : [];
    // Slug from the official name, so the public URL reflects what the
    // government calls it rather than VisaAI's internal bucket.
    const slug = slugify(v.official_name ?? v.visaai_category);
    if (!slug) continue;
    const visaaiId = `${code.toLowerCase()}-${slug}`.slice(0, 80);
    visaCount++;

    w(`insert into public.visa_types (
  country_id, visaai_id, category, official_name, official_code, slug,
  aliases, purpose, lifecycle_state, data_quality, last_verified_at
) values (
  (select id from public.visa_countries where code = ${q(code)}),
  ${q(visaaiId)}, ${q(category)}, ${q(truncate(v.official_name, 250))}, ${q(officialCode)},
  ${q(slug)}, ${qArr([v.visaai_category, ...codeAliases].filter(Boolean))},
  ${q(v.application_method ? `Applied ${v.application_method}.` : null)},
  'active', 'verified', ${q(doc.generated_at)}::timestamptz
)
on conflict (visaai_id) do update set
  category = excluded.category,
  official_name = excluded.official_name,
  official_code = excluded.official_code,
  aliases = excluded.aliases,
  data_quality = excluded.data_quality,
  last_verified_at = excluded.last_verified_at;`);

    for (const [key, role] of URL_ROLES) {
      const url = v[key];
      if (!url) continue;
      // visa_sources has a UNIQUE index on source_url. One government page can
      // legitimately serve two roles (Canada's eligibility page is shared
      // across visa types); the first insert wins and the ON CONFLICT keeps it
      // current rather than erroring the whole migration.
      // Keyed by (url, visa type), matching visa_sources_url_per_type_idx.
      // A global URL dedup silently left five visa types with zero sources,
      // because one authority page routinely covers several visas.
      const sourceKey = `${visaaiId}|${url}`;
      if (seenSourceUrls.has(sourceKey)) continue;
      seenSourceUrls.add(sourceKey);
      sourceCount++;
      w(`insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = ${q(code)}),
  (select id from public.visa_types where visaai_id = ${q(visaaiId)}),
  ${q(role)}, ${q(imm.official_name ?? name)}, 1,
  ${q(url)}, ${q(url)}, 'en', true, ${q(doc.generated_at)}::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  role = excluded.role,
  authority = excluded.authority,
  last_success_at = excluded.last_success_at;`);
    }

    for (const f of v.forms ?? []) {
      const formKey = `${visaaiId}|${f?.url}`;
      if (!f?.url || seenSourceUrls.has(formKey)) continue;
      seenSourceUrls.add(formKey);
      sourceCount++;
      w(`insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, title, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = ${q(code)}),
  (select id from public.visa_types where visaai_id = ${q(visaaiId)}),
  'forms', ${q(imm.official_name ?? name)}, 1,
  ${q(f.url)}, ${q(f.url)},
  ${q([f.identifier, f.official_name].filter(Boolean).join(' — ') || null)},
  'en', true, ${q(doc.generated_at)}::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do update set
  title = excluded.title,
  last_success_at = excluded.last_success_at;`);
    }
    w('');
  }
}

// Country-level index pages: the authority's own "find a visa" entry points.
for (const d of doc.destinations) {
  const portals = d.portals ?? {};
  const imm = d.authorities?.immigration_authority ?? {};
  const urls = [
    portals.visa_options_index_url,
    ...(portals.secondary_index_urls ?? []),
  ].filter(Boolean);
  for (const url of urls) {
    const countryKey = `country|${url}`;
    if (seenSourceUrls.has(countryKey)) continue;
    seenSourceUrls.add(countryKey);
    sourceCount++;
    w(`insert into public.visa_sources (
  country_id, visa_type_id, role, authority, authority_rank,
  canonical_url, source_url, language, active, last_success_at
) values (
  (select id from public.visa_countries where code = ${q(d.country_code)}),
  null, 'index', ${q(imm.official_name ?? d.country_name)}, 1,
  ${q(url)}, ${q(url)}, 'en', true, ${q(doc.generated_at)}::timestamptz
)
on conflict (source_url, coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)) do nothing;`);
  }
}

w('');
w(`commit;`);
w('');
w(`-- Seeded: ${countryCount} countries, ${visaCount} visa types, ${sourceCount} official sources.`);

process.stdout.write(out.join('\n') + '\n');
