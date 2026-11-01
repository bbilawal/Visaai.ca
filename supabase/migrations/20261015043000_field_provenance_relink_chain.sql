-- AUDIT-006d: keep the provenance history chain intact when a member is
-- removed (completes owner-approved option a, 2026-10-15).
--
-- Each (application_id, field_key) has a history chain linked by superseded_by,
-- with at most one CURRENT row (field_provenance_current_uidx, superseded_by
-- IS NULL). superseded_by was ON DELETE SET NULL, so removing a row in the
-- MIDDLE of a chain (its source document deleted, 006c) promoted its
-- predecessor to "current" beside the real current row:
--
--   DELETE /documents/item/:id -> 500
--   duplicate key value violates unique constraint "field_provenance_current_uidx"
--
-- Correct behaviour: the predecessor inherits the deleted row's successor —
--   A -> B -> C, delete B  =>  A -> C        (C stays current)
--   A -> B,      delete B  =>  A current     (newest evidence gone, A takes over)
-- Postgres runs referential actions immediately even on a deferrable FK, so
-- the FK becomes a deferred NO ACTION check and an AFTER DELETE trigger does
-- the relink once the row is gone (so promoting A never collides with B).

alter table public.field_provenance
  drop constraint if exists field_provenance_superseded_by_fkey;

alter table public.field_provenance
  add constraint field_provenance_superseded_by_fkey
    foreign key (superseded_by) references public.field_provenance (id)
    on delete no action deferrable initially deferred;

-- Statement-level over the deleted rows: one cascade can remove several
-- members of the same chain, in any order, so relink in passes until no live
-- row points at a removed one (each pass skips one removed layer).
create or replace function public.field_provenance_relink_chain()
returns trigger
language plpgsql
-- SECURITY DEFINER: the delete arrives through the applicant's RLS-scoped
-- client, and field_provenance is service-role-write only. Run as invoker,
-- the relink UPDATE matched zero rows and the deferred FK then failed on
-- prod. It only re-points rows the authorised delete already orphaned.
security definer
set search_path = public
as $$
begin
  loop
    update public.field_provenance fp
       set superseded_by = g.superseded_by
      from removed g
     where fp.superseded_by = g.id;
    exit when not found;
  end loop;
  return null;
end;
$$;

drop trigger if exists field_provenance_relink_chain on public.field_provenance;
create trigger field_provenance_relink_chain
  after delete on public.field_provenance
  referencing old table as removed
  for each statement execute function public.field_provenance_relink_chain();

revoke all on function public.field_provenance_relink_chain() from public;
