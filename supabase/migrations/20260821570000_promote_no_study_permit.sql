-- Promote Norway's study permit: 13 requirements. Norway now has 2 pages.
--
-- THE MONEY IS THE WHOLE POINT OF THIS ONE
--
-- UDI publishes unusually precise maintenance figures, and three of them are
-- recorded because collapsing them would misstate the requirement:
--
--   NOK 15,488 per month / NOK 170,368 for the academic year
--   NOK  77,440 autumn semester
--   NOK  92,928 spring semester
--
-- The two semesters are NOT equal. A single "per semester" figure would
-- understate spring by NOK 15,488 — roughly a month's maintenance — for anyone
-- arriving in January.
--
-- UDI writes these with a space as the thousands separator ("nok 15 488"). The
-- excerpts preserve that; the parsed values live in `parameters` where the fee
-- renderer can format them properly.
--
-- `tuition_fees_covered` quotes an academic year, 2025/2026, inside UDI's own
-- sentence. That will date. It is quoted rather than generalised because the
-- daily monitor diffs this page, so the change surfaces for review instead of
-- being silently wrong.
--
-- `work_rights` is officially_required = false: it is a right the permit
-- GRANTS, not an obligation. Recorded anyway because students routinely choose
-- a route on exactly that basis.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'no-study-permit' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'no-study-permit'
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
