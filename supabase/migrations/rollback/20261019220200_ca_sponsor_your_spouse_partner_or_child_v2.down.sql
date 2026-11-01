-- Rollback for 20261019220000 / 20261019220100 / 20261019220200 (spousal documents v2).
--
-- v2 left the 23 pre-existing requirements unchanged (same kind, label, rule,
-- parameters and excerpt), so nothing needs re-inserting: this retires the 15
-- rows v2 added and puts the existing rows' last_verified_at back to their
-- 2026-08-21 extraction date.
-- The `documents` visa_sources row is left in place: its version is referenced
-- by the retired rows (FK RESTRICT) and an unused source is harmless;
-- deactivate it by hand if wanted.
--
-- Apply: docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file

begin;

update public.visa_requirements r
set status = 'retired'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-sponsor-your-spouse-partner-or-child'
  and r.requirement_code in (
    'passport', 'birth_certificate', 'marriage_certificate',
    'common_law_relationship_proof', 'conjugal_relationship_proof',
    'relationship_evidence', 'police_clearance', 'proof_of_status',
    'sponsor_residence_proof', 'sponsor_previous_relationship_proof',
    'children_citizenship_proof',
    'imm0008', 'imm5669', 'imm5406', 'imm5532')
  and r.status <> 'retired';

update public.visa_requirements r
set last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-sponsor-your-spouse-partner-or-child'
  and r.status = 'active';

do $$
declare total int;
begin
  select count(*) into total
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-sponsor-your-spouse-partner-or-child' and r.status = 'active';
  if total <> 23 then raise exception 'Expected 23 active spousal requirements after rollback, found %.', total; end if;
end $$;

commit;
