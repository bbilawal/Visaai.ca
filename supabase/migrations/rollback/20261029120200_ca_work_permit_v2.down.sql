-- Rollback for 20261029120000 / 20261029120100 / 20261029120200 (work permit checklist v2).
--
-- Retires the 21 rows v2 added, returns the two re-gated LMIA rows to their
-- 2026-08-21 state (no rule, the original descriptions), and returns every
-- remaining row's last_verified_at to its 2026-08-21 extraction date. The
-- other 12 existing rows were re-upserted unchanged by v2.
-- The five visa_sources rows are left in place: their versions are referenced
-- by the retired rows (FK RESTRICT) and an unused source is harmless;
-- deactivate them by hand if wanted.
--
-- Apply: docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file

begin;

update public.visa_requirements r
set status = 'retired'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-work-permit'
  and r.requirement_code in (
    'enough_money_for_stay', 'will_leave_canada', 'police_certificate_if_asked',
    'ime_country_of_residence', 'passport_copy', 'passport_photos',
    'job_offer_letter', 'quebec_acceptance_certificate',
    'employment_contract_lmia_exempt', 'current_employer_letter',
    'past_employer_reference_letters', 'proof_of_past_work_experience',
    'proof_of_job_requirements', 'resume', 'proof_of_relationship_to_principal',
    'principal_work_permit_copy', 'principal_occupation_letter',
    'proof_of_medical_exam', 'proof_of_status_in_residence_country',
    'imm5645', 'open_work_permit_holder_fee')
  and r.status <> 'retired';

update public.visa_requirements r
set rule = null,
    description = 'Required by the IMM 1295 instructions where you need an LMIA to get a work permit. Applicants who do not need an LMIA give the name of the employer who provided the offer of employment number instead. VisaAI has no fact for whether an LMIA is needed, so this is stated rather than gated.',
    status = 'active'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-work-permit'
  and r.requirement_code = 'lmia_and_employment_contract' and r.status <> 'retired';

update public.visa_requirements r
set rule = null,
    description = 'IRCC states the LMIA number is seven digits, and the LMIA-exempt offer of employment number begins with the letter ''a'' followed by seven numbers.',
    status = 'active'
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-work-permit'
  and r.requirement_code = 'lmia_or_offer_of_employment_number' and r.status <> 'retired';

update public.visa_requirements r
set last_verified_at = '2026-08-21'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-work-permit'
  and r.status = 'active';

do $$
declare total int;
begin
  select count(*) into total
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-work-permit' and r.status = 'active';
  if total <> 14 then raise exception 'Expected 14 active work permit requirements after rollback, found %.', total; end if;
end $$;

commit;
