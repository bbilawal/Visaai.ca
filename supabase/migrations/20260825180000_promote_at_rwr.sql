-- Promote Austria's Red-White-Red Card (very highly qualified) requirements.
--
-- The assertions here guard the two things this route can get wrong.
--
-- First, the documentary age limits. The photo must be under six months old and
-- the language certificate under five years — two different expiry rules on one
-- page, and swapping them would send somebody to a photo booth instead of a
-- language school.
--
-- Second, and more important: the POINTS TABLE MUST NOT BE PRESENT. Its
-- criterion-to-score mapping is destroyed by normalization, so any requirement
-- quoting a bare point value would be an inference from visual layout rather
-- than a quotation. The assertion below fails if one ever appears.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-25'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'at-rwr-very-highly-qualified'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-25'::timestamptz
 where t.visaai_id = 'at-rwr-very-highly-qualified'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare n_active integer; n_bad integer; n_pages integer; n_photo integer; n_lang integer; n_points integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-very-highly-qualified' and r.status = 'active';
  if n_active <> 9 then raise exception 'Expected 9 active Austrian requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-very-highly-qualified' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% requirement(s) lack provenance or a display quotation', n_bad; end if;

  select count(*) into n_pages from public.visa_publishable_pages
   where visaai_id = 'at-rwr-very-highly-qualified';
  if n_pages <> 1 then raise exception 'Expected 1 publishable Austrian page, found %', n_pages; end if;

  -- Two different expiry rules, each asserted so they cannot be swapped.
  select count(*) into n_photo from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-very-highly-qualified' and r.status='active'
     and r.source_excerpt like '%not older than six months%';
  if n_photo <> 1 then raise exception 'Expected the six-month photo rule exactly once, found %', n_photo; end if;

  select count(*) into n_lang from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-very-highly-qualified' and r.status='active'
     and r.source_excerpt like '%not be older than five years%';
  if n_lang <> 1 then raise exception 'Expected the five-year language rule exactly once, found %', n_lang; end if;

  -- The points table must stay out. A requirement whose excerpt is a bare score
  -- would be an inference from layout, not a quotation.
  select count(*) into n_points from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-very-highly-qualified' and r.status='active'
     and r.source_excerpt ~ '^\s*[0-9]{1,3}\s*$';
  if n_points > 0 then
    raise exception '% requirement(s) quote a bare number — the points table is not extractable and must not appear', n_points;
  end if;

  raise notice 'Austria promoted: % active requirements, 1 publishable page, points table correctly absent', n_active;
end $$;
