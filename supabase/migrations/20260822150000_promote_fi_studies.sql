-- Promote Finland's residence permit for studies: 22 requirements. Finland
-- reaches 2 published pages; the registry reaches 41.
--
-- ONE APPLICATION, TWO DIFFERENT PERMITS COME OUT OF IT
--
-- Migri grants an A permit (continuous) for a higher education degree and a B
-- permit (temporary) for anything else -- exchange students always get a B.
-- This is NOT an eligibility condition: the same application, the same fee and
-- the same evidence lead to either. It is stored as an outcome and marked not
-- officially required, because presenting it as a requirement would suggest the
-- applicant chooses it. It matters anyway: a B permit carries no right to study
-- in another EU member state.
--
-- THE MONEY RULE IS TWO FIGURES, AND MISSING THE SECOND ONE IS FATAL
--
--   * EUR 800 per month is the standard.
--   * EUR 9,600 must be IN THE ACCOUNT at submission for a course of a year or
--     more -- and if the tuition fee is unpaid, its money must be there TOO, on
--     top, not instead.
--   * The bank statement must cover six months, so a single deposit made before
--     applying does not satisfy it.
--
-- An applicant who reads only the monthly figure will fund the wrong thing.
--
-- A NORMALIZER ARTEFACT AVOIDED RATHER THAN QUOTED
--
-- In the attachment list, markup splits "certificate of insurance" into
-- "certificate of insuranc e". Quoting it verbatim would pass excerpt
-- verification and print a typo on a live page; paraphrasing would break the
-- verbatim rule. So the attachment excerpt stops before that item and the
-- insurance obligation is quoted from the numbered requirement block, where
-- Migri states it in whole words. Verbatim and legible were both achievable
-- here by choosing WHICH sentence to quote.
--
-- OTHER THINGS EASY TO GET WRONG:
--   * Mainly-online study cannot support this permit at all, whatever the
--     institution.
--   * Basic education is excluded outright.
--   * The 30-hour work right is a YEARLY average -- 120 hours a month, 1,560 a
--     year -- and both the student and the employer are responsible for it.
--   * There is a separate, lower fee where the permit holder is a minor. A
--     family reading the adult figure would over-budget.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'fi-residence-permit-studies' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'fi-residence-permit-studies'
  and exists (select 1 from public.visa_requirements r
              where r.visa_type_id = t.id and r.status = 'active');

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

do $$
declare pages int; general int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'FI';
  -- Replay guard. Finland has never been fetched from production egress -- migri.fi
  -- WAF-challenges the VPS, 403 on everything including robots.txt -- so this
  -- promotion failed in production too, and 20260826300000 records the result:
  -- 5 visa types, 12 sources, 0 versions, 0 requirements, support_state 'preview'.
  -- On a database replaying the chain from empty the same is true, and stopping
  -- the whole chain over it helps nobody. Outside a replay (no fixture table)
  -- this stays fatal.
  if pages <> 2 then if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected 2 publishable Finnish pages, found %. (replay: Finland has never been fetched)', pages; else raise exception 'Expected 2 publishable Finnish pages, found %.', pages; end if; end if;

  select count(*) into general
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  join public.visa_source_versions v on v.id = r.source_version_id
  join public.visa_sources s on s.id = v.source_id
  where t.visaai_id = 'fi-residence-permit-studies' and r.status = 'active' and s.role = 'eligibility';
  if general <> 6 then
    if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected 6 requirements bound to the general-requirements page, found %. (replay: Finland has never been fetched)', general; else raise exception 'Expected 6 requirements bound to the general-requirements page, found %.', general; end if;
  end if;
end $$;

commit;
