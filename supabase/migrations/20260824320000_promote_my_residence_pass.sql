-- Promote Malaysia's Residence Pass: 20 requirements.
-- Malaysia reaches 3 published pages; the registry reaches 63.
--
-- THE SPONSOR'S STATE OF ORIGIN IS A CONDITION
--
--   "applications in west malaysia must be sponsored by a malaysia citizen;
--    applications in sabah and sarawak must be sponsored by a malaysian citizen
--    of sabah or sarawak origin;"
--
-- Not a documentary variation. A DIFFERENT SPONSOR. A Malaysian citizen from
-- Kuala Lumpur cannot sponsor a Residence Pass application made in Sabah.
--
-- Sabah and Sarawak administer their own immigration under the Malaysia
-- Agreement, and every route in this registry that touches them so far has
-- expressed that as extra paperwork -- the Student's Pass adds three Sarawak
-- documents. This is the first time it changes WHO QUALIFIES: the same national
-- citizenship works or does not depending on where the applicant is standing.
--
-- THREE YEARS FOR A CITIZEN'S FAMILY, FIVE FOR A PERMANENT RESIDENT'S
--
-- Category 3 needs three years' residence on a valid long-term pass; Category 4
-- needs five. Same relationship, same pass, two extra years decided entirely by
-- the sponsor's own status -- and Category 4 is narrower besides, covering only
-- a spouse and a biological child where Category 3 also reaches step-children,
-- adopted children, parents and parents-in-law.
--
-- Both figures are on one page and neither is written as a comparison. The
-- migration asserts the ordering, because a reader who meets the three-year
-- rule and stops reading will apply two years early.
--
-- ONE PASS DOES WHAT THREE DO ELSEWHERE
--
--   "residence pass holders are eligible to work, study, and setting up a
--    business without having to convert to another pass"
--
-- Malaysia's Long-Term Social Visit Pass already permits work without
-- converting, by endorsement. This permits work, study AND business outright.
-- Singapore needs an employer-lodged work pass, a Student's Pass and an
-- EntrePass for the same three things -- three applications, three fees, three
-- authorities.
--
-- WHAT IS NOT HERE
--
-- Categories 1 and 2, the Residence Pass-Talent route, are not on this page and
-- are not claimed. The Department publishes categories 3, 4 and 5 of Regulation
-- 16A here and nothing else, which is why this extraction needs no bound.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-24'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'my-residence-pass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-24'::timestamptz
where t.visaai_id = 'my-residence-pass'
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

-- The two qualifying periods must both survive, keep their figures, and render
-- in order. A reader who meets the three-year rule and stops reading applies two
-- years early; one who sees only the five-year rule waits two years too long.
do $$
declare pages int; y3 int; y5 int; o3 int; o5 int; origin int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'MY';
  if pages <> 3 then raise exception 'Expected 3 publishable Malaysian pages, found %.', pages; end if;

  select (parameters ->> 'years')::int, display_order into y3, o3
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-residence-pass' and r.requirement_code = 'category_3_three_years';
  select (parameters ->> 'years')::int, display_order into y5, o5
    from public.visa_requirements r join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-residence-pass' and r.requirement_code = 'category_4_five_years';

  if y3 is distinct from 3 or y5 is distinct from 5 then
    raise exception 'The qualifying periods are % and % years, expected 3 and 5.', y3, y5;
  end if;
  if o3 is null or o5 is null or o3 >= o5 then
    raise exception 'Category 3 (%) must render before category 4 (%).', o3, o5;
  end if;

  select count(*) into origin from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'my-residence-pass'
     and r.requirement_code = 'sabah_sarawak_sponsor_origin' and r.status = 'active';
  if origin <> 1 then
    raise exception 'The Sabah/Sarawak sponsor-origin rule is missing — the one condition here that changes WHO qualifies.';
  end if;
end $$;

commit;
