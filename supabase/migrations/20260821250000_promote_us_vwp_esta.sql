-- Promote US Visa Waiver Program / ESTA — the last FAILED row in the matrix.
--
-- Eight requirements, read from two www.cbp.gov pages registered in
-- 20260821230000 because all three previously registered sources were
-- unreadable: two travel.state.gov pages behind a 403, and the live ESTA
-- client, which returns 200 but is a JavaScript app containing no prose.
--
-- WHAT IS DELIBERATELY ABSENT, AND WHY EACH ABSENCE IS CORRECT
--
-- This visa type is the clearest case in the registry of a requirement set that
-- is honestly incomplete rather than quietly padded. Four things a user would
-- reasonably expect are missing:
--
--   * The list of 42 VWP countries. CBP states the COUNT on the page and not
--     the membership; the authoritative list is State Department, behind the
--     403. The count is quoted, the list is not, and no rule is keyed to
--     nationality — a rule built on a country list nobody read would either
--     invent membership or silently exclude a real VWP national. Both failures
--     are worse than showing the condition to everyone.
--   * The ESTA fee. Neither CBP page states an amount and the State Department
--     fee schedule is blocked. A widely-known number is still model recall, and
--     model recall is not a source.
--   * The ESTA validity period. Same reason.
--   * The statutory ineligibility grounds under the VWP Improvement and
--     Terrorist Travel Prevention Act of 2015. CBP links an FAQ rather than
--     stating them, and that FAQ is not a registered source.
--
-- All four are recorded in the extraction file's `not_extracted` list, so the
-- gaps are visible to the next person rather than looking like completeness.
--
-- Two entries exist specifically to stop the product overstating things:
-- `esta_is_not_admissibility` quotes CBP saying an approved ESTA does not
-- determine admissibility, and `apply_before_booking` is marked
-- officially_required = false because CBP frames it as a recommendation.

begin;

update public.visa_requirements r
set status = 'active',
    last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'us-visa-waiver-program-esta'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified',
    last_verified_at = '2026-08-21'::timestamptz
where t.visaai_id = 'us-visa-waiver-program-esta'
  and exists (
    select 1 from public.visa_requirements r
    where r.visa_type_id = t.id and r.status = 'active'
  );

do $$
declare bad int;
begin
  select count(*) into bad
  from public.visa_requirements
  where status = 'active'
    and (source_version_id is null
         or source_excerpt is null
         or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then
    raise exception
      '% active requirement(s) lack provenance or an excerpt, or claim '
      'official status for a recommendation. Promotion aborted.', bad;
  end if;
end $$;

commit;
