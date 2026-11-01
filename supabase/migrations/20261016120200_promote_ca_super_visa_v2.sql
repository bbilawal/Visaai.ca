-- Promote the corrected Super Visa requirements (v2).
-- Date: 2026-10-16  (real-user dry run, prod app 61f16bb5)
--
-- Apply IMMEDIATELY after 20261016120100_req_ca_super_visa_v2.sql. That file
-- demotes every requirement whose claim changed to 'draft' (the generator's
-- DEMOTE ON CHANGE rule), and the application checklist reads only 'active'
-- rows -- between the two files the super visa checklist is missing its
-- relabelled items.
--
-- WHAT WAS WRONG, AND WHAT THIS APPROVES
--
-- An applicant (Pakistan -> Canada, hosts are her Canadian-citizen sons) chose
-- "Super visa" and got eight upload slots:
--
--   * No passport and no medical insurance -- the defining super visa
--     document. Insurance was stored only as `condition` rows (the policy
--     terms), and conditions are correctly never upload slots, so there was
--     no row saying "upload the policy". Added: `medical_insurance` (evidence,
--     forms-and-documents page: "You must have proof of a health insurance
--     policy on each entry to Canada.") and `passport_copy` (evidence, the
--     super visa start-application page). The policy carries
--     minimum_validity_months = 12, which the expiry check now measures from
--     the planned entry date.
--   * No application form. Added `imm5257` (the IMM 5257 page lists
--     "Super visa — Parents and grandparents" as a purpose of visit) and
--     `imm5476` (conditional on uses_representative; the forms-and-documents
--     page: "You must also fill out the Use of a Representative (IMM 5476)
--     form").
--   * "The invitation letter must state the family-size list…" was an upload
--     slot. It is a rule about the letter's CONTENT -- reclassified as a
--     condition, and the rule folded into the letter's own description. The
--     quote now includes the family-size sentence it always claimed.
--   * Option 1 and Option 2 were two slots for one document. Option 1 became
--     the host's income-proof slot (NOA, or T4/T1, pay stubs, employer
--     letter); Option 2 is a condition explained in that slot.
--   * Host documents (letter, status, income) carry document_owner = sponsor,
--     so the vault files them under the host.
--   * The medical exam carries may_follow_application: IRCC tells super visa
--     applicants to take an upfront exam, and if they have not, the visa office
--     sends instructions after the application. It stays on the checklist but
--     no longer blocks "Generate my forms".
--
-- Every excerpt was re-checked against the live pages on 2026-10-16 with
-- scripts/verify-excerpts.ts (29/29 verbatim) and display excerpts derived
-- with scripts/derive-display-excerpts.ts.
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file

update public.visa_requirements r
set status = 'active', last_verified_at = '2026-10-16'::timestamptz
from public.visa_types t
where t.id = r.visa_type_id and t.visaai_id = 'ca-super-visa' and r.status = 'draft';

do $$
declare bad int;
begin
  select count(*) into bad from public.visa_requirements
  where status = 'active'
    and (source_version_id is null or source_excerpt is null or source_excerpt = ''
         or (kind = 'recommended' and officially_required));
  if bad > 0 then raise exception '% active requirement(s) lack provenance.', bad; end if;
end $$;

do $$
declare docs int; forms int; rule_kind text; total int;
begin
  select count(*) filter (where r.kind = 'evidence'),
         count(*) filter (where r.kind = 'form'),
         count(*)
    into docs, forms, total
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-super-visa' and r.status = 'active';
  if total <> 29 then raise exception 'Expected 29 active super visa requirements, found %.', total; end if;
  -- passport, medical insurance, host letter, medical exam, host status,
  -- relationship, host income, applicant income (Option 2 only).
  if docs <> 8 then raise exception 'Expected 8 super visa documents, found %.', docs; end if;
  if forms <> 2 then raise exception 'Expected 2 super visa forms (IMM 5257, IMM 5476), found %.', forms; end if;

  select r.kind into rule_kind
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-super-visa' and r.requirement_code = 'letter_of_invitation_contents'
    and r.status = 'active';
  if rule_kind is distinct from 'condition' then
    raise exception 'letter_of_invitation_contents must be a condition, found %.', rule_kind;
  end if;
end $$;
