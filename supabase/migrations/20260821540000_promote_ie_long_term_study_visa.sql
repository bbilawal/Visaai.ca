-- Promote Ireland's long term study visa: 17 requirements.
--
-- Ireland now has 2 pages. This is the visa type I deferred twice, saying it
-- needed the site read properly rather than probed. That was right, and the
-- reading took one request: page-sitemap.xml lists all 208 ISD pages.
--
-- THREE PLACES THIS VISA DIFFERS FROM IRELAND'S SHORT STAY 'C', ALL QUOTED
-- FROM THEIR OWN PAGES RATHER THAN ASSUMED TO MATCH
--
--   * Passport validity is TWELVE months after arrival, against six.
--   * Private medical insurance is required WITH the application. On the short
--     stay visa ISD asks for it at the port of entry instead.
--   * There is a course-fee threshold: fees under EUR 6,000 must be paid in
--     full before applying, EUR 6,000 at minimum above that. ISD states
--     explicitly that this minimum "is an immigration requirement", not merely
--     a college one — so it belongs in the registry rather than being left to
--     the institution.
--
-- Two things carefully kept apart that a careless read would merge: the
-- EUR 6,000 course-fee threshold IS on this page and is recorded; the general
-- maintenance-funds amount is NOT, living on a linked financial-requirements
-- page that is not a registered source. They are different obligations and
-- collapsing them would invent a number.
--
-- Two excerpts preserve ISD's own imperfect text — a garbled sentence ("you
-- must make that you meet") and one truncated where their prose runs into a
-- link. An excerpt is a quote, not a correction.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'ie-long-term-study-visa'
  and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'ie-long-term-study-visa'
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
