-- Promote the Netherlands European Blue Card: 15 requirements. NL now has 3 pages.
--
-- THIS LOOKS LIKE A DUPLICATE OF THE HIGHLY SKILLED MIGRANT PERMIT AND IS NOT
--
-- Three differences are stated on IND's own page, and each would send someone
-- down the wrong route if the two were collapsed:
--
--   * The employer does NOT need to be a recognised sponsor. For the highly
--     skilled migrant permit that is mandatory — which is why many employers
--     cannot use that route at all.
--   * The salary criterion is HIGHER than the highly skilled migrant reduced
--     criterion. Someone choosing the Blue Card for its residency benefit needs
--     to know the bar is higher, not lower.
--   * It can lead to EU long-term residency after 2 years instead of 5.
--
-- The applicant may also lodge it themselves. Both other Dutch permits in this
-- registry are sponsor-lodged, so this one breaks the pattern the previous two
-- established — a good reason to quote rather than infer.
--
-- TWO ENTRIES RECORD AN ABSENCE OF A REQUIREMENT
--
-- `no_recognised_sponsor_needed` and `long_term_eu_residency_2_years` are both
-- officially_required = false. Neither is an obligation; both are the reasons
-- someone picks this permit. A registry that only records duties cannot answer
-- "which of these two should I apply for", which is the actual question.
--
-- The salary FIGURE is absent, as on the highly skilled migrant permit and for
-- the same reason: IND links a separate income page and the criteria change
-- annually. What this page does state about it — that it is higher — is
-- recorded instead of a number nobody published here.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'nl-european-blue-card' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'nl-european-blue-card'
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

commit;
