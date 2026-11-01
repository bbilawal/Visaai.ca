-- Promote the EU Blue Card, Start-up Founders and Skilled Workers routes.
--
-- Three assertions matter here beyond the usual provenance check.
--
-- The EU Blue Card income floor must keep its YEAR. €55,678 is indexed annually,
-- and a figure quoted without "in 2026" reads as permanent — the single most
-- likely way this page ages into a wrong answer.
--
-- The two point thresholds must stay distinct: 50 for founders, 55 for shortage
-- occupations. They are five apart and quoting one for the other would send an
-- applicant away believing they qualify.
--
-- And no requirement anywhere in these three may quote a bare number, because
-- the per-criterion scores behind those thresholds are not extractable.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-25'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-25'::timestamptz
 where t.visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_year integer; n_50 integer; n_55 integer; n_bare integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage')
     and r.status = 'active';
  if n_active <> 12 then raise exception 'Expected 12 active requirements across the three routes, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage')
     and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% requirement(s) lack provenance or a display quotation', n_bad; end if;

  select count(*) into n_pages from public.visa_publishable_pages
   where visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage');
  if n_pages <> 3 then raise exception 'Expected 3 publishable pages, found %', n_pages; end if;

  -- The indexed figure must carry its year.
  select count(*) into n_year from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-eu-blue-card' and r.status='active'
     and r.source_excerpt like '%in 2026%' and r.source_excerpt like '%55,678%';
  if n_year <> 1 then
    raise exception 'The EU Blue Card income floor must be quoted WITH its year; found % such requirement(s)', n_year;
  end if;

  -- The thresholds must not be interchanged.
  select count(*) into n_50 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-start-up-founders' and r.status='active'
     and r.source_excerpt like '%50 points minimum%';
  if n_50 <> 1 then raise exception 'Start-up route must quote the 50-point threshold once, found %', n_50; end if;

  select count(*) into n_55 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-skilled-shortage' and r.status='active'
     and r.source_excerpt like '%minimum of 55 points%';
  if n_55 <> 1 then raise exception 'Shortage route must quote the 55-point threshold once, found %', n_55; end if;

  -- The table itself must stay out of all three.
  select count(*) into n_bare from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-eu-blue-card','at-rwr-start-up-founders','at-rwr-skilled-shortage')
     and r.status='active' and r.source_excerpt ~ '^\s*[0-9]{1,3}\s*$';
  if n_bare > 0 then
    raise exception '% requirement(s) quote a bare number — the points table is not extractable', n_bare;
  end if;

  raise notice 'Three Austrian routes promoted: % active requirements, 3 publishable pages, indexed figure keeps its year', n_active;
end $$;
