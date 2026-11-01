-- Rollback for 20261029120000_ca_visitor_visa_bank_statement.sql.
--
-- Retires the TRV bank_statement row. Checklist rows already built from it are
-- left alone: any uploaded statement is applicant data.
--
-- Apply: docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file

begin;

update public.visa_requirements r
set status = 'retired'
from public.visa_types t
where t.id = r.visa_type_id
  and t.visaai_id = 'ca-visitor-visa-temporary-resident-visa'
  and r.requirement_code = 'bank_statement'
  and r.status <> 'retired';

commit;
