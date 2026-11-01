-- Rollback for 20261020120000_field_provenance_retire.
-- Retired rows (superseded_by = id) stay retired: un-retire by hand if needed.

drop function if exists public.field_provenance_retire(uuid, uuid, text[]);

-- create_version without the per-field lock (as 20260606000008).
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
) returns public.field_provenance
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
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
$$;

-- The relink trigger as 20261015043000 shipped it.
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

drop function if exists public.field_provenance_lock(uuid, text);
