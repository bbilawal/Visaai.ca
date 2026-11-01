-- Promote Ireland's long stay employment visa: 23 requirements.
-- Ireland reaches 4 pages and its first work route; the registry reaches 35.
--
-- TWO AUTHORITIES, IN ORDER
--
-- Ireland splits work migration: DETE issues the employment PERMIT, ISD issues
-- the VISA, and ISD states "once you have received a permit, you are eligible to
-- apply for an employment visa". The permit is both a precondition and a
-- required supporting document.
--
-- Someone who searches "Irish work visa" and reads only visa pages can apply in
-- the wrong order and be refused for a reason no visa criterion lists. That is
-- why the ordering is requirement #1 rather than a note. The seven DETE permit
-- types are named but their eligibility is deliberately NOT extracted -- that is
-- a different authority's site and each permit carries its own salary
-- thresholds, occupation lists and labour-market tests.
--
-- THE PREVIOUS "BLOCKED" CALL ON THIS VISA WAS WRONG
--
-- It was recorded as blocked behind a 2,793-char router. The router is real --
-- /applying-for-a-long-stay-employment-visa/ returns 2,717 characters and states
-- nothing -- but the visa page sits one level below it with 16,600 characters,
-- and page-sitemap.xml finds it in a single fetch. Third instance of the same
-- mistake shape after UDI's hidden input and Sweden's /en/ tree: checking one
-- thing and generalising from it.
--
-- DETAIL WORTH KEEPING, because each clause refuses real applications:
--   * Business letters must be original, on headed paper, with a FIXED-LINE
--     number; Yahoo and Hotmail addresses and electronic signatures are refused.
--   * Documents on USB sticks, memory cards, CD-ROMs or file-sharing links count
--     as not supplied -- ISD says it cannot access them.
--   * Passport validity is measured 12 months from ARRIVAL, not from applying.
--   * Previous refusals must be disclosed for ANY country, with the original
--     letter, and cover deportation, refused entry and overstaying. ISD says
--     non-disclosure WILL result in refusal, not may.
--   * Insurance is not wanted with the application but must be presentable at
--     the port of entry.
--   * The 30-day document deadline starts when the ONLINE form is created.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ie-long-stay-employment-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'ie-long-stay-employment-visa'
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
