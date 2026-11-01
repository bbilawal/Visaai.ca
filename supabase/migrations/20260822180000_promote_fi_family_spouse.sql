-- Promote Finland's spouse family-ties permit: 25 requirements. Finland reaches
-- 3 published pages; the registry reaches 42.
--
-- ONE PAGE, TWO LEGAL REGIMES, AND THE OLDER ONE IS STILL PRINTED IN FULL
--
-- Migri publishes "permit requirements for applications submitted before
-- 16 june 2025" and "...on or after 16 june 2025" as two complete numbered
-- lists on the same URL. Requirements 1, 2 and the income requirement are
-- WORD-FOR-WORD IDENTICAL between them. verify-extraction-bounds reports two of
-- these excerpts as appearing verbatim outside the bound as well -- they are
-- correct only because the bound says which block they came from.
--
-- This is UDI's concatenation trap in a worse form. There the sibling blocks
-- were different ROUTES; here they are the same route at two different TIMES,
-- and nothing in the wording of an individual sentence marks which regime it
-- belongs to. Extracting the superseded block would have produced a checklist
-- that is verbatim, provenance-complete, and no longer the law.
--
-- The rule that separates them is requirement 3: both spouses must be at least
-- 21. It is an age at VALIDITY, not at application -- the application may be
-- filed 9 months early, or 3 where the spouse holds a study permit -- and joint
-- custody of a child lifts it entirely.
--
-- WHY THE FEE COMES FROM A DIFFERENT PAGE
--
-- The spouse page states its own fee, but that line sits ABOVE both regime
-- blocks and therefore outside the bound. Widening the bound to reach it would
-- have readmitted the superseded regime. The fee is taken from Migri's
-- decree-based schedule instead, which is the better source anyway.
--
-- THE INCOME REQUIREMENT IS NET, AND REGIONAL
--
-- EUR 1,210/month for one adult in the Helsinki metropolitan area, EUR 1,090 in
-- 24 named large municipalities, EUR 1,030 elsewhere -- all NET of tax and of
-- pension and insurance contributions, so a gross salary comfortably above a
-- threshold can still fail it. Migri stamps the table "as of 1 november 2024";
-- that is when the figures took effect and it is stored as in_force_since, not
-- read as the page's age.
--
-- OTHER THINGS EASY TO GET WRONG:
--   * The spouse need not already hold the permit -- both may apply at the same
--     time, which is the difference between relocating together and waiting.
--   * Form LIITE_PUOLISO must be completed and signed by the SPOUSE. The
--     applicant cannot finish this application alone.
--   * Copies of BOTH passports' data and annotated pages are required, not only
--     the applicant's.
--   * Prior-marriage certificates are required for either spouse's history, not
--     only the applicant's.
--   * Some benefits DO count toward income -- child benefit, child care and
--     maintenance allowance, study grant, housing allowance -- and a family
--     reading only the exclusion list would undercount its own resources.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'fi-family-spouse' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'fi-family-spouse'
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

-- All four pages must actually be carrying requirements. If any one silently
-- failed to bind, the page would still render and look complete.
do $$
declare pages int; r record;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'FI';
  -- Replay guard. Finland has never been fetched from production egress -- migri.fi
  -- WAF-challenges the VPS, 403 on everything including robots.txt -- so this
  -- promotion failed in production too, and 20260826300000 records the result:
  -- 5 visa types, 12 sources, 0 versions, 0 requirements, support_state 'preview'.
  -- On a database replaying the chain from empty the same is true, and stopping
  -- the whole chain over it helps nobody. Outside a replay (no fixture table)
  -- this stays fatal.
  if pages <> 3 then if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected 3 publishable Finnish pages, found %. (replay: Finland has never been fetched)', pages; else raise exception 'Expected 3 publishable Finnish pages, found %.', pages; end if; end if;

  for r in
    select s.role, count(*) as n
    from public.visa_requirements q
    join public.visa_types t on t.id = q.visa_type_id
    join public.visa_source_versions v on v.id = q.source_version_id
    join public.visa_sources s on s.id = v.source_id
    where t.visaai_id = 'fi-family-spouse' and q.status = 'active'
    group by s.role
  loop
    raise notice 'fi-family-spouse: % requirements from role %', r.n, r.role;
  end loop;

  if (select count(distinct s.role)
      from public.visa_requirements q
      join public.visa_types t on t.id = q.visa_type_id
      join public.visa_source_versions v on v.id = q.source_version_id
      join public.visa_sources s on s.id = v.source_id
      where t.visaai_id = 'fi-family-spouse' and q.status = 'active') <> 4 then
    if to_regclass('public.visa_source_version_fixtures') is not null then raise warning 'Expected active requirements from all 4 source roles. (replay: Finland has never been fetched)'; else raise exception 'Expected active requirements from all 4 source roles.'; end if;
  end if;
end $$;

commit;
