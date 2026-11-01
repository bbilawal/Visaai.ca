-- One official page can serve several visa types.
--
-- THE DEFECT, found by the generated coverage matrix
--
-- 20260820120000 declared `create unique index visa_sources_url_idx on
-- public.visa_sources (source_url)` — one row per URL, globally. That encodes
-- an assumption that is simply false about how governments publish:
--
--   * IRCC's eligibility page covers the visitor visa AND business visitors.
--   * The Home Affairs subclass 600 page covers the Tourist stream AND the
--     Business visitor stream.
--   * GOV.UK's Standard Visitor page covers tourism, business and study visits.
--
-- With a global unique index, the first visa type to claim a URL got the
-- source row and every later one silently got nothing. The coverage matrix
-- reported five visa types as "FAILED — No official source is registered",
-- including Canada's Business visitors, whose sources plainly exist and were
-- verified — they were just already spoken for.
--
-- That is the worst kind of data bug: it does not error, it under-reports, and
-- the under-report looks like a real gap in the product.
--
-- THE FIX
--
-- The unique key is (source_url, visa_type_id): the same page may appear once
-- per visa type it serves, plus once at country level.
--
-- COALESCE is needed because PostgreSQL treats NULLs as distinct in a unique
-- index, so a plain two-column index would let the same country-level URL be
-- inserted repeatedly. The sentinel uuid is never a real visa_types.id (that
-- column defaults to gen_random_uuid(), which never produces all-zeroes), so
-- it collides with nothing.

drop index if exists public.visa_sources_url_idx;

create unique index if not exists visa_sources_url_per_type_idx
  on public.visa_sources (
    source_url,
    coalesce(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on table public.visa_sources is
  'Registry of official government pages VisaAI monitors. One row per '
  '(source_url, visa_type_id): a single authority page frequently covers '
  'several visa types, and a country-level row (visa_type_id null) covers the '
  'authority index pages. Every visa requirement must cite a version of one of '
  'these rows. authority_rank 1-5 are all government sources; third-party '
  'sites are not permitted here.';
