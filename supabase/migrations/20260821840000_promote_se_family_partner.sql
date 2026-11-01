-- Promote Sweden's live-with-a-partner residence permit: 15 requirements.
-- Sweden reaches 4 pages; the registry reaches 34 across 8 destinations.
--
-- THE SWEDISH-CITIZEN EXEMPTION IS THE POINT OF THIS PAGE
--
-- The maintenance requirement -- enough income AND a big enough home -- is by
-- far the hardest condition here. A partner who is a Swedish citizen does not
-- have to meet it at all, provided the relationship is well established. That
-- turns the hardest test off for a large share of applicants, and the exception
-- to the exception matters too: it comes back if children are moving along whom
-- the partner is not parent or guardian of.
--
-- Recording the thresholds without the exemption would tell those couples to
-- clear a bar Sweden does not ask them to clear. It is `officially_required
-- = false` because it is a relief FROM a requirement, not one.
--
-- THE INCOME TEST IS RESIDUAL, NOT A SALARY BAR
--
-- Migrationsverket asks what is left after tax and rent, to cover food,
-- clothing, hygiene, telephony and insurance for the household. A high salary
-- with a high rent can fail it. SEK 10,314/month is the cohabiting-partner
-- figure -- SEK 6,243 is for a single adult and is the wrong one to quote on
-- this route. Migrationsverket dates the amounts to 2026, so they are revised.
--
-- Housing is the half that gets overlooked next to the numbers, and it is
-- forward-looking: housing for at least a year INTO THE FUTURE, not held now.
--
-- SPLIT OBLIGATIONS, AS IN NORWAY
--
-- Requirements divide three ways -- both of you, the person moving, the person
-- in Sweden -- and the maintenance requirement falls entirely on the partner
-- already there, who never files the application. Every label names whose
-- obligation it is.
--
-- WHY THIS FILE DECLARES NO source_bounds
--
-- Deliberate, and checked rather than assumed. Migrationsverket gives each
-- family route its own url and inlines that route's four tabs into it, so the
-- page repeats itself but every repetition is this route's own text: the three
-- requirement headings occur exactly once each, and 12 of 13 page-sourced
-- excerpts occur exactly once (the fee twice, via tab inlining). Contrast
-- no-family-spouse.json, where ONE url carries 8+ family routes and 5 of 9
-- excerpts also appear in a sibling -- there a bound is the only thing keeping
-- a cohabitant's rule from being filed under spouses.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'se-family-partner' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'se-family-partner'
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
