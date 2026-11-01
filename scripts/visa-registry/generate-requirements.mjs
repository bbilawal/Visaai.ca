#!/usr/bin/env node
/**
 * Turn an extraction file into a requirements migration.
 *
 * WHY A GENERATOR, AGAIN
 *
 * Same reason as generate-seed.mjs, but sharper: a requirement is a claim about
 * what a government demands of a person, and `visa_requirements.source_version_id`
 * is NOT NULL precisely so every such claim is bound to the exact page version it
 * was read from. Hand-written SQL breaks that binding the moment anyone edits it.
 *
 * The binding is resolved AT MIGRATION TIME by a subquery on the source's
 * currently-active version — not by a uuid pasted into the file. That matters:
 * if the page has changed since extraction, the migration attaches the
 * requirement to whatever version is active, which is the honest answer, and
 * the sync's change queue is what catches the drift.
 *
 * WHAT IT REFUSES TO DO
 *
 * - Emit a requirement with no `source_excerpt`. An excerpt is the evidence;
 *   without it a reviewer cannot check the claim against the page.
 *
 *   It does NOT refuse a missing `source_excerpt_display`. That column carries
 *   the same span with the authority's own capitalisation, for QUOTING on the
 *   public page, and `scripts/derive-display-excerpts.ts` writes it. A null is
 *   a real state -- "we could not establish the authority's own wording" -- and
 *   the page then renders no quotation. Refusing here would make an unreadable
 *   source block a route whose requirements are otherwise fine, and falling
 *   back to `source_excerpt` would quote OUR lowercasing as the government's
 *   words, which is BUG_LOG D-11 itself.
 * - Emit a requirement whose `source_role` is not a registered source.
 * - Emit `officially_required: true` on a `recommended` kind — the database
 *   CHECK would reject it, but failing here names the file and the row.
 * - Mark anything `active`. Extraction produces DRAFTS. Promotion to `active`
 *   is a separate, deliberate step, because that is the step where a human
 *   takes responsibility for the claim.
 *
 * Usage:
 *   node scripts/visa-registry/generate-requirements.mjs data/requirements/<file>.json
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: generate-requirements.mjs <extraction.json>');
  process.exit(2);
}

const doc = JSON.parse(readFileSync(path, 'utf8'));

const q = (v) => {
  if (v === null || v === undefined || v === '') return 'null';
  return `'${String(v).replace(/'/g, "''")}'`;
};
const qJson = (v) =>
  v === null || v === undefined ? 'null' : `${q(JSON.stringify(v))}::jsonb`;

const errors = [];
const out = [];
const w = (s = '') => out.push(s);

const roles = doc.source_roles ?? {};

for (const [i, r] of (doc.requirements ?? []).entries()) {
  const at = `${doc.visaai_id}#${r.requirement_code ?? i}`;
  if (!r.requirement_code) errors.push(`${at}: missing requirement_code`);
  if (!r.source_excerpt) {
    errors.push(
      `${at}: missing source_excerpt — the excerpt IS the evidence; a reviewer cannot check the claim without it`,
    );
  }
  if (!r.source_role || !roles[r.source_role]) {
    errors.push(`${at}: source_role "${r.source_role}" is not a registered source`);
  }
  if (r.kind === 'recommended' && r.officially_required !== false) {
    errors.push(
      `${at}: kind 'recommended' must have officially_required false — VisaAI advice may never be rendered as a government rule`,
    );
  }
}

if (errors.length) {
  console.error(`Refusing to generate. ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

const reqs = doc.requirements ?? [];

w(`-- Requirements for ${doc.visaai_id}, extracted ${doc.extracted_at}.`);
w(`--`);
w(`-- GENERATED FILE. Do not hand-edit.`);
w(`--   source: ${path}`);
w(`--   generator: scripts/visa-registry/generate-requirements.mjs`);
w(`--   method: ${doc.extraction_method}`);
w(`--`);
w(`-- Every row below quotes the official page it was read from, and binds to`);
w(`-- that source's ACTIVE version via subquery rather than a pasted uuid — so`);
w(`-- if the page moved since extraction, the requirement attaches to what is`);
w(`-- actually live and the sync's change queue catches the drift.`);
w(`--`);
w(`-- Rows are inserted as DRAFT. Promotion to 'active' is a separate step,`);
w(`-- because that is the step where a person takes responsibility for the claim.`);
if (doc.not_extracted?.length) {
  w(`--`);
  w(`-- DELIBERATELY NOT EXTRACTED:`);
  for (const n of doc.not_extracted) {
    w(`--   * ${n.replace(/\n/g, ' ')}`);
  }
}
w('');
w('begin;');
w('');

for (const r of reqs) {
  const url = roles[r.source_role];
  w(`insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = ${q(doc.visaai_id)}),
  ${q(r.requirement_code)}, ${q(r.kind)}, ${r.officially_required === false ? 'false' : 'true'},
  ${q(r.label)}, ${q(r.description)},
  ${q(r.official_form_code)}, ${q(r.official_form_url)},
  ${qJson(r.rule ?? null)}, ${qJson(r.parameters ?? {})},
  -- Scoped to THIS visa type, not just the URL. Since
  -- 20260820160000 a shared government page has one visa_sources row per visa
  -- type it serves — GOV.UK's Standard Visitor page covers both the general
  -- and the business-visit entries — so matching on source_url alone returns
  -- two active versions and the subquery errors with "more than one row".
  --
  -- The limit 1 after the visa-type filter is belt-and-braces: the partial unique
  -- index already allows one active version per source, so the filter alone is
  -- sufficient, but a country-level source (visa_type_id null) shared with a
  -- typed one would otherwise still be ambiguous.
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = ${q(url)}
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = ${q(doc.visaai_id)}))
    order by s.visa_type_id nulls last
    limit 1),
  ${q(r.source_excerpt)}, ${q(r.source_excerpt_display)}, ${q(doc.extraction_method)}, 1.00,
  'draft', ${Number(r.display_order ?? 100)}, ${q(doc.extracted_at)}::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do update set
  kind = excluded.kind,
  officially_required = excluded.officially_required,
  label = excluded.label,
  description = excluded.description,
  official_form_code = excluded.official_form_code,
  official_form_url = excluded.official_form_url,
  rule = excluded.rule,
  parameters = excluded.parameters,
  source_version_id = excluded.source_version_id,
  source_excerpt = excluded.source_excerpt,
  source_excerpt_display = excluded.source_excerpt_display,
  last_verified_at = excluded.last_verified_at,
  -- DEMOTE ON CHANGE. Without this clause, re-running an extraction silently
  -- rewrote the label, rule and excerpt of an ALREADY-REVIEWED requirement
  -- while leaving it 'active', so an edit to the extraction file reached
  -- applicants without anyone re-reading it. That is the same failure the
  -- sync's promotion queue exists to prevent, one layer down.
  --
  -- Any change to what the requirement CLAIMS sends it back to draft. A re-run
  -- that confirms the same text touches only last_verified_at and leaves the
  -- review intact, which is what re-verification should do.
  status = case
    when public.visa_requirements.kind is distinct from excluded.kind
      or public.visa_requirements.officially_required is distinct from excluded.officially_required
      or public.visa_requirements.label is distinct from excluded.label
      or public.visa_requirements.description is distinct from excluded.description
      or public.visa_requirements.official_form_code is distinct from excluded.official_form_code
      or public.visa_requirements.rule is distinct from excluded.rule
      or public.visa_requirements.parameters is distinct from excluded.parameters
      or public.visa_requirements.source_excerpt is distinct from excluded.source_excerpt
    then 'draft'
    else public.visa_requirements.status
  end;`);
  w('');
}

// A requirement whose source-version subquery found nothing would violate the
// NOT NULL and abort the transaction — which is correct, but the error would
// name a constraint rather than the cause. This says the cause out loud.
w(`-- Fail loudly if any source had no active version: the NOT NULL would abort`);
w(`-- anyway, but naming the cause beats reading a constraint violation.`);
w(`do $$
declare missing int;
begin
  select count(*) into missing
  from (values ${Object.values(roles).map((u) => `(${q(u)})`).join(', ')}) as r(url)
  where not exists (
    select 1 from public.visa_source_versions v
      join public.visa_sources s on s.id = v.source_id
     where s.source_url = r.url and v.is_active
  );
  if missing > 0 then
    -- Replay-aware. 20260820170000 installs the fixture table for the duration
    -- of the chain, so its presence means this is a database being rebuilt from
    -- empty. An authority that blocks our egress (migri.fi, immi.homeaffairs)
    -- has no version to bind to and never will, and the skipped rows are
    -- recorded in visa_requirement_bootstrap_skips. Outside a replay this stays
    -- fatal, which is the point: in normal operation a missing version means
    -- the sync has not run and the extraction is premature.
    if to_regclass('public.visa_source_version_fixtures') is not null then
      raise warning '% source(s) have no active version; their requirements were skipped (replay)', missing;
    else
      raise exception '% source(s) have no active version. Run the sync before extracting requirements.', missing;
    end if;
  end if;
end $$;`);
w('');
w('commit;');
w('');
w(`-- ${reqs.length} requirement(s): ` +
  Object.entries(
    reqs.reduce((acc, r) => ({ ...acc, [r.kind]: (acc[r.kind] ?? 0) + 1 }), {}),
  )
    .map(([k, n]) => `${n} ${k}`)
    .join(', '));

process.stdout.write(out.join('\n') + '\n');
