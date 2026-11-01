-- Rollback for AUDIT-006d: drop the relink trigger and restore SET NULL.
-- NOTE: this brings back the current-row collision on document delete.

drop trigger if exists field_provenance_relink_chain on public.field_provenance;
drop function if exists public.field_provenance_relink_chain();

alter table public.field_provenance
  drop constraint if exists field_provenance_superseded_by_fkey;

alter table public.field_provenance
  add constraint field_provenance_superseded_by_fkey
    foreign key (superseded_by) references public.field_provenance (id)
    on delete set null deferrable initially deferred;
