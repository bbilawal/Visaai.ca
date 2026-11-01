-- Promote Sweden's higher education study permit: 13 requirements. SE has 3 pages.
--
-- THE MONEY IS YEAR-DEPENDENT, WHICH IS RARE AND EASY TO GET WRONG
--
-- Migrationsverket publishes TWO years of maintenance figures side by side, and
-- the one that applies depends on the year you APPLIED, not the year you study:
--
--   SEK 10,656 / month for 2026 applications
--   SEK 10,584 / month for 2025 applications
--
-- and it is reduced by free board and lodging, and increased for family:
--
--   minus SEK 2,960 (food) and SEK 4,736 (housing), 2026 applicants
--   plus  SEK 4,440 spouse or partner, SEK 2,664 per child
--
-- This is precisely the shape an answer from memory gets wrong: one confident
-- number, for the wrong year, with no deductions. Quoting all of it from the
-- page is the only way it stays right, and the daily diff catches the January
-- change.
--
-- Only the 2026 deduction pair is recorded. Both years appear on the page; the
-- 2025 deductions are noted in `not_extracted` rather than stored, because an
-- applicant reading this is applying in 2026 and two competing pairs on one
-- checklist would be worse than one correct pair.
--
-- TWO ENTRIES TURN ON A SINGLE SWEDISH WORD
--
-- `registration_for_long_studies` and `documents_language` are both
-- officially_required = false because Migrationsverket writes "bör" — should —
-- not "måste". Recording them as mandatory would invent two obligations, and
-- the distinction is invisible unless you read the source language.
--
-- `tuition_paid_for_final_admission` is the trap on this permit: admission is
-- not "final" until the tuition fee is paid, and only final admission qualifies.
-- Someone holding a conditional offer would otherwise think they were ready.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'se-higher-education-study-permit' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'se-higher-education-study-permit'
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
