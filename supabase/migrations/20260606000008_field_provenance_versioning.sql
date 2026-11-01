-- =====================================================================
-- Gate 2 — SCHEMA CORRECTNESS AMENDMENT  field_provenance atomic versioning
-- Author: Backend (Provenance)   Date: 2026-06-06
-- Classification: Schema Correctness Amendment (NOT a new feature). Enforces the
-- already-approved invariant "supersede creates a new immutable version without
-- rewriting history", which the shipped one-current partial-unique model cannot
-- otherwise satisfy safely.
--
-- Corrective dependency for ProvenanceService supersede/versioning. The
-- one-current partial-unique index (field_provenance_current_uidx) makes the
-- "insert new current while old current still null" ordering impossible without
-- superseding the old row FIRST. Superseding first requires the self-FK to allow
-- a not-yet-existing target until commit -> make it DEFERRABLE, and do both
-- writes inside one function (update-old-then-insert-new).
--
-- Additive + idempotent. No data change.
-- =====================================================================

-- 1) Make the lineage self-FK deferrable so update-first ordering is legal.
alter table public.field_provenance
  drop constraint if exists field_provenance_superseded_by_fkey;

alter table public.field_provenance
  add constraint field_provenance_superseded_by_fkey
  foreign key (superseded_by) references public.field_provenance(id)
  on delete set null
  deferrable initially deferred;

-- 2) Atomic version creation: supersede current (if any) -> insert new current.
--    Order matters: UPDATE clears the old null (0 current) BEFORE INSERT adds the
--    new null (1 current), so the partial-unique index is never violated. The
--    deferred FK tolerates superseded_by = v_new_id until commit, when the new
--    row exists. SECURITY DEFINER: provenance is a service-role write path.
create or replace function public.field_provenance_create_version(
  p_application_id     uuid,
  p_field_key         text,
  p_origin            text,
  p_value_snapshot    text,
  p_value_hash        text,
  p_source_document_id uuid,
  p_source_page       int,
  p_source_bbox       jsonb,
  p_ocr_run_id        uuid,
  p_confidence        numeric,
  p_confidence_band   text
) returns public.field_provenance as $$
declare
  v_new_id uuid := uuid_generate_v4();
  v_row    public.field_provenance;
begin
  -- supersede the existing current row (if present) -> point it at the new id
  update public.field_provenance
     set superseded_by = v_new_id
   where application_id = p_application_id
     and field_key = p_field_key
     and superseded_by is null;

  insert into public.field_provenance (
    id, application_id, field_key, origin, value_snapshot, value_hash,
    source_document_id, source_page, source_bbox, ocr_run_id,
    confidence, confidence_band
  ) values (
    v_new_id, p_application_id, p_field_key, p_origin, p_value_snapshot, p_value_hash,
    p_source_document_id, p_source_page, p_source_bbox, p_ocr_run_id,
    p_confidence, p_confidence_band
  ) returning * into v_row;

  return v_row;
end;
$$ language plpgsql security definer;

comment on function public.field_provenance_create_version is
  'Gate 2 / 2E: atomic supersede-then-insert. One current per (application,field). Append-only versioning.';

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.field_provenance_create_version(uuid,text,text,text,text,uuid,int,jsonb,uuid,numeric,text);
--   alter table public.field_provenance drop constraint if exists field_provenance_superseded_by_fkey;
--   alter table public.field_provenance
--     add constraint field_provenance_superseded_by_fkey
--     foreign key (superseded_by) references public.field_provenance(id) on delete set null;
-- =====================================================================
