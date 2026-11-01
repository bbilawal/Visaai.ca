-- Promote Hong Kong's IANG: 13 requirements.
-- Hong Kong reaches 3 published pages; the registry reaches 61.
--
-- SIX MONTHS FROM GRADUATION DECIDES WHETHER YOU NEED A JOB
--
--   * Within six months of the date on your graduation certificate:
--     "not required to have secured an offer of employment upon application",
--     24 months' stay, no employment condition.
--   * Beyond six months: "required to secure an offer of employment upon
--     application" -- and the job must be at a level commonly taken up by
--     degree holders, at market remuneration.
--
-- Same person, same degree, same 24 months if granted. A day's difference in
-- when the form is filed changes the requirement from nothing to a graduate-
-- level job offer.
--
-- This is the SECOND deadline in this registry whose consequence is invisible
-- until it has passed. Ireland's pre-marriage LTVP assessment was the first --
-- six weeks instead of six months, decided before the wedding. Both are
-- decisions taken by people with no reason yet to be reading immigration pages,
-- and both are the reason a visa product exists rather than a link to a
-- government website.
--
-- So the six-month rule renders FIRST among the conditions, and the migration
-- asserts it: a graduate who reads "you need a job offer" three bullets in has
-- already lost the thing this page could have told them.
--
-- A 2x2, STORED AS FOUR ROWS
--
--                        | recent (<= 6 months) | non-recent (> 6 months)
--   non-local graduate   | no offer needed      | offer needed
--   GBA campus graduate  | no offer needed      | offer needed
--
-- GBA campus graduates -- from mainland Greater Bay Area campuses jointly
-- established with Hong Kong universities -- are a distinct population under
-- the same rule. Folding them into the non-local rows would hide who the route
-- is open to, and the Department writes them out separately for that reason.
--
-- AND THE CLOCK CAN BE BEATEN WITHOUT THE CERTIFICATE
--
-- "non-local recent graduates who have not yet obtained their graduation
-- certificate could apply to stay and work by producing proof from the
-- institution confirming that they have graduated." Only useful to somebody who
-- knows the clock is running, which is the whole argument for storing it.
--
-- WHAT IS DELIBERATELY ABSENT
--
-- What counts as "a level commonly taken up by degree holders" or "market
-- level" remuneration. The Department states both as standards and publishes no
-- threshold. Inventing one would be the most tempting and least defensible
-- number on this route.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-24'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'hk-non-local-graduates' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
where t.visaai_id = 'hk-non-local-graduates'
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

-- The six-month rule must render before the two rules that depend on it, and
-- all four cells of the 2x2 must survive. A missing cell silently narrows who
-- the route is open to.
do $$
declare pages int; six int; first_dep int; cells int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'HK';
  if pages <> 3 then raise exception 'Expected 3 publishable Hong Kong pages, found %.', pages; end if;

  select display_order into six from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-non-local-graduates' and r.requirement_code = 'six_month_line_defines_recent';

  select min(display_order) into first_dep from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-non-local-graduates'
     and r.requirement_code in ('recent_graduate_no_offer_needed',
                                'non_recent_graduate_offer_required',
                                'gba_recent_no_offer_needed',
                                'gba_non_recent_offer_required');

  if six is null or first_dep is null or six >= first_dep then
    raise exception 'The six-month rule (%) must render before the rules it decides (first at %).',
      six, first_dep;
  end if;

  select count(*) into cells from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'hk-non-local-graduates' and r.status = 'active'
     and r.requirement_code in ('recent_graduate_no_offer_needed',
                                'non_recent_graduate_offer_required',
                                'gba_recent_no_offer_needed',
                                'gba_non_recent_offer_required');
  if cells <> 4 then raise exception 'Expected all 4 cells of the recent/non-recent matrix, found %.', cells; end if;
end $$;

commit;
