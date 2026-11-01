-- =====================================================================
-- IMM 5476 (Use of a Representative) — guidance on the checklist item.
-- Date: 2026-10-15  (dry run 2026-10-14, defect #50)
--
-- The Canada TRV, study-permit and work-permit registry rows for IMM 5476 were
-- extracted with description NULL. The rule (uses_representative = true) is
-- now evaluable — intake asks whether a representative is used and
-- profileToRuleFacts maps the answer — so the form becomes a REQUIRED checklist
-- item for anyone who uses one. Without a description that item is a bare form
-- code. This fills the description (carried onto the checklist item as its
-- note) with what IRCC asks of the applicant, matching the wording already
-- extracted for ca-sponsor-your-spouse-partner-or-child.
--
-- Data only. Only rows still NULL are touched, so a later re-extraction that
-- writes its own description is never overwritten.
--
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261015180000_imm5476_representative_guidance.down.sql
-- =====================================================================

update public.visa_requirements r
   set description = 'Required when anyone — paid or unpaid, including a friend or relative — represents you on this application. Complete and sign IMM 5476, have your representative sign it, and upload it with your application. A paid representative must be authorized (a licensed immigration consultant, a lawyer or a Quebec notary in good standing). Your representative can never sign the application for you.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id in (
     'ca-visitor-visa-temporary-resident-visa',
     'ca-study-permit',
     'ca-work-permit'
   )
   and r.requirement_code = 'imm5476'
   and r.description is null;
