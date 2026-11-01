-- =====================================================================
-- Hoist auth.uid() / auth.jwt() out of per-row RLS evaluation (PERF-004).
-- Author: Audit (Phase 9 remediation)   Date: 2026-08-09
--
-- WHY: `auth.uid()` written bare inside a policy is evaluated PER ROW. Wrapped
-- in a scalar subquery it becomes an InitPlan the planner runs ONCE. This is
-- Supabase's own documented pattern and the semantics are identical — the
-- function returns the same value for every row of a statement either way.
--
-- MEASURED before this change, on the seeded stack (5,000 applications):
--   application_activity via PostgREST, generic plan .... 495 ms
--   same query with a literal instead of a parameter ....   3.7 ms
-- The gap is the applications policy — is_active_assignee(),
-- app_has_active_consultant(), consultant_covers_country() — re-evaluated as a
-- SubPlan per row per joined table.
--
-- HOW THIS WAS PRODUCED. Not by hand. Every statement below was generated from
-- pg_policies, applying exactly one textual transformation:
--     auth.uid()  ->  (select auth.uid())
--     auth.jwt()  ->  (select auth.jwt())
-- Name, permissive/restrictive, command, roles, USING and WITH CHECK are copied
-- verbatim. 113 of 143 policies are affected; the other 30 reference neither
-- function and are untouched.
--
-- HOW IT WAS VERIFIED. After applying, every policy was re-read from
-- pg_policies, the `(select ...)` wrapper stripped, and the result compared
-- character-for-character with the definition captured beforehand. A single
-- mismatch would mean a policy changed meaning. Then the 40 tenant-isolation
-- tests were re-run.
--
-- Rewriting 113 security policies is the highest-risk change in this audit,
-- which is why it is mechanical and independently checked rather than careful.
--
-- NOT YET APPLIED TO PRODUCTION. Blocked on BLK-1 — no backup exists there.
-- =====================================================================


-- ATOMICITY (added 2026-08-21, before the first production apply).
--
-- This file drops and recreates 113 RLS policies. Run without a transaction, a
-- failure partway leaves some tables with RLS ENABLED and NO POLICY. Postgres
-- fails closed in that state, so it is not a data-exposure risk — it is a
-- product outage: every affected query returns nothing until someone notices.
--
-- DDL is transactional in Postgres, so wrapping the whole file makes the
-- change all-or-nothing. Written into the file rather than relying on
-- `psql --single-transaction`, so the guarantee holds no matter which tool
-- applies it. A caller that already opened a transaction gets a harmless
-- "there is already a transaction in progress" warning.

begin;

drop policy if exists "action_items_own_rows" on public."action_items";
create policy "action_items_own_rows" on public."action_items"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT a.user_id
   FROM (post_submission_events e
     JOIN applications a ON ((a.id = e.application_id)))
  WHERE (e.id = action_items.post_submission_event_id))));

drop policy if exists "addon_purchases_own_read" on public."addon_purchases";
create policy "addon_purchases_own_read" on public."addon_purchases"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "ai_usage_events_owner_read" on public."ai_usage_events";
create policy "ai_usage_events_owner_read" on public."ai_usage_events"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "analytics_events_insert_own" on public."analytics_events";
create policy "analytics_events_insert_own" on public."analytics_events"
  as permissive
  for insert
  to public
  with check (((user_id IS NULL) OR ((select auth.uid()) = user_id)));

drop policy if exists "analytics_events_select_own" on public."analytics_events";
create policy "analytics_events_select_own" on public."analytics_events"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "application_outcomes_insert_own" on public."application_outcomes";
create policy "application_outcomes_insert_own" on public."application_outcomes"
  as permissive
  for insert
  to public
  with check (((select auth.uid()) = user_id));

drop policy if exists "application_outcomes_select_own" on public."application_outcomes";
create policy "application_outcomes_select_own" on public."application_outcomes"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "application_outcomes_update_own" on public."application_outcomes";
create policy "application_outcomes_update_own" on public."application_outcomes"
  as permissive
  for update
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "profiles_own_rows" on public."application_profiles";
create policy "profiles_own_rows" on public."application_profiles"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = application_profiles.application_id))));

drop policy if exists "applications_own_rows" on public."applications";
create policy "applications_own_rows" on public."applications"
  as permissive
  for all
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "applications_owner_consultant_admin_select" on public."applications";
create policy "applications_owner_consultant_admin_select" on public."applications"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(id, (select auth.uid())) OR ((NOT app_has_active_consultant(id)) AND consultant_covers_country((select auth.uid()), destination_country))));

drop policy if exists "applications_owner_consultant_admin_update" on public."applications";
create policy "applications_owner_consultant_admin_update" on public."applications"
  as permissive
  for update
  to public
  using ((((select auth.uid()) = user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM consultant_assignments a
  WHERE ((a.application_id = applications.id) AND (a.consultant_id = (select auth.uid())) AND (a.status = 'active'::text))))));

drop policy if exists "audit_events_owner_read" on public."audit_events";
create policy "audit_events_owner_read" on public."audit_events"
  as permissive
  for select
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = audit_events.application_id))));

drop policy if exists "beta_cohort_members_self_read" on public."beta_cohort_members";
create policy "beta_cohort_members_self_read" on public."beta_cohort_members"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "beta_feedback_self_insert" on public."beta_feedback";
create policy "beta_feedback_self_insert" on public."beta_feedback"
  as permissive
  for insert
  to public
  with check (((select auth.uid()) = user_id));

drop policy if exists "beta_feedback_self_read" on public."beta_feedback";
create policy "beta_feedback_self_read" on public."beta_feedback"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "checklist_own_rows" on public."checklist_items";
create policy "checklist_own_rows" on public."checklist_items"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = checklist_items.application_id))));

drop policy if exists "consultant_approvals_assigned_insert" on public."consultant_approvals";
create policy "consultant_approvals_assigned_insert" on public."consultant_approvals"
  as permissive
  for insert
  to public
  with check ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (((select auth.uid()) = consultant_id) AND (EXISTS ( SELECT 1
   FROM consultant_assignments a
  WHERE ((a.application_id = consultant_approvals.application_id) AND (a.consultant_id = (select auth.uid())) AND (a.status = 'active'::text)))))));

drop policy if exists "consultant_approvals_owner_read" on public."consultant_approvals";
create policy "consultant_approvals_owner_read" on public."consultant_approvals"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = consultant_approvals.application_id))) OR ((select auth.uid()) = consultant_id)));

drop policy if exists "consultant_assignments_owner_admin_insert" on public."consultant_assignments";
create policy "consultant_assignments_owner_admin_insert" on public."consultant_assignments"
  as permissive
  for insert
  to public
  with check ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR ((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = consultant_assignments.application_id)))));

drop policy if exists "consultant_assignments_owner_admin_update" on public."consultant_assignments";
create policy "consultant_assignments_owner_admin_update" on public."consultant_assignments"
  as permissive
  for update
  to public
  using ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR ((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = consultant_assignments.application_id)))));

drop policy if exists "consultant_assignments_owner_read" on public."consultant_assignments";
create policy "consultant_assignments_owner_read" on public."consultant_assignments"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = consultant_assignments.application_id))) OR ((select auth.uid()) = consultant_id)));

drop policy if exists "consultant_assignments_self_insert" on public."consultant_assignments";
create policy "consultant_assignments_self_insert" on public."consultant_assignments"
  as permissive
  for insert
  to public
  with check ((((select auth.uid()) = consultant_id) AND (status = 'active'::text) AND (NOT app_has_active_consultant(application_id)) AND consultant_covers_country((select auth.uid()), app_destination_country(application_id))));

drop policy if exists "consultant_availability_owner_write" on public."consultant_availability";
create policy "consultant_availability_owner_write" on public."consultant_availability"
  as permissive
  for all
  to public
  using ((EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultant_availability.consultant_id) AND (cp.user_id = (select auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultant_availability.consultant_id) AND (cp.user_id = (select auth.uid()))))));

drop policy if exists "consultant_countries_admin_write" on public."consultant_countries";
create policy "consultant_countries_admin_write" on public."consultant_countries"
  as permissive
  for all
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))
  with check (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "consultant_countries_self_or_admin_read" on public."consultant_countries";
create policy "consultant_countries_self_or_admin_read" on public."consultant_countries"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = consultant_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

drop policy if exists "consultant_notes_staff_insert" on public."consultant_notes";
create policy "consultant_notes_staff_insert" on public."consultant_notes"
  as permissive
  for insert
  to public
  with check (((author_id = (select auth.uid())) AND (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid())))));

drop policy if exists "consultant_notes_staff_select" on public."consultant_notes";
create policy "consultant_notes_staff_select" on public."consultant_notes"
  as permissive
  for select
  to public
  using ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "consultant_notes_staff_update" on public."consultant_notes";
create policy "consultant_notes_staff_update" on public."consultant_notes"
  as permissive
  for update
  to public
  using ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))))
  with check ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "consultant_payout_items_read" on public."consultant_payout_items";
create policy "consultant_payout_items_read" on public."consultant_payout_items"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM (consultant_payouts p
     JOIN consultant_profiles cp ON ((cp.id = p.consultant_id)))
  WHERE ((p.id = consultant_payout_items.payout_id) AND ((cp.user_id = (select auth.uid())) OR is_marketplace_admin())))));

drop policy if exists "consultant_payouts_owner_read" on public."consultant_payouts";
create policy "consultant_payouts_owner_read" on public."consultant_payouts"
  as permissive
  for select
  to public
  using (((EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultant_payouts.consultant_id) AND (cp.user_id = (select auth.uid()))))) OR is_marketplace_admin()));

drop policy if exists "consultant_profiles_owner_write" on public."consultant_profiles";
create policy "consultant_profiles_owner_write" on public."consultant_profiles"
  as permissive
  for all
  to public
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

drop policy if exists "consultant_profiles_public_read" on public."consultant_profiles";
create policy "consultant_profiles_public_read" on public."consultant_profiles"
  as permissive
  for select
  to public
  using (((active_status = 'active'::text) OR ((select auth.uid()) = user_id) OR is_marketplace_admin()));

drop policy if exists "consultant_reviews_author_update" on public."consultant_reviews";
create policy "consultant_reviews_author_update" on public."consultant_reviews"
  as permissive
  for update
  to public
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

drop policy if exists "consultant_reviews_author_write" on public."consultant_reviews";
create policy "consultant_reviews_author_write" on public."consultant_reviews"
  as permissive
  for insert
  to public
  with check (((select auth.uid()) = user_id));

drop policy if exists "service_orders_participant_read" on public."consultant_service_orders";
create policy "service_orders_participant_read" on public."consultant_service_orders"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultant_service_orders.consultant_id) AND (cp.user_id = (select auth.uid()))))) OR is_marketplace_admin()));

drop policy if exists "consultant_skills_owner_write" on public."consultant_skills";
create policy "consultant_skills_owner_write" on public."consultant_skills"
  as permissive
  for all
  to public
  using ((EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultant_skills.consultant_id) AND (cp.user_id = (select auth.uid()))))))
  with check ((EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultant_skills.consultant_id) AND (cp.user_id = (select auth.uid()))))));

drop policy if exists "consultant_tax_profiles_owner_read" on public."consultant_tax_profiles";
create policy "consultant_tax_profiles_owner_read" on public."consultant_tax_profiles"
  as permissive
  for select
  to public
  using ((consultant_id IN ( SELECT consultant_profiles.id
   FROM consultant_profiles
  WHERE (consultant_profiles.user_id = (select auth.uid())))));

drop policy if exists "consultations_applicant_insert" on public."consultations";
create policy "consultations_applicant_insert" on public."consultations"
  as permissive
  for insert
  to public
  with check (((select auth.uid()) = user_id));

drop policy if exists "consultations_participant_read" on public."consultations";
create policy "consultations_participant_read" on public."consultations"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultations.consultant_id) AND (cp.user_id = (select auth.uid()))))) OR is_marketplace_admin()));

drop policy if exists "consultations_participant_write" on public."consultations";
create policy "consultations_participant_write" on public."consultations"
  as permissive
  for update
  to public
  using ((((select auth.uid()) = user_id) OR (EXISTS ( SELECT 1
   FROM consultant_profiles cp
  WHERE ((cp.id = consultations.consultant_id) AND (cp.user_id = (select auth.uid())))))))
  with check (true);

drop policy if exists "participants_own_select" on public."conversation_participants";
create policy "participants_own_select" on public."conversation_participants"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "participants_own_update" on public."conversation_participants";
create policy "participants_own_update" on public."conversation_participants"
  as permissive
  for update
  to public
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

drop policy if exists "conversations_access_insert" on public."conversations";
create policy "conversations_access_insert" on public."conversations"
  as permissive
  for insert
  to public
  with check ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = conversations.application_id))) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "conversations_access_select" on public."conversations";
create policy "conversations_access_select" on public."conversations"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = conversations.application_id))) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "conversations_access_update" on public."conversations";
create policy "conversations_access_update" on public."conversations"
  as permissive
  for update
  to public
  using ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = conversations.application_id))) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))))
  with check ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = conversations.application_id))) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "cross_verifications_own_rows" on public."cross_verifications";
create policy "cross_verifications_own_rows" on public."cross_verifications"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = cross_verifications.application_id))));

drop policy if exists "device_push_tokens_owner_all" on public."device_push_tokens";
create policy "device_push_tokens_owner_all" on public."device_push_tokens"
  as permissive
  for all
  to public
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists "access_logs_own_rows" on public."document_access_logs";
create policy "access_logs_own_rows" on public."document_access_logs"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "document_requests_access_select" on public."document_requests";
create policy "document_requests_access_select" on public."document_requests"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = document_requests.application_id))) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "document_requests_consultant_insert" on public."document_requests";
create policy "document_requests_consultant_insert" on public."document_requests"
  as permissive
  for insert
  to public
  with check (((requested_by = (select auth.uid())) AND (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid())))));

drop policy if exists "document_translations_owner_read" on public."document_translations";
create policy "document_translations_owner_read" on public."document_translations"
  as permissive
  for select
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = document_translations.application_id))));

drop policy if exists "doc_verifications_own_rows" on public."document_verifications";
create policy "doc_verifications_own_rows" on public."document_verifications"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT a.user_id
   FROM (documents d
     JOIN applications a ON ((a.id = d.application_id)))
  WHERE (d.id = document_verifications.document_id))));

drop policy if exists "documents_own_rows" on public."documents";
create policy "documents_own_rows" on public."documents"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = documents.application_id))));

drop policy if exists "escalation_staff_insert" on public."escalation_history";
create policy "escalation_staff_insert" on public."escalation_history"
  as permissive
  for insert
  to public
  with check (((escalated_by = (select auth.uid())) AND (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid())))));

drop policy if exists "escalation_staff_select" on public."escalation_history";
create policy "escalation_staff_select" on public."escalation_history"
  as permissive
  for select
  to public
  using ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "escalation_staff_update" on public."escalation_history";
create policy "escalation_staff_update" on public."escalation_history"
  as permissive
  for update
  to public
  using ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))))
  with check ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(application_id, (select auth.uid()))));

drop policy if exists "evidence_packages_owner_read" on public."evidence_packages";
create policy "evidence_packages_owner_read" on public."evidence_packages"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = evidence_packages.application_id))) OR ((select auth.uid()) = consultant_id)));

drop policy if exists "field_provenance_owner_read" on public."field_provenance";
create policy "field_provenance_owner_read" on public."field_provenance"
  as permissive
  for select
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = field_provenance.application_id))));

drop policy if exists "field_verifications_owner_read" on public."field_verifications";
create policy "field_verifications_owner_read" on public."field_verifications"
  as permissive
  for select
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = field_verifications.application_id))));

drop policy if exists "gen_docs_own_rows" on public."generated_documents";
create policy "gen_docs_own_rows" on public."generated_documents"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = generated_documents.application_id))));

drop policy if exists "intake_messages_own_rows" on public."intake_messages";
create policy "intake_messages_own_rows" on public."intake_messages"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = intake_messages.application_id))));

drop policy if exists "login_history_owner_read" on public."login_history";
create policy "login_history_owner_read" on public."login_history"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

drop policy if exists "marketing_attribution_select_own" on public."marketing_attribution";
create policy "marketing_attribution_select_own" on public."marketing_attribution"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "marketing_attribution_update_own" on public."marketing_attribution";
create policy "marketing_attribution_update_own" on public."marketing_attribution"
  as permissive
  for update
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "marketing_attribution_upsert_own" on public."marketing_attribution";
create policy "marketing_attribution_upsert_own" on public."marketing_attribution"
  as permissive
  for insert
  to public
  with check (((select auth.uid()) = user_id));

drop policy if exists "message_attachments_access_insert" on public."message_attachments";
create policy "message_attachments_access_insert" on public."message_attachments"
  as permissive
  for insert
  to public
  with check ((EXISTS ( SELECT 1
   FROM (conversations c
     JOIN applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = message_attachments.conversation_id) AND (((select auth.uid()) = app.user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(app.id, (select auth.uid())))))));

drop policy if exists "message_attachments_access_select" on public."message_attachments";
create policy "message_attachments_access_select" on public."message_attachments"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM (conversations c
     JOIN applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = message_attachments.conversation_id) AND (((select auth.uid()) = app.user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(app.id, (select auth.uid())))))));

drop policy if exists "messages_access_insert" on public."messages";
create policy "messages_access_insert" on public."messages"
  as permissive
  for insert
  to public
  with check (((sender_id = (select auth.uid())) AND (EXISTS ( SELECT 1
   FROM (conversations c
     JOIN applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = messages.conversation_id) AND (((select auth.uid()) = app.user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(app.id, (select auth.uid()))))))));

drop policy if exists "messages_access_select" on public."messages";
create policy "messages_access_select" on public."messages"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM (conversations c
     JOIN applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = messages.conversation_id) AND (((select auth.uid()) = app.user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(app.id, (select auth.uid())))))));

drop policy if exists "notification_deliveries_own_select" on public."notification_deliveries";
create policy "notification_deliveries_own_select" on public."notification_deliveries"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "notification_preferences_owner_all" on public."notification_preferences";
create policy "notification_preferences_owner_all" on public."notification_preferences"
  as permissive
  for all
  to public
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists "notifications_own_select" on public."notifications";
create policy "notifications_own_select" on public."notifications"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "notifications_own_update" on public."notifications";
create policy "notifications_own_update" on public."notifications"
  as permissive
  for update
  to public
  using (((select auth.uid()) = user_id))
  with check (((select auth.uid()) = user_id));

drop policy if exists "ocr_runs_owner_read" on public."ocr_runs";
create policy "ocr_runs_owner_read" on public."ocr_runs"
  as permissive
  for select
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = ocr_runs.application_id))));

drop policy if exists "organization_invitations_member_read" on public."organization_invitations";
create policy "organization_invitations_member_read" on public."organization_invitations"
  as permissive
  for select
  to public
  using ((((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = organization_invitations.organization_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text))))));

drop policy if exists "organization_members_self_read" on public."organization_members";
create policy "organization_members_self_read" on public."organization_members"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

drop policy if exists "organizations_member_read" on public."organizations";
create policy "organizations_member_read" on public."organizations"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = owner_user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = organizations.id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text))))));

drop policy if exists "partner_api_keys_org_member_read" on public."partner_api_keys";
create policy "partner_api_keys_org_member_read" on public."partner_api_keys"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM ((partner_applications a
     JOIN partners p ON ((p.id = a.partner_id)))
     JOIN organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((a.id = partner_api_keys.application_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));

drop policy if exists "partner_api_requests_org_member_read" on public."partner_api_requests";
create policy "partner_api_requests_org_member_read" on public."partner_api_requests"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM ((partner_applications a
     JOIN partners p ON ((p.id = a.partner_id)))
     JOIN organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((a.id = partner_api_requests.application_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));

drop policy if exists "partner_applications_org_member_read" on public."partner_applications";
create policy "partner_applications_org_member_read" on public."partner_applications"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM (partners p
     JOIN organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((p.id = partner_applications.partner_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));

drop policy if exists "partner_user_consents_owner_read" on public."partner_user_consents";
create policy "partner_user_consents_owner_read" on public."partner_user_consents"
  as permissive
  for select
  to public
  using ((user_id = (select auth.uid())));

drop policy if exists "partner_user_consents_owner_update" on public."partner_user_consents";
create policy "partner_user_consents_owner_update" on public."partner_user_consents"
  as permissive
  for update
  to public
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists "partner_webhook_deliveries_org_member_read" on public."partner_webhook_deliveries";
create policy "partner_webhook_deliveries_org_member_read" on public."partner_webhook_deliveries"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM (((partner_webhook_endpoints e
     JOIN partner_applications a ON ((a.id = e.application_id)))
     JOIN partners p ON ((p.id = a.partner_id)))
     JOIN organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((e.id = partner_webhook_deliveries.endpoint_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));

drop policy if exists "partner_webhook_endpoints_org_member_read" on public."partner_webhook_endpoints";
create policy "partner_webhook_endpoints_org_member_read" on public."partner_webhook_endpoints"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM ((partner_applications a
     JOIN partners p ON ((p.id = a.partner_id)))
     JOIN organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((a.id = partner_webhook_endpoints.application_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));

drop policy if exists "partners_org_member_read" on public."partners";
create policy "partners_org_member_read" on public."partners"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.organization_id = partners.organization_id) AND (m.user_id = (select auth.uid())) AND (m.status = 'active'::text)))));

drop policy if exists "payment_disputes_admin_read" on public."payment_disputes";
create policy "payment_disputes_admin_read" on public."payment_disputes"
  as permissive
  for select
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "payment_dunning_admin_read" on public."payment_dunning";
create policy "payment_dunning_admin_read" on public."payment_dunning"
  as permissive
  for select
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "payment_events_admin_read" on public."payment_events";
create policy "payment_events_admin_read" on public."payment_events"
  as permissive
  for select
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "payments_own_rows" on public."payments";
create policy "payments_own_rows" on public."payments"
  as permissive
  for all
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "payout_tax_statements_admin_read" on public."payout_tax_statements";
create policy "payout_tax_statements_admin_read" on public."payout_tax_statements"
  as permissive
  for select
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "payout_tax_statements_owner_read" on public."payout_tax_statements";
create policy "payout_tax_statements_owner_read" on public."payout_tax_statements"
  as permissive
  for select
  to public
  using ((consultant_id IN ( SELECT consultant_profiles.id
   FROM consultant_profiles
  WHERE (consultant_profiles.user_id = (select auth.uid())))));

drop policy if exists "events_own_rows" on public."post_submission_events";
create policy "events_own_rows" on public."post_submission_events"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = post_submission_events.application_id))));

drop policy if exists "preflight_reviews_owner_read" on public."preflight_reviews";
create policy "preflight_reviews_owner_read" on public."preflight_reviews"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = preflight_reviews.application_id))) OR ((select auth.uid()) = reviewer_id)));

drop policy if exists "push_subscriptions_owner_all" on public."push_subscriptions";
create policy "push_subscriptions_owner_all" on public."push_subscriptions"
  as permissive
  for all
  to public
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists "reconciliation_exceptions_admin_read" on public."reconciliation_exceptions";
create policy "reconciliation_exceptions_admin_read" on public."reconciliation_exceptions"
  as permissive
  for select
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "reconciliation_runs_admin_read" on public."reconciliation_runs";
create policy "reconciliation_runs_admin_read" on public."reconciliation_runs"
  as permissive
  for select
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "refunds_admin_read" on public."refunds";
create policy "refunds_admin_read" on public."refunds"
  as permissive
  for select
  to public
  using (((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));

drop policy if exists "sessions_own_rows" on public."submission_sessions";
create policy "sessions_own_rows" on public."submission_sessions"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = submission_sessions.application_id))));

drop policy if exists "subscription_credits_own_read" on public."subscription_credits";
create policy "subscription_credits_own_read" on public."subscription_credits"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "subscriptions_own_read" on public."subscriptions";
create policy "subscriptions_own_read" on public."subscriptions"
  as permissive
  for select
  to public
  using (((select auth.uid()) = user_id));

drop policy if exists "user_profiles_owner_all" on public."user_profiles";
create policy "user_profiles_owner_all" on public."user_profiles"
  as permissive
  for all
  to public
  using ((((select auth.uid()) = user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)))
  with check (((select auth.uid()) = user_id));

drop policy if exists "user_roles_self_read" on public."user_roles";
create policy "user_roles_self_read" on public."user_roles"
  as permissive
  for select
  to public
  using ((((select auth.uid()) = user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));

drop policy if exists "users_own_rows" on public."users";
create policy "users_own_rows" on public."users"
  as permissive
  for all
  to public
  using (((select auth.uid()) = id));

drop policy if exists "voice_consents_owner_all" on public."voice_consents";
create policy "voice_consents_owner_all" on public."voice_consents"
  as permissive
  for all
  to public
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists "voice_messages_access_insert" on public."voice_messages";
create policy "voice_messages_access_insert" on public."voice_messages"
  as permissive
  for insert
  to public
  with check ((EXISTS ( SELECT 1
   FROM (conversations c
     JOIN applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = voice_messages.conversation_id) AND (((select auth.uid()) = app.user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(app.id, (select auth.uid())))))));

drop policy if exists "voice_messages_access_select" on public."voice_messages";
create policy "voice_messages_access_select" on public."voice_messages"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM (conversations c
     JOIN applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = voice_messages.conversation_id) AND (((select auth.uid()) = app.user_id) OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR is_active_assignee(app.id, (select auth.uid())))))));

drop policy if exists "voice_sessions_owner_all" on public."voice_sessions";
create policy "voice_sessions_owner_all" on public."voice_sessions"
  as permissive
  for all
  to public
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists "voice_turns_owner_all" on public."voice_transcript_turns";
create policy "voice_turns_owner_all" on public."voice_transcript_turns"
  as permissive
  for all
  to public
  using ((user_id = (select auth.uid())))
  with check ((user_id = (select auth.uid())));

drop policy if exists "voice_turns_shared_consultant_read" on public."voice_transcript_turns";
create policy "voice_turns_shared_consultant_read" on public."voice_transcript_turns"
  as permissive
  for select
  to public
  using ((EXISTS ( SELECT 1
   FROM ((voice_sessions vs
     JOIN consultations c ON ((c.id = vs.escalated_to_consultation_id)))
     JOIN consultant_profiles cp ON ((cp.id = c.consultant_id)))
  WHERE ((vs.id = voice_transcript_turns.session_id) AND (cp.user_id = (select auth.uid()))))));

drop policy if exists "vri_recs_own_rows" on public."vri_recommendations";
create policy "vri_recs_own_rows" on public."vri_recommendations"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT a.user_id
   FROM (vri_scores v
     JOIN applications a ON ((a.id = v.application_id)))
  WHERE (v.id = vri_recommendations.vri_score_id))));

drop policy if exists "vri_scores_own_rows" on public."vri_scores";
create policy "vri_scores_own_rows" on public."vri_scores"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT applications.user_id
   FROM applications
  WHERE (applications.id = vri_scores.application_id))));

drop policy if exists "vri_visa_suggestions_own_rows" on public."vri_visa_suggestions";
create policy "vri_visa_suggestions_own_rows" on public."vri_visa_suggestions"
  as permissive
  for all
  to public
  using (((select auth.uid()) = ( SELECT a.user_id
   FROM (vri_scores v
     JOIN applications a ON ((a.id = v.application_id)))
  WHERE (v.id = vri_visa_suggestions.vri_score_id))));

commit;
