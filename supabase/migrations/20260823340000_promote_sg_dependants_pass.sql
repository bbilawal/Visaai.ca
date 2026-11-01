-- Promote Singapore's Dependant's Pass: 20 requirements.
-- Singapore reaches 5 published pages; the registry reaches 53.
-- First `dependant` route in the registry.
--
-- $6,000 IS ABOVE THE PASS THAT QUALIFIES FOR IT
--
-- The Employment Pass floor starts at $5,600 a month at age 23 or below. The
-- Dependant's Pass needs the EP holder to earn $6,000. An Employment Pass
-- holder at the bottom of MOM's own salary schedule holds a valid pass and
-- cannot bring a spouse.
--
-- Neither page mentions the other. The gap is only visible with both numbers in
-- one place, which is what a registry is for, and it exists tonight because
-- sg-employment-pass was extracted a few hours earlier.
--
-- AND MOM SAYS OUT LOUD THAT IT IS NOT A HOUSEHOLD TEST
--
-- "this is based on your salary, and not based on your combined household
-- income." Ireland's family reunification route established that a couple
-- cannot combine incomes to clear a threshold. Singapore goes further: the test
-- is on the WORK PASS HOLDER alone, so a dependant who works and earns adds
-- nothing to it.
--
-- THE PASS EXPIRES WHEN SOMEBODY ELSE'S DOES
--
-- "the duration is tied to the validity of the main work pass". That is the
-- mechanism behind the Student's Pass rule promoted earlier tonight: a child
-- studying on a Dependant's Pass must apply for their own Student's Pass, on
-- the prevailing criteria, if the parent's pass lapses mid-course. Two routes,
-- one consequence, and it is only legible with both registered.
--
-- THE LETTER OF CONSENT IS GONE
--
-- The widely repeated belief is that a Dependant's Pass holder may work on a
-- Letter of Consent. MOM's page routes them to an Employment Pass, an S Pass or
-- a DP-Work Permit, and in every case the prospective EMPLOYER applies. Getting
-- an EP or S Pass ENDS the dependency: "they will need to have their dp
-- cancelled before their ep or s pass is issued". The better outcome removes
-- the fallback. The DP-Work Permit keeps it -- tied to the DP, no minimum
-- qualifying salary, any nationality -- at the employer's cost in quota and
-- levy.
--
-- ONE EXCLUSION DECIDED MONTHS EARLIER
--
-- Families of EP holders who applied as an overseas intra-corporate transferee
-- under WTO GATS or an FTA get neither a Dependant's Pass nor a Long-Term Visit
-- Pass, absent a specific FTA. Nothing the family does affects it; the choice
-- was made on the worker's own application.
--
-- FEES ARE PER PASS, NOT PER FAMILY
--
-- $105 to apply and $225 to issue, each, per person. A spouse and two children
-- is $315 then $675. Stored with `per: pass` so a checklist cannot render it as
-- one household charge.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-dependants-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-dependants-pass'
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

-- The whole point of this route is that the salary test is somebody else's and
-- is NOT a household test. Assert the parameters that say so survived, and
-- assert the gap against the Employment Pass floor is still real -- if MOM ever
-- aligns the two numbers, the commentary above stops being true and somebody
-- should have to notice.
do $$
declare pages int; dp numeric; ep numeric; hh boolean;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 5 then raise exception 'Expected 5 publishable Singaporean pages, found %.', pages; end if;

  select (r.parameters ->> 'amount')::numeric, (r.parameters ->> 'household_income_counted')::boolean
    into dp, hh
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-dependants-pass' and r.requirement_code = 'sponsor_salary_6000_not_household';
  if dp is distinct from 6000 then raise exception 'Dependant''s Pass salary parameter is %, expected 6000.', dp; end if;
  if hh is distinct from false then raise exception 'household_income_counted must be false, got %.', hh; end if;

  select (r.parameters ->> 'min_all_sectors')::numeric into ep
    from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-employment-pass' and r.requirement_code = 'ep_qualifying_salary_current';
  if ep is null then raise exception 'Employment Pass salary floor not found — cannot check the gap.'; end if;
  if ep >= dp then
    raise exception 'The EP floor (%) now meets the DP threshold (%) — the documented gap is gone; re-read both pages.', ep, dp;
  end if;
end $$;

commit;
