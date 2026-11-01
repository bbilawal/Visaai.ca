-- =====================================================================
-- Gate 2 — Phase 2A.5  audit_events  (immutable, append-only, hash-chained)
-- Author: Database Architect   Date: 2026-06-06
-- Depends on: applications, users, documents, submission_sessions, ocr_runs,
--             pgcrypto, audit_event_type/audit_actor_role enums
--
-- Guarantees: INSERT-only (UPDATE/DELETE blocked 3 ways), per-application
-- hash chain, value HASHES only (no raw PII).
-- =====================================================================

-- ---- per-application chain head (serializes appends, holds chain tip) ----
create table if not exists public.audit_chain_state (
  application_id uuid primary key references public.applications on delete cascade,
  last_seq       bigint not null default 0,
  last_row_hash  text   not null
);

-- ---- the append-only log ------------------------------------------------
create table if not exists public.audit_events (
  id              uuid primary key default uuid_generate_v4(),
  application_id  uuid not null references public.applications on delete cascade,
  seq             bigint not null,
  event_type      audit_event_type not null,

  actor_id        uuid references public.users on delete set null,
  actor_role      audit_actor_role not null,

  document_id           uuid references public.documents on delete set null,
  ocr_run_id            uuid references public.ocr_runs on delete set null,
  field_key             text,
  submission_session_id uuid references public.submission_sessions on delete set null,

  from_state      text,
  to_state        text,

  payload         jsonb not null default '{}',   -- PII as value_hash only
  value_hash      text,
  payload_hash    text not null,
  prev_hash       text not null,
  row_hash        text not null,

  hash_algo       text not null default 'sha256',
  canon_version   smallint not null default 1,

  extension_version text,
  schema_version    text,

  occurred_at     timestamptz not null default now(),  -- SERVER time

  unique (application_id, seq),
  unique (application_id, row_hash)
);

create index if not exists audit_events_app_seq_idx  on public.audit_events (application_id, seq);
create index if not exists audit_events_type_idx     on public.audit_events (application_id, event_type);
create index if not exists audit_events_field_idx    on public.audit_events (application_id, field_key);
create index if not exists audit_events_session_idx  on public.audit_events (submission_session_id);
create index if not exists audit_events_occurred_idx on public.audit_events (occurred_at);

-- ---- IMMUTABILITY: trigger guard (layer 1) ------------------------------
create or replace function public.audit_no_mutate()
returns trigger as $$
begin
  raise exception 'audit_events is append-only: % not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$ language plpgsql;

drop trigger if exists audit_events_no_update on public.audit_events;
create trigger audit_events_no_update
  before update on public.audit_events
  for each row execute function public.audit_no_mutate();

drop trigger if exists audit_events_no_delete on public.audit_events;
create trigger audit_events_no_delete
  before delete on public.audit_events
  for each row execute function public.audit_no_mutate();

-- ---- RLS (layer 2): owner read only; writes only via definer fn ---------
alter table public.audit_events      enable row level security;
alter table public.audit_chain_state enable row level security;

drop policy if exists audit_events_owner_read on public.audit_events;
create policy audit_events_owner_read on public.audit_events
  for select using (
    auth.uid() = (select user_id from public.applications where id = application_id)
  );
-- no insert/update/delete policy -> only service role / definer fn writes.
-- audit_chain_state: no policy at all -> client-invisible; definer fn manages it.

-- ---- APPEND function: computes seq + hash chain atomically --------------
create or replace function public.audit_append(
  p_application_id        uuid,
  p_event_type           audit_event_type,
  p_actor_id             uuid,
  p_actor_role           audit_actor_role,
  p_payload              jsonb,
  p_value_hash           text default null,
  p_document_id          uuid default null,
  p_ocr_run_id           uuid default null,
  p_field_key            text default null,
  p_submission_session_id uuid default null,
  p_from_state           text default null,
  p_to_state             text default null,
  p_extension_version    text default null,
  p_schema_version       text default null
) returns public.audit_events as $$
declare
  v_seq          bigint;
  v_prev_hash    text;
  v_payload_hash text;
  v_row_hash     text;
  v_occurred     timestamptz := now();
  v_row          public.audit_events;
begin
  -- genesis = sha256(application_id)
  insert into public.audit_chain_state (application_id, last_seq, last_row_hash)
  values (p_application_id, 0, encode(digest(p_application_id::text, 'sha256'), 'hex'))
  on conflict (application_id) do nothing;

  select last_seq, last_row_hash into v_seq, v_prev_hash
  from public.audit_chain_state
  where application_id = p_application_id
  for update;                                   -- row lock => chain serialization

  v_seq := v_seq + 1;
  v_payload_hash := encode(digest(p_payload::text, 'sha256'), 'hex');
  v_row_hash := encode(digest(
    v_prev_hash || p_event_type::text || coalesce(p_field_key,'') ||
    coalesce(p_document_id::text,'') || v_payload_hash || v_occurred::text ||
    coalesce(p_actor_id::text,'system'),
    'sha256'), 'hex');

  insert into public.audit_events (
    application_id, seq, event_type, actor_id, actor_role,
    document_id, ocr_run_id, field_key, submission_session_id,
    from_state, to_state, payload, value_hash,
    payload_hash, prev_hash, row_hash,
    extension_version, schema_version, occurred_at
  ) values (
    p_application_id, v_seq, p_event_type, p_actor_id, p_actor_role,
    p_document_id, p_ocr_run_id, p_field_key, p_submission_session_id,
    p_from_state, p_to_state, p_payload, p_value_hash,
    v_payload_hash, v_prev_hash, v_row_hash,
    p_extension_version, p_schema_version, v_occurred
  ) returning * into v_row;

  update public.audit_chain_state
    set last_seq = v_seq, last_row_hash = v_row_hash
  where application_id = p_application_id;

  return v_row;
end;
$$ language plpgsql security definer;

-- ---- VERIFY function (layer 3): recompute chain, locate first break -----
create or replace function public.audit_verify_chain(p_application_id uuid)
returns table(broken_at_seq bigint, reason text) as $$
declare
  r      public.audit_events;
  v_prev text := encode(digest(p_application_id::text, 'sha256'), 'hex');
  v_calc text;
begin
  for r in
    select * from public.audit_events where application_id = p_application_id order by seq
  loop
    if r.prev_hash <> v_prev then
      broken_at_seq := r.seq; reason := 'prev_hash mismatch (gap or edit)'; return next; return;
    end if;
    v_calc := encode(digest(
      r.prev_hash || r.event_type::text || coalesce(r.field_key,'') ||
      coalesce(r.document_id::text,'') || r.payload_hash || r.occurred_at::text ||
      coalesce(r.actor_id::text,'system'), 'sha256'), 'hex');
    if v_calc <> r.row_hash then
      broken_at_seq := r.seq; reason := 'row_hash mismatch (tampered)'; return next; return;
    end if;
    v_prev := r.row_hash;
  end loop;
  return;  -- intact
end;
$$ language plpgsql stable;

comment on table public.audit_events is
  'Gate 2: append-only, hash-chained audit log. UPDATE/DELETE blocked. value_hash only, no raw PII.';

-- =====================================================================
-- ROLLBACK:
--   drop function if exists public.audit_verify_chain(uuid);
--   drop function if exists public.audit_append(uuid,audit_event_type,uuid,audit_actor_role,jsonb,text,uuid,uuid,text,uuid,text,text,text,text);
--   drop trigger if exists audit_events_no_update on public.audit_events;
--   drop trigger if exists audit_events_no_delete on public.audit_events;
--   drop function if exists public.audit_no_mutate();
--   drop table if exists public.audit_events;
--   drop table if exists public.audit_chain_state;
-- =====================================================================
