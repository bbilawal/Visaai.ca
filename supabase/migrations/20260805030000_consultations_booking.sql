-- Mobile (Task 9) Phase 10: make `consultations` bookable by an applicant.
--
-- 20260626000000 created the table with SELECT (participants + admin) and
-- UPDATE (participants) policies but **no INSERT policy**. With RLS enabled and
-- no INSERT policy, every insert through the RLS-scoped client is denied, which
-- is why no booking endpoint could exist. The applicant is the party who books,
-- so INSERT is scoped to rows they own.
--
-- Cancel/reschedule ride the existing participant UPDATE policy.

create policy consultations_applicant_insert on public.consultations
  for insert
  with check (auth.uid() = user_id);

-- Double-booking guard at the database, not just in the service. Two concurrent
-- requests can both pass an application-level "is this slot free?" check; a
-- partial exclusion constraint makes the second one fail atomically.
-- Cancelled / no-show rows are excluded so a released slot is rebookable.
create extension if not exists btree_gist;

alter table public.consultations
  add constraint consultations_no_overlap
  exclude using gist (
    consultant_id with =,
    tstzrange(scheduled_start, scheduled_end) with &&
  )
  where (status in ('requested', 'confirmed'));

-- Slot-search predicate: "all live bookings for this consultant in a window".
create index if not exists consultations_consultant_window_idx
  on public.consultations (consultant_id, scheduled_start, scheduled_end)
  where status in ('requested', 'confirmed');
