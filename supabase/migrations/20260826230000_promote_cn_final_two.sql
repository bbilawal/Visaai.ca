-- Promote China's last two service guides. China reaches 5 live routes, one per
-- guide its own index enumerates.
--
-- Three assertions beyond provenance.
--
--   THIRTY WORKING DAYS, NOT THIRTY DAYS. Both guides state the decision window
--   in WORKING days. Six weeks and four weeks are different answers to "will
--   this be ready before my flight", and the word is the whole difference.
--
--   THE SIXTY-DAY RECEPTION PLAN SURVIVES. A tour group's plan must reach the
--   PROVINCIAL authority sixty days before arrival. It is the longest lead time
--   anywhere in this registry and the easiest thing on the page to lose, because
--   it sits inside a sentence that also explains when approval is needed at all.
--
--   THE TWO FEES STAY APART. CNY 100 for the exit-entry permit and CNY 50 for
--   the travel permit — exactly double, which is how fee pairs get merged.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in ('cn-exit-entry-permit','cn-travel-permit')
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
 where t.visaai_id in ('cn-exit-entry-permit','cn-travel-permit')
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_working integer; n_sixty integer; n_fee100 integer; n_fee50 integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('cn-exit-entry-permit','cn-travel-permit') and r.status = 'active';
  if n_active <> 29 then raise exception 'Expected 29 active requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
    join public.visa_countries c on c.id = t.country_id
   where c.code = 'CN' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% CN requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- Both guides must say WORKING days.
  select count(*) into n_working from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id in ('cn-exit-entry-permit','cn-travel-permit') and r.status='active'
     and r.requirement_code = 'time_limit_30_working_days'
     and r.source_excerpt like '%30 working days%';
  if n_working <> 2 then
    raise exception 'Both guides must quote THIRTY WORKING DAYS, not thirty days; found %', n_working;
  end if;

  select count(*) into n_sixty from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-travel-permit' and r.status='active'
     and r.requirement_code = 'tour_group_reception_plan_60_days'
     and r.source_excerpt like '%60 days prior to arrival%';
  if n_sixty <> 1 then
    raise exception 'The 60-day reception-plan lead time must be published intact; found %', n_sixty;
  end if;

  select count(*) into n_fee100 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-exit-entry-permit' and r.status='active'
     and r.kind='fee' and r.source_excerpt like '%cny 100%';
  select count(*) into n_fee50 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'cn-travel-permit' and r.status='active'
     and r.kind='fee' and r.source_excerpt like '%cny 50%';
  if n_fee100 <> 1 or n_fee50 <> 1 then
    raise exception 'The CNY 100 and CNY 50 fees must each appear exactly once (found %, %)', n_fee100, n_fee50;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'CN';
  if n_pages <> 5 then raise exception 'China should publish 5 pages, found %', n_pages; end if;

  raise notice 'China COMPLETE: 5 of 5 enumerated service guides live, % requirements in this batch', n_active;
end $$;
