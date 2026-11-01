-- Promote Ireland's Short Stay 'C' Business Visa: 16 requirements. IE has 3 pages.
--
-- WHY THIS IS NOT A COPY OF IRELAND'S VISIT VISA
--
-- Both are 90-day 'C' visas and the registry already holds the visit one. The
-- difference is a rule with sharp edges, and it is the reason this deserves its
-- own visa type rather than a note on the other page:
--
--   * Work IS permitted, but only if it starts and ends inside a single 14-day
--     period.
--   * And only ONCE in the 90 days.
--
-- ISD publishes two worked examples of arrangements that fail: 7 days of work,
-- a 10-day gap, then 7 more; and 14 days, leaving Ireland for a month, then
-- returning for another 14. Each block is under 14 days and both are refused —
-- they need the atypical working scheme and a short stay employment visa.
--
-- A business traveller plans straight into that. Both rules are recorded with
-- ISD's examples in their descriptions.
--
-- A PATH CORRECTION WORTH RECORDING
--
-- I previously sized ".../what-are-my-options-for-working-in-ireland/applying-
-- for-a-long-stay-employment-visa/" at 2,599 characters and concluded Ireland's
-- work section was all routers. The sitemap shows TWO similarly-named branches —
-- "what-are-my-options-for-working-in-ireland" and "what-are-my-work-visa-
-- options" — and the substantive pages sit three levels under the first. The
-- long stay employment visa page genuinely is a router and still needs its own
-- pass; the business visa is 27,180 characters.
--
-- `passport_valid_6_months` is six months here against TWELVE on Ireland's long
-- term study visa. Same country, same authority, different visa, different
-- number — quoted from each page rather than assumed to match, which is the
-- entire reason this registry stores excerpts.

begin;

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-08-22'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'ie-short-stay-business-visa' and r.status = 'draft';

update public.visa_types t
set data_quality = 'verified', last_verified_at = '2026-08-22'::timestamptz
where t.visaai_id = 'ie-short-stay-business-visa'
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
