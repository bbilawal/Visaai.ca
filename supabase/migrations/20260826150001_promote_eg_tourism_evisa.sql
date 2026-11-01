-- Promote Egypt's tourism e-Visa. Egypt reaches 1 live route.
--
-- Two assertions beyond provenance, and both are about a distinction the page
-- makes that a checklist would erase.
--
--   THE ARRIVAL DOCUMENTS MUST STAY LABELLED AS ARRIVAL DOCUMENTS. The five
--   items on this page sit under "entry requirements (on arrival)" — what the
--   Egyptian port asks for, not what the online application asks for. If those
--   labels ever stop saying "On arrival", somebody will upload a hotel booking
--   to a portal that never asks for one and, worse, will travel without the
--   printout the port does ask for.
--
--   THE TWO FEES MUST STAY APART. 30$ single entry and 65$ multiple entries are
--   different products at more than double the price. A merge, or a single
--   surviving fee row, would misprice one of them.

update public.visa_requirements r
   set status = 'active', last_verified_at = '2026-08-26'::timestamptz
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'eg-tourism-evisa'
   and r.status = 'draft';

update public.visa_types t
   set data_quality = 'verified', last_verified_at = '2026-08-26'::timestamptz
 where t.visaai_id = 'eg-tourism-evisa'
   and exists (select 1 from public.visa_requirements r
                where r.visa_type_id = t.id and r.status = 'active');

do $$
declare
  n_active integer; n_bad integer; n_pages integer;
  n_arrival integer; n_30 integer; n_65 integer;
begin
  select count(*) into n_active from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'eg-tourism-evisa' and r.status = 'active';
  if n_active <> 14 then raise exception 'Expected 14 active requirements, found %', n_active; end if;

  select count(*) into n_bad from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'eg-tourism-evisa' and r.status = 'active'
     and (r.source_version_id is null or r.source_excerpt is null or r.source_excerpt_display is null);
  if n_bad > 0 then raise exception '% requirement(s) lack provenance or a display quotation', n_bad; end if;

  -- All five arrival documents, still labelled as arrival documents.
  select count(*) into n_arrival from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'eg-tourism-evisa' and r.status = 'active'
     and r.requirement_code like 'arrival\_%'
     and r.label like 'On arrival:%';
  if n_arrival <> 5 then
    raise exception 'All 5 on-arrival documents must be labelled as such; found %', n_arrival;
  end if;

  -- The two fees, distinct, each carrying its own amount.
  select count(*) into n_30 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'eg-tourism-evisa' and r.status = 'active'
     and r.requirement_code = 'fee_single_entry'
     and r.source_excerpt like '%30$%' and (r.parameters->>'amount')::numeric = 30;
  select count(*) into n_65 from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'eg-tourism-evisa' and r.status = 'active'
     and r.requirement_code = 'fee_multiple_entries'
     and r.source_excerpt like '%65$%' and (r.parameters->>'amount')::numeric = 65;
  if n_30 <> 1 or n_65 <> 1 then
    raise exception 'The 30$ and 65$ fees must each appear exactly once with a matching amount (found % and %)', n_30, n_65;
  end if;

  select count(*) into n_pages from public.visa_publishable_pages where country_code = 'EG';
  if n_pages <> 1 then raise exception 'Egypt should publish 1 page, found %', n_pages; end if;

  raise notice 'Egypt LIVE: 1 route, % requirements', n_active;
end $$;
