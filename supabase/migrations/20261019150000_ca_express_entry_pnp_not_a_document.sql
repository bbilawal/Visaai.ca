-- =====================================================================
-- Canada Express Entry: "Consider the Provincial Nominee Program" is advice,
-- not an upload slot.
-- Date: 2026-10-19  (customer end-to-end on prod, application 31f3ccc6)
--
-- Source of truth: data/requirements/ca-express-entry.json (changed by hand
-- in the same PR).
--
-- The row was extracted as kind = 'recommended', and registry-to-framework.ts
-- turns every `recommended` row into an optional DOCUMENT. The vault then
-- offered "Consider applying through the Provincial Nominee Program" as a
-- file to upload. IRCC's sentence is a route to consider; the document a
-- nominee uploads is the separate row provincial_nomination. It is the only
-- advice-worded `recommended` row in the registry (checked on prod).
--
-- 1. recommended -> condition (a condition is never an upload).
-- 2. Checklist rows already built from it: still-missing ones with no linked
--    document are deleted; any with a document linked is made optional and
--    left for a human (the file is applicant data).
--
-- Status, label and quote are unchanged. Data only. Idempotent.
-- Apply:
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261019150000_ca_express_entry_pnp_not_a_document.down.sql
-- =====================================================================

begin;

-- 1 ---------------------------------------------------------------------
update public.visa_requirements r
   set kind = 'condition',
       description = 'IRCC presents this as an option, not a requirement: a candidate eligible for one of the three Express Entry programs may also apply through Express Entry for the Provincial Nominee Program, and a nomination earns extra points. PNP criteria are set by each province and were not read. A route to consider, not a document: the nomination itself is the upload slot provincial_nomination.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-express-entry'
   and r.requirement_code = 'provincial_nominee_program'
   and r.status <> 'retired';

-- 2 ---------------------------------------------------------------------
delete from public.checklist_items c
 using public.applications a, public.visa_types t
 where c.application_id = a.id
   and a.visa_type_id = t.id
   and t.visaai_id = 'ca-express-entry'
   and c.document_type = 'provincial_nominee_program'
   and c.status = 'missing'
   -- documents.checklist_item_id references checklist_items with NO ACTION.
   and not exists (select 1 from public.documents d where d.checklist_item_id = c.id);

update public.checklist_items c
   set required = false
  from public.applications a, public.visa_types t
 where c.application_id = a.id
   and a.visa_type_id = t.id
   and t.visaai_id = 'ca-express-entry'
   and c.document_type = 'provincial_nominee_program'
   and c.required;

-- Guards ------------------------------------------------------------------
do $$
declare n_upload integer; n_total integer;
begin
  select count(*) into n_upload from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ca-express-entry'
     and r.requirement_code = 'provincial_nominee_program'
     and r.kind in ('evidence', 'recommended')
     and r.status <> 'retired';
  if n_upload <> 0 then
    raise exception 'provincial_nominee_program still kinded as an upload';
  end if;

  -- The documents are untouched: 9 evidence rows, 5 required.
  select count(*) into n_total from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ca-express-entry' and r.status = 'active'
     and r.kind = 'evidence';
  if n_total <> 9 then
    raise exception 'Expected 9 Express Entry documents, found %', n_total;
  end if;
end $$;

commit;
