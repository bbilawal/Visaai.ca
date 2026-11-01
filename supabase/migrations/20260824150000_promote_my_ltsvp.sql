-- Promote Malaysia's Long-Term Social Visit Pass: 22 requirements.
-- Malaysia reaches 2 published pages; the registry reaches 58.
--
-- A FAMILY PASS THAT LETS YOU WORK WITHOUT CONVERTING
--
-- "the pass holder is permitted to work, engage in business, or undertake
-- professional employment without the need to convert to an employment pass or
-- visit pass (temporary employment)."
--
-- Every other family route in this registry either bars work outright or routes
-- the holder to a separate work pass. Singapore's Dependant's Pass -- promoted
-- earlier in this same run -- is the sharp comparison: a DP holder who wants to
-- work needs an Employment Pass, an S Pass or a DP-Work Permit, the EMPLOYER
-- applies, and obtaining an EP CANCELS the dependency. Malaysia endorses the
-- permission onto the pass the spouse already holds.
--
-- Registering the two in one run is what makes that comparable. Neither
-- authority mentions the other, and "can a spouse work?" has four different
-- answers across this registry depending on which pass they hold.
--
-- IT IS STILL A SEPARATE ENDORSEMENT, WITH A SPECIFIC CONTRACT
--
-- A job offer on company letterhead, an employment contract stamped with an
-- RM10 revenue stamp stating position, duration, monthly salary AND both
-- signatures, a tripartite information form, an SSM extract printed from MyData
-- -- and the application lodged BY THE APPLICANT IN PERSON WITH THE MALAYSIAN
-- SPOUSE.
--
-- NAZIRAN: AN AUTHORITY PUBLISHING ITS OWN INSPECTION REGIME
--
-- Address visits, observation, interviews with relevant parties, review of
-- submitted documents -- and the findings feed into approval and extension
-- decisions. No other authority in this registry publishes its post-grant
-- inspection practice on the route page, and holding the pass is not the end of
-- the process. Stored as a condition, not as background.
--
-- CHILDREN OF CITIZENS: UNDER SEVEN
--
-- No counterpart anywhere else here. Singapore's Dependant's Pass runs to 21,
-- Ireland's and Norway's family routes to 18. Malaysia stops at 7, and the
-- citizen parent must lodge the application.
--
-- THE DOUBLED PAGE, HANDLED BY THE METHOD
--
-- Two blocks state the work rules in different words. Diffed first: they are
-- near-duplicates with no selector between them, most likely an English
-- rendering beside a translated one. So NO bound is declared -- a bound implies
-- the blocks are different routes -- and each requirement quotes the block its
-- own wording came from rather than mixing the two.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-24'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'my-long-term-social-visit-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
where t.visaai_id = 'my-long-term-social-visit-pass'
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

-- The work-without-converting rule is why this route is here, and the under-7
-- ceiling is its sharpest edge. Assert both survived with the parameters that
-- make them legible, and that Malaysia now publishes two pages.
do $$
declare pages int; work_rule int; child_age int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'MY';
  if pages <> 2 then raise exception 'Expected 2 publishable Malaysian pages, found %.', pages; end if;

  select count(*) into work_rule from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-long-term-social-visit-pass'
     and r.requirement_code = 'work_without_converting'
     and r.status = 'active'
     and r.source_excerpt like '%without the need to convert to an employment pass%';
  if work_rule <> 1 then
    raise exception 'The work-without-converting rule is missing or its excerpt changed.';
  end if;

  select (r.parameters ->> 'max_age_years')::int into child_age
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-long-term-social-visit-pass'
     and r.requirement_code = 'children_of_citizens_under_seven';
  if child_age is distinct from 7 then
    raise exception 'The child age ceiling is %, expected 7.', child_age;
  end if;
end $$;

commit;
