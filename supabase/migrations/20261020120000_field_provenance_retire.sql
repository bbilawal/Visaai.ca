-- Retire a document's provenance for fields a re-read no longer gives
-- (live 2026-10-19, application dc91b2c8).
--
-- A lease PDF first read as an ID card left the landlord's CNIC as the
-- application's current national_id_number. Re-read as a lease (#233) it gave
-- no ID number, but provenance is one-current-per-field and append-only, so
-- the old value stayed current and the consultant was offered it to approve.
--
-- Retired = superseded_by points at the row itself. Every "current" reader
-- (superseded_by IS NULL) drops it; the read history keeps it. Each retired
-- row is spliced out of its field's chain the way the delete trigger
-- (20261015043000) does it: its predecessor inherits its successor, so the
-- field falls back to its previous version, or has none.
--
-- One transaction, under a per-field advisory lock that create_version now
-- takes too, so a concurrent version write cannot interleave with a splice
-- (review of #248). A field whose current value a consultant approved is left
-- alone: retiring it would silently break a locked review.
--
-- Additive + idempotent. No data change on apply.

-- 1) The per-field lock, shared by both writers.
create or replace function public.field_provenance_lock(
  p_application_id uuid,
  p_field_key      text
) returns void
language sql
set search_path = public, extensions, pg_temp
as $$
  select pg_advisory_xact_lock(
    hashtext('field_provenance:' || p_application_id::text || ':' || p_field_key)
  );
$$;

-- 2) create_version, unchanged but for taking the lock first.
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
  perform public.field_provenance_lock(p_application_id, p_field_key);

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

-- 3) Retire one document's versions of every field NOT in p_keep (what the
--    re-read gave, plus what its document type may give: a field a flaky read
--    merely missed is never retired). Returns, per field, how many versions
--    were retired, or skipped_approved when the consultant approved its
--    current value (left alone, reported so it can be audited).
create or replace function public.field_provenance_retire(
  p_application_id uuid,
  p_document_id    uuid,
  p_keep           text[]
) returns table (field_key text, retired int, skipped_approved boolean)
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_key  text;
  v_id   uuid;
  v_next uuid;
  v_n    int;
begin
  for v_key in
    select distinct fp.field_key
      from public.field_provenance fp
     where fp.application_id = p_application_id
       and fp.source_document_id = p_document_id
       and fp.superseded_by is distinct from fp.id
       and not (fp.field_key = any (coalesce(p_keep, '{}')))
     order by 1
  loop
    perform public.field_provenance_lock(p_application_id, v_key);

    -- The consultant's latest field decision approved the current value:
    -- leave it; a background re-read must not break a locked review.
    if exists (
      select 1
        from public.field_provenance cur
        join lateral (
          select ca.decision, ca.value_hash
            from public.consultant_approvals ca
           where ca.application_id = p_application_id
             and ca.scope = 'field'
             and ca.field_key = v_key
           order by ca.decided_at desc, ca.id desc
           limit 1
        ) last on true
       where cur.application_id = p_application_id
         and cur.field_key = v_key
         and cur.superseded_by is null
         and cur.source_document_id = p_document_id
         and last.decision = 'approved'
         and last.value_hash is not distinct from cur.value_hash
    ) then
      field_key := v_key;
      retired := 0;
      skipped_approved := true;
      return next;
      continue;
    end if;

    v_n := 0;
    for v_id in
      select fp.id
        from public.field_provenance fp
       where fp.application_id = p_application_id
         and fp.field_key = v_key
         and fp.source_document_id = p_document_id
         and fp.superseded_by is distinct from fp.id
       order by fp.id
       for update
    loop
      -- Read now: an earlier splice in this loop may have re-pointed it.
      select fp.superseded_by into v_next
        from public.field_provenance fp where fp.id = v_id;
      -- Retire first (the field may briefly have no current row), then let
      -- the predecessor inherit the successor (null: it becomes current).
      update public.field_provenance set superseded_by = id where id = v_id;
      update public.field_provenance
         set superseded_by = v_next
       where superseded_by = v_id
         and id <> v_id;
      v_n := v_n + 1;
    end loop;

    if v_n > 0 then
      field_key := v_key;
      retired := v_n;
      skipped_approved := false;
      return next;
    end if;
  end loop;
end;
$$;

-- Service-role only. Supabase's default privileges grant EXECUTE on new
-- public functions to anon and authenticated explicitly, so revoking from
-- public alone left a SECURITY DEFINER that any caller could aim at any
-- application (review of #248; same class as 20260816120100_sec_rpc_lockdown).
revoke all on function public.field_provenance_retire(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.field_provenance_retire(uuid, uuid, text[]) to service_role;
revoke all on function public.field_provenance_lock(uuid, text) from public, anon, authenticated;

comment on function public.field_provenance_retire is
  'Retire (superseded_by = id) a document''s versions of fields its re-read no longer gives; splice each out of its chain under the per-field lock. Skips a consultant-approved current value.';

-- 4) Relink trigger: never follow a retired row's self-pointer. (A document
--    delete does not take the per-field lock: racing a retirement it either
--    waits on its row locks or deadlocks, and one side fails cleanly to be
--    retried — never a corrupt chain.) A live row
--    pointing at a retired one (only possible from data written outside the
--    retire function) used to make this loop forever; now the deferred FK
--    reports it instead.
create or replace function public.field_provenance_relink_chain()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  loop
    update public.field_provenance fp
       set superseded_by = g.superseded_by
      from removed g
     where fp.superseded_by = g.id
       and g.superseded_by is distinct from g.id;
    exit when not found;
  end loop;
  return null;
end;
$$;

-- =====================================================================
-- ROLLBACK: rollback/20261020120000_field_provenance_retire.down.sql
--   drop function if exists public.field_provenance_retire(uuid, uuid, text[]);
--   re-apply 20260606000008 (create_version without the lock) and
--   20261015043000 (relink trigger), then
--   drop function if exists public.field_provenance_lock(uuid, text);
-- Retired rows (superseded_by = id) stay retired; un-retire by hand if needed.
-- =====================================================================
