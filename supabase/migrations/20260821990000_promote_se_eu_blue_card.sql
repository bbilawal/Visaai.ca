-- Promote Sweden's EU Blue Card: 15 requirements. Sweden reaches 5 pages; the
-- registry reaches 39.
--
-- THE SALARY THRESHOLD IS A FORMULA, NOT A FIGURE
--
-- Migrationsverket redetermines it every year at 1.25 times the average gross
-- salary published by the National Mediation Office. SEK 53,625/month is the
-- value in force since 15 July 2026 -- a snapshot with a date, recorded
-- alongside the multiplier so the durable fact survives the next revision.
--
-- Sweden sets this nationally. The registry now holds the same EU instrument
-- under two implementations (see nl-european-blue-card), and crossing their
-- figures would produce a confidently wrong number that verifies against
-- nothing.
--
-- A CONFLICT INSIDE MIGRATIONSVERKET'S OWN SITE
--
-- This page dates the maintenance amounts to 2025; Migrationsverket's
-- maintenance word-explanation page gives the identical six figures as 2026.
-- Confirmed by re-fetching both and matching all six on each. One is stale and
-- neither says which, so this file quotes its own page and flags the conflict
-- rather than silently picking a year.
--
-- OTHER THINGS EASY TO GET WRONG:
--   * Eligibility is ALTERNATIVES: 180 higher education credits OR five years
--     of relevant experience. The experience route opens the card to people
--     without a degree, which is not how it is usually described.
--   * The maintenance requirement applies ONLY if family apply with you. Read
--     quickly the page suggests every applicant faces it. They do not.
--   * The EMPLOYER starts the application, using the applicant's details, and
--     Migrationsverket then contacts the applicant at the email address the
--     employer supplied -- losing access to it breaks the channel the decision
--     arrives on.
--   * For a stay under a year, health insurance must run three months BEYOND
--     the employment period.
--   * The card permits work only for the named employer in the named
--     profession, and changes must be reported.
--   * Citizens of Japan pay no application fee -- a bilateral exemption that
--     appears nowhere else in this registry.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'se-eu-blue-card' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'se-eu-blue-card'
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
