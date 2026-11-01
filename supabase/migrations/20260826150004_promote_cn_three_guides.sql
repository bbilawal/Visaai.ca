-- Promote China's three NIA service guides. China reaches 3 live routes.
--
-- Four assertions beyond provenance.
--
--   THE EXTENSION LIMITS MUST STAY BOUND TO THEIR VISA LETTERS. C, G, J2 and L
--   extend by no more than 30 days; F, M, Q2, R and X2 by no more than 180. The
--   difference is six-fold in either direction, and the visa letter is the only
--   thing that distinguishes them. If a 30-day letter ever carries a 180-day
--   excerpt, somebody overstays by five months.
--
--   S2 KEEPS BOTH OF ITS LIMITS. It is the one letter with two — 180 days for
--   visiting relatives, 90 for other private or humanitarian purposes — and
--   losing either half makes it wrong for one group.
--
--   ALL SEVEN PERMANENT-RESIDENCE LIMBS SURVIVE. They are alternatives, not a
--   checklist, and a missing limb removes somebody's entire route in.
--
--   THE CANCELLATION GROUNDS SURVIVE. They are the only part of the guide about
--   losing a status already held, and the residence-length ground is one a
--   holder can breach without ever knowing it exists.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
  join public.visa_countries c on c.id = t.country_id
 where t.id = r.visa_type_id
   and c.code = 'CN'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_countries c
 where c.id = t.country_id and c.code = 'CN'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_30 integer; n_180 integer; n_s2 integer; n_limbs integer; n_cancel integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'CN' and r.status = 'active';
  if n_active <> 96 then raise exception 'Expected 96 active CN requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'CN' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% CN requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- The four 30-day letters, each quoting 30 and never 180.
  select count(*) into n_30 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-visa-extension-change-reissuance' and r.status = 'active'
     and r.requirement_code in ('extension_c_visa','extension_g_visa','extension_j2_visa','extension_l_visa')
     and r.source_excerpt like '%no more%30 days%'
     and r.source_excerpt not like '%180 days%';
  if n_30 <> 4 then
    raise exception 'C, G, J2 and L must each quote a 30-day ceiling and no 180-day figure; found %', n_30;
  end if;

  -- The five 180-day letters, each quoting 180 and never 30.
  select count(*) into n_180 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-visa-extension-change-reissuance' and r.status = 'active'
     and r.requirement_code in ('extension_f_visa','extension_m_visa','extension_q2_visa','extension_r_visa','extension_x2_visa')
     and r.source_excerpt like '%no more than 180 days%'
     and r.source_excerpt not like '%30 days%';
  if n_180 <> 5 then
    raise exception 'F, M, Q2, R and X2 must each quote a 180-day ceiling and no 30-day figure; found %', n_180;
  end if;

  -- S2 keeps both halves.
  select count(*) into n_s2 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-visa-extension-change-reissuance' and r.status = 'active'
     and r.requirement_code = 'extension_s2_visa'
     and r.source_excerpt like '%180 days%' and r.source_excerpt like '%90 days%';
  if n_s2 <> 1 then
    raise exception 'S2 must quote BOTH its 180-day and 90-day limits; found %', n_s2;
  end if;

  select count(*) into n_limbs from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-permanent-residence' and r.status = 'active'
     and r.requirement_code like 'limb\_%';
  if n_limbs <> 7 then
    raise exception 'All seven permanent-residence eligibility limbs must survive; found %', n_limbs;
  end if;

  select count(*) into n_cancel from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-permanent-residence' and r.status = 'active'
     and r.requirement_code like 'cancellation\_%';
  if n_cancel <> 5 then
    raise exception 'The cancellation preamble and its four grounds must survive; found %', n_cancel;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'CN';
  if n_pages <> 3 then raise exception 'China should publish 3 pages, found %', n_pages; end if;

  raise notice 'China LIVE: 3 routes, % requirements', n_active;
end $$;
