-- Rollback for 20261031120000: re-activate the two work permit uploads.
-- Apply: docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
begin;
update public.visa_requirements r
set status = 'active'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-work-permit'
  and r.requirement_code in ('job_offer_letter', 'lmia_or_offer_of_employment_number')
  and r.status = 'retired';
do $$
declare total int;
begin
  select count(*) into total from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-work-permit' and r.status = 'active';
  if total <> 35 then raise exception 'Expected 35 active work permit requirements after rollback, found %.', total; end if;
end $$;
commit;
