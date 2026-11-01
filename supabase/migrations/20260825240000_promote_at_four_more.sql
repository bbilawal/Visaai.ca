-- Promote the four remaining work-and-settlement Austrian routes.
--
-- Assertions beyond provenance, each guarding a claim a reviewer could not check
-- by eye:
--
--   The graduate upgrade needs BOTH its numbers. "21 months" and "24 months" are
--   a window, and quoting one without the other describes a different rule.
--
--   The seasonal route's seven-month history must keep "same industry". Dropped,
--   it would tell someone a season in any sector counts.
--
--   The self-employed capital requirement must keep its employment limb. Split
--   apart, capital alone would look sufficient.
--
--   Card Plus has three ALTERNATIVES. All three must be present, or the page
--   would present one path as the only path.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-25'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers',
                       'at-rwr-regular-workers-seasonal','at-rwr-card-plus')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-25'::timestamptz
 where t.visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers',
                       'at-rwr-regular-workers-seasonal','at-rwr-card-plus')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_upgrade integer; n_industry integer; n_capital integer; n_alts integer; n_bare integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers',
                         'at-rwr-regular-workers-seasonal','at-rwr-card-plus')
     and r.status = 'active';
  if n_active <> 21 then raise exception 'Expected 21 active requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers',
                         'at-rwr-regular-workers-seasonal','at-rwr-card-plus')
     and r.status='active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% requirement(s) lack provenance or a display quotation', n_bad; end if;

  select count(*) into n_pages from public.visa_publishable_pages
   where visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers',
                       'at-rwr-regular-workers-seasonal','at-rwr-card-plus');
  if n_pages <> 4 then raise exception 'Expected 4 publishable pages, found %', n_pages; end if;

  select count(*) into n_upgrade from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-graduates' and r.status='active'
     and r.source_excerpt like '%21 months%' and r.source_excerpt like '%24 months%';
  if n_upgrade <> 1 then
    raise exception 'The graduate upgrade must quote BOTH 21 and 24 months; found %', n_upgrade;
  end if;

  select count(*) into n_industry from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-regular-workers-seasonal' and r.status='active'
     and r.source_excerpt like '%7 months%' and r.source_excerpt like '%same industry%';
  if n_industry <> 1 then
    raise exception 'The seasonal history must keep "same industry"; found %', n_industry;
  end if;

  select count(*) into n_capital from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-self-employed-key-workers' and r.status='active'
     and r.source_excerpt like '%investment capital%' and r.source_excerpt like '%jobs%';
  if n_capital <> 1 then
    raise exception 'The capital requirement must keep its employment limb; found %', n_capital;
  end if;

  select count(*) into n_alts from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'at-rwr-card-plus' and r.status='active'
     and r.requirement_code like 'route_%';
  if n_alts <> 3 then
    raise exception 'Card Plus has three alternative routes in; found % recorded', n_alts;
  end if;

  select count(*) into n_bare from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('at-rwr-graduates','at-rwr-self-employed-key-workers',
                         'at-rwr-regular-workers-seasonal','at-rwr-card-plus')
     and r.status='active' and r.source_excerpt ~ '^\s*[0-9]{1,3}\s*$';
  if n_bare > 0 then raise exception '% requirement(s) quote a bare number', n_bare; end if;

  raise notice 'Four Austrian routes promoted: % active requirements, 4 publishable pages', n_active;
end $$;
