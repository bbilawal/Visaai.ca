-- Promote Sweden's employee work permit: 10 requirements. Sweden now has 2 pages.
--
-- Second non-English extraction. Same trade recorded in the same place: Swedish
-- excerpts, English renderings stated inside each description so the two sit
-- side by side, and a translation_note saying plainly what a non-Swedish reader
-- can and cannot verify.
--
-- THE NUMBER THIS PERMIT TURNS ON
--
-- SEK 34,470 per month — 90% of the median wage Statistics Sweden publishes
-- each June. It is the whole test, and it changes ANNUALLY. Quoting it from the
-- page rather than recalling it is the difference between a figure that goes
-- stale visibly, via the daily diff, and one that is quietly wrong for a year.
--
-- Two entries exist so that number is never read as sufficient on its own:
--
--   * `salary_may_need_to_exceed_minimum` — Migrationsverket says the salary
--     must ALSO match collective agreements or industry practice, so it may
--     need to be higher than 90% of the median.
--   * `exempt_occupations_75_percent` — some occupations are exempt but must
--     still reach 75%. Marked not officially required because it is an
--     exemption, not an obligation.
--
-- `single_employment_only` is the sharp one: two jobs that together clear the
-- bar do NOT qualify. Someone assembling an offer from part-time roles would
-- otherwise have no reason to suspect it.
--
-- Its excerpt begins mid-word ("an inte ha två eller flera anställningar"),
-- because Migrationsverket's own sentence is split by page structure and the
-- normalizer preserves what is served. Trimming to a tidy sentence boundary
-- would break the verification that proves the quote real.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'se-work-permit-employed' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'se-work-permit-employed'
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
