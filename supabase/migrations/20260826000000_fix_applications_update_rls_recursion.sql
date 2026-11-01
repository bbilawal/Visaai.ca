-- Every owner UPDATE on `applications` failed.
--
--   ERROR: infinite recursion detected in policy for relation "applications"
--
-- Found live: choosing a visa route on /intake answered 500, from
-- IntakeService.setVisaType, on a row the caller owned.
--
-- THE CYCLE
--
--   UPDATE applications
--     → applications_owner_consultant_admin_update inlines
--       EXISTS (SELECT 1 FROM consultant_assignments ...)
--     → reading consultant_assignments applies consultant_assignments_owner_read
--     → which does (SELECT user_id FROM applications WHERE id = ...)
--     → back into applications' policies. Postgres refuses.
--
-- The SELECT policy on the same table does the identical check and does NOT
-- recurse, because it goes through is_active_assignee() — SECURITY DEFINER,
-- so the inner read of consultant_assignments runs without RLS and the cycle
-- never forms. 20260607000003 introduced that helper for exactly this reason
-- and converted the SELECT policy; the UPDATE policy kept the inline EXISTS,
-- and 20260809140000 carried it forward verbatim while hoisting auth calls.
--
-- This makes the UPDATE policy use the same helper. The predicate is
-- unchanged in meaning: the helper's body is the inlined EXISTS, argument for
-- argument. Owners and admins were already covered by the first two branches;
-- an active assignee stays covered by the third.

drop policy if exists "applications_owner_consultant_admin_update" on public."applications";

create policy "applications_owner_consultant_admin_update" on public."applications"
  as permissive
  for update
  to public
  using (
    ((select auth.uid()) = user_id)
    OR ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)
    -- SECURITY DEFINER: reads consultant_assignments without re-entering RLS.
    -- Inlining this EXISTS is what caused the recursion. Do not inline it.
    OR public.is_active_assignee(id, (select auth.uid()))
  );
