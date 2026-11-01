-- Rollback for 20261020140000 / 20261020140100 / 20261020140200 (study permit checklist v2).
--
-- Retires the 3 rows v2 added (imm5645, proof_of_medical_exam,
-- ime_country_of_residence) and returns the remaining rows' last_verified_at
-- to their 2026-08-21 extraction date. The 23 existing rows were re-upserted
-- unchanged by v2, so nothing else needs restoring.
-- The three visa_sources rows are left in place: their versions are referenced
-- by the retired rows (FK RESTRICT) and an unused source is harmless;
-- deactivate them by hand if wanted.
--
-- Apply: docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file

begin;

update public.visa_requirements r
set status = 'retired'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-study-permit'
  and r.requirement_code in ('imm5645', 'proof_of_medical_exam', 'ime_country_of_residence')
  and r.status <> 'retired';

update public.visa_requirements r
set last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-study-permit'
  and r.status = 'active';

do $$
declare total int;
begin
  select count(*) into total
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-study-permit' and r.status = 'active';
  if total <> 23 then raise exception 'Expected 23 active study permit requirements after rollback, found %.', total; end if;
end $$;

commit;
