-- Promote Singapore's EntrePass: 25 requirements.
-- Singapore reaches 4 published pages; the registry reaches 52.
--
-- THE EXCEPTION THAT PROVES THE SINGAPORE RULE
--
-- The Employment Pass row reads "an employer or appointed employment agent
-- needs to apply on behalf of the candidate". The EntrePass row, same table
-- position, same kind of page, reads "candidate can apply directly."
--
-- Registering both on the same night is what makes that legible. One route
-- where nothing on the checklist is yours to satisfy, and one where all of it
-- is, published side by side under the same authority.
--
-- NO SALARY FLOOR IS NOT A LOWER BAR
--
-- "minimum salary: no stipulated minimum salary." The Employment Pass gates on
-- a salary an employer has agreed to pay. EntrePass has no employer, so it
-- gates on the business: an ACRA-registered private limited company, at least
-- 30% held by the applicant, venture-backed or owning innovative technologies,
-- AND one of five innovation criteria -- SGD 100,000 in a single round, an
-- accelerator, a founded-and-sold technology business, registered IP that
-- cannot be easily replicated, or a verified research collaboration with a
-- Singapore IHL or research institute.
--
-- THE ONE-OF RULE IS ITS OWN REQUIREMENT
--
-- MOM's structure is "both conditions" and then "at least one of the following
-- criteria". Storing the five criteria without storing the one-of rule would
-- render five requirements that all appear to bind at once -- wrong five ways,
-- and wrong in the direction that makes a qualifying applicant give up.
--
-- SIX BUSINESS TYPES ARE EXCLUDED OUTRIGHT
--
-- Coffee shops, hawker centres and food courts; bars, night clubs and karaoke
-- lounges; foot reflexology and massage parlours; acupuncture, TCM and herbal
-- dispensing; employment agencies; geomancy. No funding, IP or accelerator
-- moves a business off that list, and it is the fastest disqualification here.
--
-- AND THE PASS DOES NOT AUTHORISE THE BUSINESS
--
-- "getting an entrepass is not a guarantee that your business registration and
-- licences will get approved." Immigration permission and trading permission
-- are separate systems with separate regulators. MOM says so on its own page,
-- so the registry stores it rather than letting a reader infer otherwise.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-23'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'sg-entrepass' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-23'::timestamptz
where t.visaai_id = 'sg-entrepass'
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

-- The one-of rule must be ordered BEFORE the five criteria it governs. If a
-- later edit reordered them, the page would list five alternatives as though
-- they were five cumulative conditions.
do $$
declare pages int; oneof int; firstcrit int; n int;
begin
  select count(*) into pages from public.visa_publishable_pages where country_code = 'SG';
  if pages <> 4 then raise exception 'Expected 4 publishable Singaporean pages, found %.', pages; end if;

  select r.display_order into oneof from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-entrepass' and r.requirement_code = 'one_of_five_innovation_criteria';

  select min(r.display_order) into firstcrit from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-entrepass' and r.requirement_code like 'criterion_%';

  if oneof is null or firstcrit is null or oneof >= firstcrit then
    raise exception 'The one-of rule (%) must precede the five criteria (first at %).', oneof, firstcrit;
  end if;

  select count(*) into n from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'sg-entrepass' and r.requirement_code like 'criterion_%' and r.status = 'active';
  if n <> 5 then raise exception 'Expected 5 innovation criteria, found %.', n; end if;
end $$;

commit;
