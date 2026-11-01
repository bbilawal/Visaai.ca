-- Work permit checklist: retire the two uploads IRCC does not ask for.
--
-- IRCC's own personalised checklist for an LMIA work permit from outside
-- Canada (secure account, recorded live 2026-10-31) lists IMM 1295, IMM 5645,
-- an employment reference letter, the LMIA from ESDC, passport, employment
-- records, CV, digital photo, request for medical exam, the employment
-- contract and proof of meeting the job's requirements. It has no separate
-- "job offer letter" and no upload for the LMIA / offer of employment number
-- (the number is typed into IMM 1295; the LMIA itself is its own upload and
-- the LMIA-exempt employment contract stays as employment_contract_lmia_exempt).
--
-- Apply: docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261031120000_retire_ca_work_permit_extra_docs.down.sql

begin;

update public.visa_requirements r
set status = 'retired'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-work-permit'
  and r.requirement_code in ('job_offer_letter', 'lmia_or_offer_of_employment_number')
  and r.status = 'active';

do $$
declare total int; left_over int;
begin
  select count(*) into total
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-work-permit' and r.status = 'active';
  select count(*) into left_over
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-work-permit' and r.status = 'active'
    and r.requirement_code in ('job_offer_letter', 'lmia_or_offer_of_employment_number');
  if left_over <> 0 then raise exception 'The two rows are still active.'; end if;
  if total <> 33 then raise exception 'Expected 33 active work permit requirements, found %.', total; end if;
end $$;

commit;
