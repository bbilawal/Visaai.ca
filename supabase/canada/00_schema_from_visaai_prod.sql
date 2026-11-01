-- visaai.ca schema: pg_dump --schema-only of the visaai.co production public
-- schema (bbilawal/VisaAI @ af36795e), cleaned for Supabase Cloud.
create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;
create extension if not exists pgcrypto with schema extensions;
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--



--
-- Name: audit_actor_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_actor_role AS ENUM (
    'system',
    'applicant',
    'consultant',
    'admin'
);


--
-- Name: audit_event_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_event_type AS ENUM (
    'DOCUMENT_UPLOADED',
    'OCR_COMPLETED',
    'FIELD_EXTRACTED',
    'FIELD_EDITED',
    'USER_CONFIRMED',
    'CONSULTANT_REVIEWED',
    'CONSULTANT_APPROVED',
    'PREFLIGHT_STARTED',
    'PREFLIGHT_COMPLETED',
    'EXECUTION_STARTED',
    'EXECUTION_COMPLETED',
    'EXECUTION_FAILED',
    'EXECUTION_READY',
    'READBACK_CONFIRMED',
    'EXECUTION_REQUESTED',
    'LEGACY_AUTOMATION_BLOCKED',
    'PORTAL_FILL_STARTED',
    'FIELD_WRITE_ATTEMPT',
    'READBACK_COMPARE',
    'FIELD_VERIFIED',
    'PORTAL_FILL_COMPLETED',
    'CONSULTANT_SELF_ASSIGNED',
    'CONSULTANT_ASSIGNED',
    'CONSULTANT_REASSIGNED',
    'CONSULTANT_UNASSIGNED',
    'CONSULTANT_COMPLETED',
    'CONSULTANT_DEADLINE_CHANGED',
    'CONSULTANT_ASSIGNMENT_EXPIRED',
    'CONSULTANT_ESCALATION_FLAGGED'
);


--
-- Name: consultant_decision; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.consultant_decision AS ENUM (
    'reviewed',
    'approved',
    'rejected',
    'revoked',
    'not_applicable'
);


--
-- Name: preflight_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.preflight_status AS ENUM (
    'in_review',
    'completed',
    'invalidated'
);


--
-- Name: verification_state; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_state AS ENUM (
    'EXTRACTED',
    'USER_CONFIRMED',
    'CONSULTANT_REVIEWED',
    'CONSULTANT_APPROVED',
    'EXECUTION_READY',
    'EXECUTED'
);


--
-- Name: app_destination_country(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_destination_country(p_app uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select destination_country from public.applications where id = p_app;
$$;


--
-- Name: app_has_active_consultant(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.app_has_active_consultant(p_app uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.consultant_assignments a
    where a.application_id = p_app and a.status = 'active'
  );
$$;


--
-- Name: audit_no_mutate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_no_mutate() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  raise exception 'audit_events is append-only: % not permitted', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;


--
-- Name: audit_verify_chain(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.audit_verify_chain(p_application_id uuid) RETURNS TABLE(broken_at_seq bigint, reason text)
    LANGUAGE plpgsql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  r             public.audit_events;
  v_prev        text := encode(digest(p_application_id::text, 'sha256'), 'hex'); -- genesisHash(applicationId)
  v_calc        text;
  v_expected_seq bigint := 1;
begin
  for r in
    select * from public.audit_events
    where application_id = p_application_id
    order by seq
  loop
    -- (a) seq monotonicity — matches TS "seq gap (missing or reordered row)"
    if r.seq <> v_expected_seq then
      broken_at_seq := r.seq;
      reason := 'seq gap (missing or reordered row)';
      return next; return;
    end if;

    -- (b) chain linkage — matches TS "prev_hash mismatch (gap or edit)"
    if r.prev_hash <> v_prev then
      broken_at_seq := r.seq;
      reason := 'prev_hash mismatch (gap or edit)';
      return next; return;
    end if;

    -- (c) row_hash recompute — BYTE-FOR-BYTE the app's computeRowHash():
    --     [prev_hash, seq, event_type, actor_id|'system', actor_role,
    --      field_key|'', document_id|'', value_hash|'', payload_hash,
    --      occurred_at(ISO ms 'Z')].join('|')
    v_calc := encode(digest(
                 r.prev_hash                                              || '|' ||
                 r.seq::text                                              || '|' ||
                 r.event_type::text                                       || '|' ||
                 coalesce(r.actor_id::text, 'system')                     || '|' ||
                 r.actor_role::text                                       || '|' ||
                 coalesce(r.field_key, '')                                || '|' ||
                 coalesce(r.document_id::text, '')                        || '|' ||
                 coalesce(r.value_hash, '')                               || '|' ||
                 r.payload_hash                                           || '|' ||
                 to_char(r.occurred_at at time zone 'UTC',
                         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                 'sha256'), 'hex');
    if v_calc <> r.row_hash then
      broken_at_seq := r.seq;
      reason := 'row_hash mismatch (row tampered)';
      return next; return;
    end if;

    v_prev := r.row_hash;
    v_expected_seq := v_expected_seq + 1;
  end loop;

  return;  -- no rows => chain intact
end;
$$;


--
-- Name: FUNCTION audit_verify_chain(p_application_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.audit_verify_chain(p_application_id uuid) IS 'Gate 2 reconcile (20260627000002): row_hash formula aligned byte-for-byte to the application TS authority (apps/api .../audit.service.ts computeRowHash). Checks seq monotonicity, prev_hash linkage, and row_hash. payload_hash is treated as an opaque stored value (TS canonical-JSON payload-content tamper detection stays in AuditService.verifyTrail). audit_append() was dropped: the app service-role insert is the sole authoritative writer.';


--
-- Name: bump_delivery_attempt(uuid, text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.bump_delivery_attempt(p_delivery_id uuid, p_status text, p_error text DEFAULT NULL::text) RETURNS void
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  update public.notification_deliveries
     set attempts   = attempts + 1,
         status     = p_status,
         error      = p_error,
         updated_at = now()
   where id = p_delivery_id;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: notification_outbox; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_outbox (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    event_type text NOT NULL,
    payload jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    attempts integer DEFAULT 0 NOT NULL,
    last_error text
);


--
-- Name: claim_outbox_batch(integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_outbox_batch(p_limit integer) RETURNS SETOF public.notification_outbox
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  update public.notification_outbox o
     set attempts = o.attempts + 1
   where o.id in (
     select id
       from public.notification_outbox
      where processed_at is null
      order by created_at
      for update skip locked
      limit p_limit
   )
  returning o.*;
$$;


--
-- Name: claim_payment_webhook_event(text, text, text, text, bigint, text, text, uuid, jsonb, timestamp with time zone); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.claim_payment_webhook_event(p_provider text, p_event_type text, p_provider_event_id text, p_provider_object_id text, p_amount_minor bigint, p_currency text, p_direction text, p_user_id uuid, p_related_entity jsonb, p_occurred_at timestamp with time zone) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_status text;
begin
  -- Insert the immutable receipt and the first processing lease in one
  -- transaction. No client can observe a recorded event without a state row.
  insert into public.payment_events (
    provider, event_type, provider_event_id, provider_object_id, amount_minor,
    currency, direction, user_id, related_entity, occurred_at
  ) values (
    p_provider, p_event_type, p_provider_event_id, p_provider_object_id,
    p_amount_minor, p_currency, p_direction, p_user_id,
    coalesce(p_related_entity, '{}'::jsonb), p_occurred_at
  ) on conflict (provider_event_id) do nothing;

  insert into public.payment_event_processing (provider_event_id, status)
  values (p_provider_event_id, 'processing')
  on conflict (provider_event_id) do nothing;
  if found then return 'claimed'; end if;

  -- A failed request is immediately retryable. A process crash is reclaimable
  -- after ten minutes; before that callers must return 5xx so the provider does
  -- not mark a concurrently-running delivery successful.
  update public.payment_event_processing
  set status = 'processing', attempt_count = attempt_count + 1,
      claimed_at = now(), last_error = null
  where provider_event_id = p_provider_event_id
    and (status = 'failed' or (status = 'processing' and claimed_at < now() - interval '10 minutes'))
  returning status into v_status;
  if found then return 'claimed'; end if;

  select status into v_status
  from public.payment_event_processing
  where provider_event_id = p_provider_event_id;
  return coalesce(v_status, 'processing');
end;
$$;


--
-- Name: cleanup_stale_anonymous_users(interval); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.cleanup_stale_anonymous_users(p_age interval DEFAULT '30 days'::interval) RETURNS integer
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  declare v_deleted integer;
  begin
    with removed as (
      delete from auth.users u
      where u.is_anonymous = true
        and coalesce(u.last_sign_in_at, u.created_at) < (now() - p_age)
      returning u.id
    ) 
    select count(*) into v_deleted from removed;
    return v_deleted;
  end;
  $$;


--
-- Name: complete_payment_webhook_event(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.complete_payment_webhook_event(p_provider_event_id text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.payment_event_processing
  set status = 'processed', processed_at = now(), last_error = null
  where provider_event_id = p_provider_event_id and status = 'processing';
  if not found then
    raise exception 'payment webhook % is not processing', p_provider_event_id;
  end if;
end;
$$;


--
-- Name: consultant_covers_country(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consultant_covers_country(p_uid uuid, p_country text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select p_country is not null and exists (
    select 1 from public.consultant_countries cc
    where cc.consultant_id = p_uid
      and cc.active = true
      and (
        cc.country_code = p_country                                                -- exact: 'DE' covers DE
        or (cc.country_code = 'SCHENGEN' and public.is_schengen_member(p_country))  -- bloc expansion
      )
  );
$$;


--
-- Name: consume_review_credit(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.consume_review_credit(p_user_id uuid, p_application_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare v_id uuid;
begin
  update public.subscription_credits
     set consumed = consumed + 1
   where user_id = p_user_id
     and now() >= period_start and now() < period_end
     and consumed < granted
   returning id into v_id;
  return v_id is not null;
end;
$$;


--
-- Name: FUNCTION consume_review_credit(p_user_id uuid, p_application_id uuid); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.consume_review_credit(p_user_id uuid, p_application_id uuid) IS 'SP2: atomic review-credit consumption; false => no credit (route to paid). Margin-inversion guard.';


--
-- Name: enforce_consultant_state_service_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_consultant_state_service_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if new.consultant_state is distinct from old.consultant_state
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'consultant_state may only be changed by staff via the messaging service';
  end if;
  return new;
end;
$$;


--
-- Name: enforce_user_status_service_role(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enforce_user_status_service_role() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if (new.status            is distinct from old.status
   or new.status_reason     is distinct from old.status_reason
   or new.status_changed_at  is distinct from old.status_changed_at
   or new.status_changed_by  is distinct from old.status_changed_by)
     and current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'user lifecycle status may only be changed by an admin via the service role';
  end if;
  return new;
end;
$$;


--
-- Name: enqueue_application_status_changed(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.enqueue_application_status_changed() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if new.status is distinct from old.status then
    insert into public.notification_outbox (event_type, payload)
    values (
      'application.status_changed',
      jsonb_build_object(
        'userId', new.user_id,
        'applicationId', new.id,
        'data', jsonb_build_object('status', new.status)
      )
    );
  end if;
  return new;
end;
$$;


--
-- Name: ensure_month_partition(date); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.ensure_month_partition(p_month date) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  start_ts date := date_trunc('month', p_month)::date;
  end_ts   date := (date_trunc('month', p_month) + interval '1 month')::date;
  part     text := 'analytics_event_stream_' || to_char(start_ts, 'YYYYMM');
begin
  execute format(
    'create table if not exists public.%I partition of public.analytics_event_stream
       for values from (%L) to (%L)',
    part, start_ts, end_ts
  );
  -- A partition does not inherit the parent's row-security setting. Without
  -- this, direct access to the partition is unfiltered.
  execute format('alter table public.%I enable row level security', part);
end;
$$;


--
-- Name: fail_payment_webhook_event(text, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.fail_payment_webhook_event(p_provider_event_id text, p_error text) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
begin
  update public.payment_event_processing
  set status = 'failed', last_error = left(coalesce(p_error, 'webhook handler failed'), 1000)
  where provider_event_id = p_provider_event_id and status = 'processing';
  if not found then
    raise exception 'payment webhook % is not processing', p_provider_event_id;
  end if;
end;
$$;


--
-- Name: field_provenance; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_provenance (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    field_key text NOT NULL,
    origin text NOT NULL,
    value_snapshot text,
    value_hash text,
    source_document_id uuid,
    source_page integer,
    source_bbox jsonb,
    ocr_run_id uuid,
    extraction_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    confidence numeric(4,3),
    confidence_band text,
    superseded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT field_provenance_confidence_band_check CHECK (((confidence_band IS NULL) OR (confidence_band = ANY (ARRAY['high'::text, 'medium'::text, 'low'::text])))),
    CONSTRAINT field_provenance_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT field_provenance_ocr_requires_run CHECK (((origin <> 'ocr'::text) OR (ocr_run_id IS NOT NULL))),
    CONSTRAINT field_provenance_origin_check CHECK ((origin = ANY (ARRAY['ocr'::text, 'intake'::text, 'inferred'::text, 'user_entered'::text]))),
    CONSTRAINT field_provenance_source_page_check CHECK (((source_page IS NULL) OR (source_page >= 0)))
);


--
-- Name: TABLE field_provenance; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.field_provenance IS 'Gate 2: where each field value came from (doc/page/bbox/run/origin). Append-only via superseded_by. Service-role write.';


--
-- Name: field_provenance_create_version(uuid, text, text, text, text, uuid, integer, jsonb, uuid, numeric, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.field_provenance_create_version(p_application_id uuid, p_field_key text, p_origin text, p_value_snapshot text, p_value_hash text, p_source_document_id uuid, p_source_page integer, p_source_bbox jsonb, p_ocr_run_id uuid, p_confidence numeric, p_confidence_band text) RETURNS public.field_provenance
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION field_provenance_create_version(p_application_id uuid, p_field_key text, p_origin text, p_value_snapshot text, p_value_hash text, p_source_document_id uuid, p_source_page integer, p_source_bbox jsonb, p_ocr_run_id uuid, p_confidence numeric, p_confidence_band text); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.field_provenance_create_version(p_application_id uuid, p_field_key text, p_origin text, p_value_snapshot text, p_value_hash text, p_source_document_id uuid, p_source_page integer, p_source_bbox jsonb, p_ocr_run_id uuid, p_confidence numeric, p_confidence_band text) IS 'Gate 2 / 2E: atomic supersede-then-insert. One current per (application,field). Append-only versioning.';


--
-- Name: field_provenance_lock(uuid, text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.field_provenance_lock(p_application_id uuid, p_field_key text) RETURNS void
    LANGUAGE sql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select pg_advisory_xact_lock(
    hashtext('field_provenance:' || p_application_id::text || ':' || p_field_key)
  );
$$;


--
-- Name: field_provenance_relink_chain(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.field_provenance_relink_chain() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
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


--
-- Name: field_provenance_retire(uuid, uuid, text[]); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.field_provenance_retire(p_application_id uuid, p_document_id uuid, p_keep text[]) RETURNS TABLE(field_key text, retired integer, skipped_approved boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
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


--
-- Name: FUNCTION field_provenance_retire(p_application_id uuid, p_document_id uuid, p_keep text[]); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.field_provenance_retire(p_application_id uuid, p_document_id uuid, p_keep text[]) IS 'Retire (superseded_by = id) a document''s versions of fields its re-read no longer gives; splice each out of its chain under the per-field lock. Skips a consultant-approved current value.';


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  insert into public.users (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data->>'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;


--
-- Name: handle_user_identity_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.handle_user_identity_sync() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  begin
    if new.email is distinct from old.email
       or new.raw_user_meta_data is distinct from old.raw_user_meta_data then
      update public.users
        set email = new.email,
            full_name = coalesce(new.raw_user_meta_data->>'full_name', full_name)
        where id = new.id;
    end if;
    return new;
  end;
  $$;


--
-- Name: increment_partner_usage(uuid, text, timestamp with time zone, bigint); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_partner_usage(p_application_id uuid, p_window_kind text, p_window_start timestamp with time zone, p_delta bigint DEFAULT 1) RETURNS bigint
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare
  new_count bigint;
begin
  insert into public.partner_usage_counters (application_id, window_kind, window_start, count)
  values (p_application_id, p_window_kind, p_window_start, p_delta)
  on conflict (application_id, window_kind, window_start)
  do update set count = public.partner_usage_counters.count + p_delta
  returning count into new_count;
  return new_count;
end;
$$;


--
-- Name: is_active_assignee(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_active_assignee(p_app uuid, p_uid uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select exists (
    select 1 from public.consultant_assignments a
    where a.application_id = p_app and a.consultant_id = p_uid and a.status = 'active'
  );
$$;


--
-- Name: is_analytics_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_analytics_admin() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  );
$$;


--
-- Name: is_marketplace_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_marketplace_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$$;


--
-- Name: is_pricing_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_pricing_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
$$;


--
-- Name: is_risk_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_risk_admin() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$$;


--
-- Name: is_schengen_member(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_schengen_member(p_code text) RETURNS boolean
    LANGUAGE sql IMMUTABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select p_code is not null and upper(p_code) in (
    'AT','BE','HR','CZ','DK','EE','FI','FR','DE','GR',
    'HU','IS','IT','LV','LI','LT','LU','MT','NL','NO',
    'PL','PT','SK','SI','ES','SE','CH'
  );
$$;


--
-- Name: kb_search_hybrid(text, extensions.vector, text, uuid, uuid, text[], text[], boolean, date, integer, integer, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid DEFAULT NULL::uuid, p_visa_type_id uuid DEFAULT NULL::uuid, p_languages text[] DEFAULT NULL::text[], p_form_codes text[] DEFAULT NULL::text[], p_include_superseded boolean DEFAULT false, p_as_of date DEFAULT NULL::date, p_limit integer DEFAULT 20, p_candidate_limit integer DEFAULT 100, p_rrf_k integer DEFAULT 60) RETURNS TABLE(chunk_id uuid, text_sha256 text, chunk_text text, score double precision, vector_rank integer, lexical_rank integer, vector_similarity double precision, lexical_score double precision, country_id uuid, visa_type_id uuid, source_id uuid, source_version_id uuid, authority_rank smallint, source_role text, language text, heading_path text[], page_number integer, form_codes text[], status text, effective_from date, effective_to date)
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions'
    AS $$
  with scoped as (
    -- The candidate set. Every filter that decides CORRECTNESS lives here, so
    -- neither ranking arm can widen it.
    select c.*
    from public.kb_chunks c
    where (p_include_superseded or c.status = 'current')
      and (
        p_country_id is null
        or c.country_id = p_country_id
        or exists (
          select 1 from public.kb_chunk_scopes s
          where s.chunk_id = c.id
            and s.country_id = p_country_id
            and (p_visa_type_id is null or s.visa_type_id is null or s.visa_type_id = p_visa_type_id)
        )
      )
      -- A country-level chunk (visa_type_id null) is in scope for every visa of
      -- that country: "you need a valid passport" is published once on the
      -- authority's index page and governs every route beneath it.
      and (p_visa_type_id is null or c.visa_type_id is null or c.visa_type_id = p_visa_type_id)
      and (p_languages is null or c.language = any(p_languages) or c.language = 'und')
      and (p_form_codes is null or c.form_codes && p_form_codes)
      and (p_as_of is null
           or ((c.effective_from is null or c.effective_from <= p_as_of)
               and (c.effective_to is null or c.effective_to >= p_as_of)))
  ),
  vec as (
    select
      s.id as chunk_id,
      row_number() over (order by e.embedding <=> p_query_embedding) as rnk,
      1 - (e.embedding <=> p_query_embedding) as sim
    from scoped s
    join public.kb_embeddings e
      on e.text_sha256 = s.text_sha256 and e.model = p_embedding_model
    where p_query_embedding is not null
    order by e.embedding <=> p_query_embedding
    limit p_candidate_limit
  ),
  lex as (
    select
      s.id as chunk_id,
      row_number() over (
        order by ts_rank_cd(t.tsv, websearch_to_tsquery('simple', p_query_text)) desc
      ) as rnk,
      ts_rank_cd(t.tsv, websearch_to_tsquery('simple', p_query_text)) as score
    from scoped s
    join public.kb_chunk_texts t on t.sha256 = s.text_sha256
    where p_query_text is not null
      and p_query_text <> ''
      and t.tsv @@ websearch_to_tsquery('simple', p_query_text)
    order by 3 desc
    limit p_candidate_limit
  ),
  fused as (
    select
      coalesce(v.chunk_id, l.chunk_id) as chunk_id,
      coalesce(1.0 / (p_rrf_k + v.rnk), 0)
        + coalesce(1.0 / (p_rrf_k + l.rnk), 0) as rrf,
      v.rnk::integer as vrank,
      l.rnk::integer as lrank,
      v.sim,
      l.score
    from vec v
    full outer join lex l on l.chunk_id = v.chunk_id
  )
  select
    c.id,
    c.text_sha256,
    t.text,
    -- Authority rank is a tie-break multiplier, not a term added to the fused
    -- score: an immigration department's page and a consulate's page saying
    -- the same thing should rank in that order, but authority must never
    -- promote a badly-matching passage over a well-matching one.
    (f.rrf * (1.0 + (5 - c.authority_rank) * 0.01))::double precision,
    f.vrank,
    f.lrank,
    f.sim::double precision,
    f.score::double precision,
    c.country_id,
    c.visa_type_id,
    c.source_id,
    c.source_version_id,
    c.authority_rank,
    c.source_role,
    c.language,
    c.heading_path,
    c.page_number,
    c.form_codes,
    c.status,
    c.effective_from,
    c.effective_to
  from fused f
  join public.kb_chunks c on c.id = f.chunk_id
  join public.kb_chunk_texts t on t.sha256 = c.text_sha256
  order by 4 desc, c.authority_rank asc, c.id
  limit p_limit;
$$;


--
-- Name: FUNCTION kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid, p_visa_type_id uuid, p_languages text[], p_form_codes text[], p_include_superseded boolean, p_as_of date, p_limit integer, p_candidate_limit integer, p_rrf_k integer); Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON FUNCTION public.kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid, p_visa_type_id uuid, p_languages text[], p_form_codes text[], p_include_superseded boolean, p_as_of date, p_limit integer, p_candidate_limit integer, p_rrf_k integer) IS 'Hybrid vector + lexical retrieval with jurisdiction filtering applied inside both arms and Reciprocal Rank Fusion over the two rankings.';


--
-- Name: redeem_coupon(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.redeem_coupon(p_coupon_id uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare v_id uuid;
begin
  update public.coupons
     set redeemed_count = redeemed_count + 1, updated_at = now()
   where id = p_coupon_id
     and active = true
     and (max_redemptions is null or redeemed_count < max_redemptions)
   returning id into v_id;
  return v_id is not null;
end;
$$;


--
-- Name: refresh_consultant_rating(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.refresh_consultant_rating() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
declare cid uuid;
begin
  cid := coalesce(new.consultant_id, old.consultant_id);
  update public.consultant_profiles p set
    rating_avg = coalesce((select avg(rating)::numeric(3,2) from public.consultant_reviews where consultant_id = cid), 0),
    rating_count = (select count(*) from public.consultant_reviews where consultant_id = cid),
    updated_at = now()
  where p.id = cid;
  return null;
end;
$$;


--
-- Name: sec_application_owner(uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sec_application_owner(p_app uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select a.user_id from public.applications a where a.id = p_app;
$$;


--
-- Name: sec_guard_applications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sec_guard_applications() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if public.sec_is_privileged_writer() then
    return new;
  end if;

  if new.plan_tier      is distinct from old.plan_tier
     or new.vri_score   is distinct from old.vri_score
     or new.submitted_at is distinct from old.submitted_at
     or new.decision_at is distinct from old.decision_at
     or new.monitor_token is distinct from old.monitor_token then
    raise exception 'SEC-4094: applications system columns are not owner-writable'
      using errcode = '42501';
  end if;

  return new;
end;
$$;


--
-- Name: sec_guard_consultant_profiles(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sec_guard_consultant_profiles() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  if public.sec_is_privileged_writer() then
    return new;  -- service-role / admin may set anything
  end if;

  -- A non-privileged owner may NOT change any of these system-controlled fields.
  if new.kyc_status               is distinct from old.kyc_status
     or new.license_verified      is distinct from old.license_verified
     or new.payouts_enabled       is distinct from old.payouts_enabled
     or new.rating_avg            is distinct from old.rating_avg
     or new.rating_count          is distinct from old.rating_count
     or new.stripe_connect_account_id is distinct from old.stripe_connect_account_id then
    raise exception 'SEC-4090: consultant may not modify verification/payout/rating columns'
      using errcode = '42501';
  end if;

  -- active_status: owner may only self-serve draft <-> pending_review.
  -- Going 'active' / 'suspended' is an admin/system transition.
  if new.active_status is distinct from old.active_status
     and new.active_status not in ('draft', 'pending_review') then
    raise exception 'SEC-4090: consultant may not set active_status=%', new.active_status
      using errcode = '42501';
  end if;

  return new;
end;
$$;


--
-- Name: sec_guard_consultations(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sec_guard_consultations() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $_$
begin
  if public.sec_is_privileged_writer() then
    return new;
  end if;

  if new.user_id           is distinct from old.user_id
     or new.consultant_id  is distinct from old.consultant_id
     or new.application_id  is distinct from old.application_id
     or new.service_order_id is distinct from old.service_order_id then
    raise exception 'SEC-4091: consultation identity columns are immutable to participants'
      using errcode = '42501';
  end if;

  if new.meeting_url is distinct from old.meeting_url
     and new.meeting_url is not null
     and new.meeting_url !~* '^https://([a-z0-9-]+\.)*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)(/|$)' then
    raise exception 'SEC-4091: meeting_url host not in the allowed provider set'
      using errcode = '42501';
  end if;

  return new;
end;
$_$;


--
-- Name: sec_is_privileged_writer(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sec_is_privileged_writer() RETURNS boolean
    LANGUAGE sql STABLE
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
  select coalesce(auth.role() = 'service_role', false)
      or public.is_marketplace_admin();
$$;


--
-- Name: touch_field_verifications(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_field_verifications() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin new.updated_at := now(); return new; end;
$$;


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions', 'pg_temp'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: visa_registry_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.visa_registry_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'public', 'extensions'
    AS $$
begin
  new.updated_at := now();
  return new;
end;
$$;


--
-- Name: account_lockouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.account_lockouts (
    email text NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_failed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ip text DEFAULT '0.0.0.0'::text NOT NULL,
    CONSTRAINT account_lockouts_failed_count_check CHECK ((failed_count >= 0))
);


--
-- Name: TABLE account_lockouts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.account_lockouts IS 'Per (email, ip) failed-login state. A per-pair lock stops brute force from one source; the email-wide sum of failed_count is checked separately so a distributed attempt is still caught. Never key a lock on email alone — that is a remote account-denial primitive.';


--
-- Name: COLUMN account_lockouts.ip; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.account_lockouts.ip IS 'Source address of the failed attempt. Part of the primary key so one address cannot lock an account for everyone (SEC-001). Legacy rows carry the sentinel 0.0.0.0 and can never match a live request.';


--
-- Name: action_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.action_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    post_submission_event_id uuid NOT NULL,
    task_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    CONSTRAINT action_items_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'complete'::text])))
);


--
-- Name: addon_purchases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.addon_purchases (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    application_id uuid NOT NULL,
    payment_id uuid,
    addon_sku text NOT NULL,
    amount_cents integer NOT NULL,
    stripe_payment_intent_id text,
    status text DEFAULT 'complete'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT addon_purchases_addon_sku_check CHECK ((addon_sku = ANY (ARRAY['addon_document_review'::text, 'addon_rush_sla'::text, 'addon_premium_upgrade'::text]))),
    CONSTRAINT addon_purchases_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT addon_purchases_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'complete'::text, 'refunded'::text])))
);


--
-- Name: ai_usage_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid,
    user_id uuid,
    provider text NOT NULL,
    model text NOT NULL,
    operation text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    units integer DEFAULT 0 NOT NULL,
    request_cost_usd numeric(12,6) NOT NULL,
    billable_cost_usd numeric(12,6),
    price_snapshot_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    cached_input_tokens integer DEFAULT 0 NOT NULL,
    cache_write_tokens integer DEFAULT 0 NOT NULL,
    CONSTRAINT ai_usage_events_billable_cost_usd_check CHECK ((billable_cost_usd >= (0)::numeric)),
    CONSTRAINT ai_usage_events_cache_write_tokens_check CHECK ((cache_write_tokens >= 0)),
    CONSTRAINT ai_usage_events_cached_input_tokens_check CHECK ((cached_input_tokens >= 0)),
    CONSTRAINT ai_usage_events_cached_within_input CHECK ((cached_input_tokens <= input_tokens)),
    CONSTRAINT ai_usage_events_input_tokens_check CHECK ((input_tokens >= 0)),
    CONSTRAINT ai_usage_events_output_tokens_check CHECK ((output_tokens >= 0)),
    CONSTRAINT ai_usage_events_provider_check CHECK ((provider = ANY (ARRAY['openai'::text, 'anthropic'::text, 'gemini'::text, 'ocr'::text, 'search'::text]))),
    CONSTRAINT ai_usage_events_request_cost_usd_check CHECK ((request_cost_usd >= (0)::numeric)),
    CONSTRAINT ai_usage_events_units_check CHECK ((units >= 0))
);


--
-- Name: COLUMN ai_usage_events.cached_input_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_usage_events.cached_input_tokens IS 'Input tokens served FROM the prompt cache. A SUBSET of input_tokens, not an addition to it — the provider reports it that way, and adding them would double-count every cached call.';


--
-- Name: COLUMN ai_usage_events.cache_write_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.ai_usage_events.cache_write_tokens IS 'Tokens WRITTEN to the prompt cache. Billed separately on GPT-5.6+ (1.25x the uncached input rate); zero on earlier models.';


--
-- Name: ai_cost_per_application; Type: MATERIALIZED VIEW; Schema: public; Owner: -
--

CREATE MATERIALIZED VIEW public.ai_cost_per_application AS
 SELECT application_id,
    count(*) AS call_count,
    sum(input_tokens) AS input_tokens,
    sum(output_tokens) AS output_tokens,
    sum(units) AS units,
    sum(request_cost_usd) AS ai_cost_actual,
    sum(billable_cost_usd) AS billable_cost_actual,
    max(created_at) AS last_event_at
   FROM public.ai_usage_events e
  WHERE (application_id IS NOT NULL)
  GROUP BY application_id
  WITH NO DATA;


--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    framework_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    plan_tier text DEFAULT 'none'::text NOT NULL,
    vri_score integer,
    submitted_at timestamp with time zone,
    decision_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    monitor_token text,
    destination_country text,
    destination_state text,
    needs_consultant_escalation boolean DEFAULT false NOT NULL,
    escalation_reason text,
    visa_type_id uuid,
    CONSTRAINT applications_plan_tier_check CHECK ((plan_tier = ANY (ARRAY['none'::text, 'self_service'::text, 'copilot'::text, 'expert'::text]))),
    CONSTRAINT applications_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'ready'::text, 'submitted'::text, 'decided'::text]))),
    CONSTRAINT applications_vri_score_check CHECK (((vri_score >= 0) AND (vri_score <= 100)))
);


--
-- Name: COLUMN applications.visa_type_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.applications.visa_type_id IS 'The visa route this application is for, into the sourced registry. NULL until the applicant chooses one — discovery mode. ON DELETE SET NULL rather than CASCADE: retiring a visa type must never delete a person''s application.';


--
-- Name: country_frameworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.country_frameworks (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    country_code text NOT NULL,
    visa_type text NOT NULL,
    purpose text NOT NULL,
    requirements_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_quotes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_quotes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    visa_type text NOT NULL,
    country_code text NOT NULL,
    recommended_price numeric NOT NULL,
    floor_price numeric NOT NULL,
    ceiling_price numeric,
    gross_margin numeric NOT NULL,
    total_cogs numeric NOT NULL,
    breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    flags text[] DEFAULT '{}'::text[] NOT NULL,
    config_snapshot_id uuid,
    computed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_quotes_floor_price_check CHECK ((floor_price >= (0)::numeric)),
    CONSTRAINT pricing_quotes_gross_margin_check CHECK (((gross_margin >= ('-1'::integer)::numeric) AND (gross_margin <= (1)::numeric))),
    CONSTRAINT pricing_quotes_recommended_price_check CHECK ((recommended_price >= (0)::numeric)),
    CONSTRAINT pricing_quotes_total_cogs_check CHECK ((total_cogs >= (0)::numeric))
);


--
-- Name: ai_cost_actual_vs_model; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.ai_cost_actual_vs_model WITH (security_invoker='true') AS
 SELECT a.id AS application_id,
    cf.visa_type,
    cf.country_code,
    c.ai_cost_actual,
    ((q.breakdown ->> 'ai_cost'::text))::numeric AS ai_cost_model,
    (c.ai_cost_actual - ((q.breakdown ->> 'ai_cost'::text))::numeric) AS drift_usd
   FROM (((public.applications a
     LEFT JOIN public.country_frameworks cf ON ((cf.id = a.framework_id)))
     LEFT JOIN public.ai_cost_per_application c ON ((c.application_id = a.id)))
     LEFT JOIN public.pricing_quotes q ON (((q.visa_type = cf.visa_type) AND (q.country_code = cf.country_code))));


--
-- Name: analytics_alert_event; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_alert_event (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    rule_id uuid NOT NULL,
    kind text NOT NULL,
    value numeric,
    message text NOT NULL,
    fired_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_alert_rule; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_alert_rule (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    metric_key text NOT NULL,
    metric text NOT NULL,
    query jsonb NOT NULL,
    conditions jsonb NOT NULL,
    combine text DEFAULT 'all'::text NOT NULL,
    recipients text[] DEFAULT '{}'::text[] NOT NULL,
    notify_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    state text DEFAULT 'ok'::text NOT NULL,
    last_value numeric,
    last_evaluated_at timestamp with time zone,
    last_transition_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: COLUMN analytics_alert_rule.created_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.analytics_alert_rule.created_by IS 'The user who created the rule. NULL means the platform provisioned it — a system rule has no human author, and inventing one would misattribute it.';


--
-- Name: analytics_daily_active; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_daily_active (
    day date NOT NULL,
    dau bigint DEFAULT 0 NOT NULL,
    wau bigint DEFAULT 0 NOT NULL,
    mau bigint DEFAULT 0 NOT NULL
);


--
-- Name: analytics_event_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_daily (
    day date NOT NULL,
    name text NOT NULL,
    count bigint DEFAULT 0 NOT NULL
);


--
-- Name: analytics_event_stream; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_stream (
    event_id uuid NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    user_id uuid,
    anonymous_id text,
    session_id text,
    application_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT analytics_event_stream_source_check CHECK ((source = ANY (ARRAY['server'::text, 'client'::text])))
)
PARTITION BY RANGE (occurred_at);


--
-- Name: analytics_event_stream_202607; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_stream_202607 (
    event_id uuid NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    user_id uuid,
    anonymous_id text,
    session_id text,
    application_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT analytics_event_stream_source_check CHECK ((source = ANY (ARRAY['server'::text, 'client'::text])))
);


--
-- Name: analytics_event_stream_202608; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_stream_202608 (
    event_id uuid NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    user_id uuid,
    anonymous_id text,
    session_id text,
    application_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT analytics_event_stream_source_check CHECK ((source = ANY (ARRAY['server'::text, 'client'::text])))
);


--
-- Name: analytics_event_stream_202609; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_stream_202609 (
    event_id uuid NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    user_id uuid,
    anonymous_id text,
    session_id text,
    application_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT analytics_event_stream_source_check CHECK ((source = ANY (ARRAY['server'::text, 'client'::text])))
);


--
-- Name: analytics_event_stream_202610; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_stream_202610 (
    event_id uuid NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    user_id uuid,
    anonymous_id text,
    session_id text,
    application_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT analytics_event_stream_source_check CHECK ((source = ANY (ARRAY['server'::text, 'client'::text])))
);


--
-- Name: analytics_event_stream_202611; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_stream_202611 (
    event_id uuid NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    user_id uuid,
    anonymous_id text,
    session_id text,
    application_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT analytics_event_stream_source_check CHECK ((source = ANY (ARRAY['server'::text, 'client'::text])))
);


--
-- Name: analytics_event_stream_202612; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_event_stream_202612 (
    event_id uuid NOT NULL,
    name text NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    source text NOT NULL,
    user_id uuid,
    anonymous_id text,
    session_id text,
    application_id uuid,
    schema_version integer DEFAULT 1 NOT NULL,
    props jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT analytics_event_stream_source_check CHECK ((source = ANY (ARRAY['server'::text, 'client'::text])))
);


--
-- Name: analytics_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    anon_id text,
    application_id uuid,
    event_name text NOT NULL,
    stage text,
    properties jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE analytics_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.analytics_events IS 'PII-FREE product + funnel events. Never store document/identity/financial data or free text here.';


--
-- Name: analytics_identity_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_identity_map (
    anonymous_id text NOT NULL,
    user_id uuid NOT NULL,
    linked_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_report_run; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_report_run (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    saved_report_id uuid NOT NULL,
    scheduled_report_id uuid,
    status text NOT NULL,
    result_snapshot jsonb,
    error text,
    delivery_error text,
    ran_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_saved_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_saved_report (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    metric_key text NOT NULL,
    metric text NOT NULL,
    query jsonb NOT NULL,
    created_by uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: analytics_scheduled_report; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.analytics_scheduled_report (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    saved_report_id uuid NOT NULL,
    cron text NOT NULL,
    format text NOT NULL,
    recipients text[] NOT NULL,
    notify_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone
);


--
-- Name: application_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_profiles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    profile_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    risk_indicators_json jsonb DEFAULT '[]'::jsonb NOT NULL,
    last_updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    checklist_item_id uuid,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    file_name text NOT NULL,
    encrypted boolean DEFAULT true NOT NULL,
    upload_status text DEFAULT 'pending'::text NOT NULL,
    ocr_status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    document_type text,
    raw_text_hash text,
    identity_fphash text,
    duplicate_of uuid,
    dup_status text DEFAULT 'unique'::text NOT NULL,
    expiry_date date,
    expiry_status text,
    detected_language text,
    language_confidence numeric,
    needs_translation boolean DEFAULT false NOT NULL,
    CONSTRAINT documents_dup_status_check CHECK ((dup_status = ANY (ARRAY['unique'::text, 'exact_dup'::text, 'likely_dup'::text]))),
    CONSTRAINT documents_expiry_status_check CHECK (((expiry_status IS NULL) OR (expiry_status = ANY (ARRAY['pass'::text, 'warn'::text, 'fail'::text, 'unknown'::text])))),
    CONSTRAINT documents_language_confidence_check CHECK (((language_confidence IS NULL) OR ((language_confidence >= (0)::numeric) AND (language_confidence <= (1)::numeric)))),
    CONSTRAINT documents_ocr_status_check CHECK ((ocr_status = ANY (ARRAY['pending'::text, 'complete'::text, 'failed'::text]))),
    CONSTRAINT documents_upload_status_check CHECK ((upload_status = ANY (ARRAY['pending'::text, 'complete'::text, 'failed'::text])))
);


--
-- Name: generated_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_documents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    doc_type text NOT NULL,
    content_md text NOT NULL,
    approved_by_user boolean DEFAULT false NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generated_documents_doc_type_check CHECK ((doc_type = ANY (ARRAY['loe'::text, 'itinerary'::text, 'cover_letter'::text, 'invitation_letter'::text, 'prefilled_form_json'::text])))
);


--
-- Name: submission_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    extension_session_id text,
    status text DEFAULT 'pending'::text NOT NULL,
    portal_url text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    error_log text,
    CONSTRAINT submission_sessions_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'active'::text, 'paused'::text, 'complete'::text, 'error'::text])))
);


--
-- Name: vri_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vri_scores (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    overall_score integer NOT NULL,
    documentation_pct integer DEFAULT 0 NOT NULL,
    financial_pct integer DEFAULT 0 NOT NULL,
    travel_history_pct integer DEFAULT 0 NOT NULL,
    home_ties_pct integer DEFAULT 0 NOT NULL,
    employment_pct integer DEFAULT 0 NOT NULL,
    consistency_pct integer DEFAULT 0 NOT NULL,
    calculated_at timestamp with time zone DEFAULT now() NOT NULL,
    escalated boolean DEFAULT false NOT NULL,
    escalation_reason text,
    unassessed_factors text[],
    CONSTRAINT vri_scores_overall_score_check CHECK (((overall_score >= 0) AND (overall_score <= 100)))
);


--
-- Name: COLUMN vri_scores.unassessed_factors; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.vri_scores.unassessed_factors IS 'Factor keys (e.g. consistency_pct) whose input data was absent, so no assessment ran. Excluded from overall_score; render as "Not assessed" rather than a percentage. See FAKE-002.';


--
-- Name: application_activity; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.application_activity WITH (security_invoker='true') AS
 SELECT a.id AS application_id,
    a.user_id,
    GREATEST(a.created_at, COALESCE(p.last_updated_at, a.created_at), COALESCE(d.max_created, a.created_at), COALESCE(g.max_generated, a.created_at), COALESCE(v.max_calculated, a.created_at), COALESCE(s.max_session, a.created_at)) AS last_active_at
   FROM (((((public.applications a
     LEFT JOIN public.application_profiles p ON ((p.application_id = a.id)))
     LEFT JOIN ( SELECT documents.application_id,
            max(documents.created_at) AS max_created
           FROM public.documents
          GROUP BY documents.application_id) d ON ((d.application_id = a.id)))
     LEFT JOIN ( SELECT generated_documents.application_id,
            max(generated_documents.generated_at) AS max_generated
           FROM public.generated_documents
          GROUP BY generated_documents.application_id) g ON ((g.application_id = a.id)))
     LEFT JOIN ( SELECT vri_scores.application_id,
            max(vri_scores.calculated_at) AS max_calculated
           FROM public.vri_scores
          GROUP BY vri_scores.application_id) v ON ((v.application_id = a.id)))
     LEFT JOIN ( SELECT submission_sessions.application_id,
            max(GREATEST(submission_sessions.started_at, submission_sessions.completed_at)) AS max_session
           FROM public.submission_sessions
          GROUP BY submission_sessions.application_id) s ON ((s.application_id = a.id)));


--
-- Name: VIEW application_activity; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.application_activity IS 'Derived last-activity per application (Epic B). Read-only, no write-path.';


--
-- Name: application_item_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_item_reviews (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    item_kind text NOT NULL,
    item_id uuid NOT NULL,
    decision text NOT NULL,
    note text,
    reviewer_id uuid,
    reviewer_role text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT application_item_reviews_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'needs_reupload'::text, 'changes_requested'::text, 'rejected'::text]))),
    CONSTRAINT application_item_reviews_item_kind_check CHECK ((item_kind = ANY (ARRAY['document'::text, 'generated'::text]))),
    CONSTRAINT application_item_reviews_note_check CHECK (((note IS NULL) OR (length(note) <= 2000))),
    CONSTRAINT application_item_reviews_note_required CHECK (((decision = 'approved'::text) OR ((note IS NOT NULL) AND (length(btrim(note)) > 0)))),
    CONSTRAINT application_item_reviews_reupload_is_document CHECK (((decision <> 'needs_reupload'::text) OR (item_kind = 'document'::text))),
    CONSTRAINT application_item_reviews_reviewer_role_check CHECK ((reviewer_role = ANY (ARRAY['consultant'::text, 'admin'::text])))
);


--
-- Name: TABLE application_item_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.application_item_reviews IS 'Consultant per-item review decisions (documents, generated letters, prefilled form). Append-only; latest row per item wins. Service-role write.';


--
-- Name: application_outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_outcomes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    outcome text NOT NULL,
    decided_at date,
    refusal_reasons text[],
    reported_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT application_outcomes_outcome_check CHECK ((outcome = ANY (ARRAY['approved'::text, 'refused'::text, 'withdrawn'::text, 'pending'::text])))
);


--
-- Name: TABLE application_outcomes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.application_outcomes IS 'Self-reported visa decisions. refusal_reasons must come from a fixed list, not free text (no PII).';


--
-- Name: audit_chain_state; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_chain_state (
    application_id uuid NOT NULL,
    last_seq bigint DEFAULT 0 NOT NULL,
    last_row_hash text NOT NULL
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid,
    seq bigint NOT NULL,
    event_type public.audit_event_type NOT NULL,
    actor_id uuid,
    actor_role public.audit_actor_role NOT NULL,
    document_id uuid,
    ocr_run_id uuid,
    field_key text,
    submission_session_id uuid,
    from_state text,
    to_state text,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    value_hash text,
    payload_hash text NOT NULL,
    prev_hash text NOT NULL,
    row_hash text NOT NULL,
    hash_algo text DEFAULT 'sha256'::text NOT NULL,
    canon_version smallint DEFAULT 1 NOT NULL,
    extension_version text,
    schema_version text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE audit_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.audit_events IS 'Gate 2: append-only, hash-chained audit log. UPDATE/DELETE blocked. value_hash only, no raw PII.';


--
-- Name: COLUMN audit_events.application_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_events.application_id IS 'Null once the application has been deleted (GDPR erasure). The audit row itself is retained — this table is append-only — and becomes invisible to every non-service role because the owner is resolved through this link.';


--
-- Name: COLUMN audit_events.actor_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_events.actor_id IS 'Historical reference, no FK (AUDIT-006).';


--
-- Name: COLUMN audit_events.document_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.audit_events.document_id IS 'Historical reference, no FK (AUDIT-006): the document may be deleted without rewriting the hash chain.';


--
-- Name: auth_audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auth_audit_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    actor_id uuid,
    event_type text NOT NULL,
    ip text,
    user_agent text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beta_cohort_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beta_cohort_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cohort_id uuid NOT NULL,
    user_id uuid NOT NULL,
    invited_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    exited_at timestamp with time zone,
    exit_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: beta_cohorts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beta_cohorts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    max_members integer DEFAULT 0 NOT NULL,
    platforms text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'planned'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beta_cohorts_max_members_check CHECK ((max_members >= 0)),
    CONSTRAINT beta_cohorts_slug_check CHECK ((slug ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'::text)),
    CONSTRAINT beta_cohorts_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'open'::text, 'closed'::text])))
);


--
-- Name: TABLE beta_cohorts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.beta_cohorts IS 'Closed-beta cohorts (Task 15 §2). Referenced by feature_flags.allowed_cohorts.';


--
-- Name: beta_feedback; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.beta_feedback (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    rating smallint,
    message text DEFAULT ''::text NOT NULL,
    surface text NOT NULL,
    app_version text DEFAULT ''::text NOT NULL,
    context jsonb DEFAULT '{}'::jsonb NOT NULL,
    device jsonb DEFAULT '{}'::jsonb NOT NULL,
    application_id uuid,
    diagnostics_consent boolean DEFAULT false NOT NULL,
    screenshot_path text,
    status text DEFAULT 'new'::text NOT NULL,
    severity text,
    owner_id uuid,
    resolution text,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT beta_feedback_app_version_check CHECK ((char_length(app_version) <= 64)),
    CONSTRAINT beta_feedback_kind_check CHECK ((kind = ANY (ARRAY['bug'::text, 'feature_request'::text, 'satisfaction'::text, 'ai_response'::text, 'consultant'::text, 'other'::text]))),
    CONSTRAINT beta_feedback_message_check CHECK ((char_length(message) <= 2000)),
    CONSTRAINT beta_feedback_rating_check CHECK (((rating >= 1) AND (rating <= 5))),
    CONSTRAINT beta_feedback_rating_matches_kind CHECK ((((kind = ANY (ARRAY['satisfaction'::text, 'ai_response'::text, 'consultant'::text])) AND (rating IS NOT NULL)) OR ((kind = ANY (ARRAY['bug'::text, 'feature_request'::text, 'other'::text])) AND (rating IS NULL)))),
    CONSTRAINT beta_feedback_resolution_check CHECK ((char_length(resolution) <= 2000)),
    CONSTRAINT beta_feedback_screenshot_requires_consent CHECK (((screenshot_path IS NULL) OR diagnostics_consent)),
    CONSTRAINT beta_feedback_severity_check CHECK ((severity = ANY (ARRAY['critical'::text, 'high'::text, 'medium'::text, 'low'::text]))),
    CONSTRAINT beta_feedback_status_check CHECK ((status = ANY (ARRAY['new'::text, 'triaged'::text, 'in_progress'::text, 'resolved'::text, 'wont_fix'::text, 'duplicate'::text]))),
    CONSTRAINT beta_feedback_surface_check CHECK ((surface = ANY (ARRAY['web'::text, 'ios'::text, 'android'::text, 'extension'::text])))
);


--
-- Name: TABLE beta_feedback; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.beta_feedback IS 'Closed-beta feedback (Task 15 §6). message is the only client free-text field; context/device are allowlisted. Never store application content.';


--
-- Name: checklist_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checklist_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    document_type text NOT NULL,
    label text NOT NULL,
    required boolean DEFAULT true NOT NULL,
    status text DEFAULT 'missing'::text NOT NULL,
    added_reason text,
    meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT checklist_items_status_check CHECK ((status = ANY (ARRAY['missing'::text, 'uploaded'::text, 'verified'::text, 'waived'::text])))
);


--
-- Name: consultant_approvals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_approvals (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    consultant_id uuid NOT NULL,
    scope text NOT NULL,
    field_key text,
    section text,
    decision public.consultant_decision NOT NULL,
    value_hash text,
    reason text,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultant_approvals_scope_check CHECK ((scope = ANY (ARRAY['field'::text, 'section'::text, 'application'::text]))),
    CONSTRAINT consultant_approvals_scope_field CHECK (((scope <> 'field'::text) OR (field_key IS NOT NULL))),
    CONSTRAINT consultant_approvals_scope_section CHECK (((scope <> 'section'::text) OR (section IS NOT NULL)))
);


--
-- Name: TABLE consultant_approvals; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.consultant_approvals IS 'Gate 2: consultant review/approve/reject decisions, value_hash-bound. Append-style (new row per decision). Service-role write.';


--
-- Name: consultant_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_assignments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    consultant_id uuid NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    released_at timestamp with time zone,
    role text DEFAULT 'primary'::text NOT NULL,
    due_at timestamp with time zone DEFAULT (now() + '24:00:00'::interval) NOT NULL,
    completed_at timestamp with time zone,
    assigned_by uuid,
    assigned_by_role text,
    CONSTRAINT consultant_assignments_assigned_by_role_check CHECK (((assigned_by_role IS NULL) OR (assigned_by_role = ANY (ARRAY['consultant'::text, 'admin'::text])))),
    CONSTRAINT consultant_assignments_role_check CHECK ((role = ANY (ARRAY['primary'::text, 'backup'::text]))),
    CONSTRAINT consultant_assignments_status_check CHECK ((status = ANY (ARRAY['active'::text, 'released'::text])))
);


--
-- Name: COLUMN consultant_assignments.due_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.consultant_assignments.due_at IS 'Review deadline. If still active + not completed past this, a sweep releases the assignment back to the queue.';


--
-- Name: COLUMN consultant_assignments.completed_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.consultant_assignments.completed_at IS 'Set when the assigned consultant marks the application review complete — stops the SLA clock.';


--
-- Name: COLUMN consultant_assignments.assigned_by; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.consultant_assignments.assigned_by IS 'User who created this assignment (the consultant themselves for self-assign, or the admin who assigned it).';


--
-- Name: consultant_availability; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_availability (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    working_hours jsonb DEFAULT '{}'::jsonb NOT NULL,
    max_cases integer DEFAULT 10 NOT NULL,
    accepting_new boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultant_availability_max_cases_check CHECK ((max_cases >= 0))
);


--
-- Name: consultant_commission_rules; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_commission_rules (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    scope text NOT NULL,
    country_code text,
    visa_type text,
    consultant_id uuid,
    model text NOT NULL,
    platform_pct numeric(5,4),
    platform_fixed_usd numeric(10,2),
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT commission_model_value CHECK ((((model = 'percentage'::text) AND (platform_pct IS NOT NULL) AND (platform_fixed_usd IS NULL)) OR ((model = 'fixed'::text) AND (platform_fixed_usd IS NOT NULL) AND (platform_pct IS NULL)))),
    CONSTRAINT consultant_commission_rules_model_check CHECK ((model = ANY (ARRAY['percentage'::text, 'fixed'::text]))),
    CONSTRAINT consultant_commission_rules_platform_fixed_usd_check CHECK ((platform_fixed_usd >= (0)::numeric)),
    CONSTRAINT consultant_commission_rules_platform_pct_check CHECK (((platform_pct >= (0)::numeric) AND (platform_pct <= (1)::numeric))),
    CONSTRAINT consultant_commission_rules_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'country'::text, 'visa'::text, 'country_visa'::text, 'consultant'::text])))
);


--
-- Name: consultant_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_countries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    country_code text NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultant_countries_country_code_format CHECK (((country_code ~ '^[A-Z]{2}$'::text) OR (country_code = 'SCHENGEN'::text)))
);


--
-- Name: TABLE consultant_countries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.consultant_countries IS 'Country-scoped consultant visibility (ISO-2). Active rows only. Single source for consultant queue country filtering. Service-role/admin write.';


--
-- Name: consultant_notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_notes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    application_id uuid NOT NULL,
    author_id uuid NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone
);


--
-- Name: consultant_payout_items; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_payout_items (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    payout_id uuid NOT NULL,
    service_order_id uuid NOT NULL,
    amount_usd numeric(10,2) NOT NULL,
    stripe_transfer_id text,
    CONSTRAINT consultant_payout_items_amount_usd_check CHECK ((amount_usd >= (0)::numeric))
);


--
-- Name: COLUMN consultant_payout_items.stripe_transfer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.consultant_payout_items.stripe_transfer_id IS 'Stripe transfer that paid this order, created with source_transaction bound to the order''s charge.';


--
-- Name: consultant_payouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_payouts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    amount_usd numeric(10,2) NOT NULL,
    currency text DEFAULT 'usd'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    stripe_transfer_id text,
    period_start date,
    period_end date,
    payout_date timestamp with time zone,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultant_payouts_amount_usd_check CHECK ((amount_usd >= (0)::numeric)),
    CONSTRAINT consultant_payouts_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'in_transit'::text, 'paid'::text, 'failed'::text, 'reversed'::text])))
);


--
-- Name: COLUMN consultant_payouts.stripe_transfer_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.consultant_payouts.stripe_transfer_id IS 'Legacy: the single grouped transfer, pre-2026-08-12. New payouts leave this NULL and record transfers on consultant_payout_items.stripe_transfer_id.';


--
-- Name: consultant_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_profiles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    headline text,
    bio text,
    specialization text[] DEFAULT '{}'::text[] NOT NULL,
    years_experience integer,
    license_number text,
    license_authority text,
    license_country text,
    license_verified boolean DEFAULT false NOT NULL,
    hourly_rate_usd numeric(10,2),
    rating_avg numeric(3,2) DEFAULT 0 NOT NULL,
    rating_count integer DEFAULT 0 NOT NULL,
    max_active_cases integer DEFAULT 10 NOT NULL,
    active_status text DEFAULT 'draft'::text NOT NULL,
    kyc_status text DEFAULT 'none'::text NOT NULL,
    stripe_connect_account_id text,
    payouts_enabled boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultant_profiles_active_status_check CHECK ((active_status = ANY (ARRAY['draft'::text, 'pending_review'::text, 'active'::text, 'suspended'::text]))),
    CONSTRAINT consultant_profiles_hourly_rate_usd_check CHECK ((hourly_rate_usd >= (0)::numeric)),
    CONSTRAINT consultant_profiles_kyc_status_check CHECK ((kyc_status = ANY (ARRAY['none'::text, 'pending'::text, 'verified'::text, 'rejected'::text]))),
    CONSTRAINT consultant_profiles_max_active_cases_check CHECK ((max_active_cases >= 0)),
    CONSTRAINT consultant_profiles_rating_avg_check CHECK (((rating_avg >= (0)::numeric) AND (rating_avg <= (5)::numeric))),
    CONSTRAINT consultant_profiles_rating_count_check CHECK ((rating_count >= 0)),
    CONSTRAINT consultant_profiles_years_experience_check CHECK ((years_experience >= 0))
);


--
-- Name: consultant_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_reviews (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    application_id uuid,
    rating integer NOT NULL,
    feedback text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultant_reviews_rating_check CHECK (((rating >= 1) AND (rating <= 5)))
);


--
-- Name: consultant_service_orders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_service_orders (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    consultant_id uuid NOT NULL,
    application_id uuid,
    service_type text NOT NULL,
    currency text DEFAULT 'usd'::text NOT NULL,
    amount_usd numeric(10,2) NOT NULL,
    platform_fee_usd numeric(10,2) DEFAULT 0 NOT NULL,
    consultant_payout_usd numeric(10,2) DEFAULT 0 NOT NULL,
    commission_rule_id uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    stripe_payment_intent_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    paid_at timestamp with time zone,
    credit_covered boolean DEFAULT false NOT NULL,
    CONSTRAINT consultant_service_orders_amount_usd_check CHECK ((amount_usd >= (0)::numeric)),
    CONSTRAINT consultant_service_orders_consultant_payout_usd_check CHECK ((consultant_payout_usd >= (0)::numeric)),
    CONSTRAINT consultant_service_orders_platform_fee_usd_check CHECK ((platform_fee_usd >= (0)::numeric)),
    CONSTRAINT consultant_service_orders_service_type_check CHECK ((service_type = ANY (ARRAY['premium_review'::text, 'consultation'::text, 'priority_processing'::text, 'document_review'::text]))),
    CONSTRAINT consultant_service_orders_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'paid'::text, 'refunded'::text, 'failed'::text])))
);


--
-- Name: consultant_skills; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_skills (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    visa_types text[] DEFAULT '{}'::text[] NOT NULL,
    languages text[] DEFAULT '{}'::text[] NOT NULL,
    countries_supported text[] DEFAULT '{}'::text[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: consultant_tax_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultant_tax_profiles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    tax_country text NOT NULL,
    form_type text NOT NULL,
    tax_id_encrypted text,
    business_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultant_tax_profiles_form_type_check CHECK ((form_type = ANY (ARRAY['w9'::text, 'w8'::text]))),
    CONSTRAINT consultant_tax_profiles_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'submitted'::text])))
);


--
-- Name: consultations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consultations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    application_id uuid,
    service_order_id uuid,
    provider text NOT NULL,
    meeting_url text,
    external_event_id text,
    scheduled_start timestamp with time zone NOT NULL,
    scheduled_end timestamp with time zone NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT consultations_provider_check CHECK ((provider = ANY (ARRAY['zoom'::text, 'google_meet'::text, 'ms_teams'::text]))),
    CONSTRAINT consultations_status_check CHECK ((status = ANY (ARRAY['requested'::text, 'confirmed'::text, 'completed'::text, 'cancelled'::text, 'no_show'::text]))),
    CONSTRAINT consultations_time_order CHECK ((scheduled_end > scheduled_start))
);


--
-- Name: consumed_readback_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.consumed_readback_tokens (
    token_hash text NOT NULL,
    application_id uuid NOT NULL,
    consumed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE consumed_readback_tokens; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.consumed_readback_tokens IS 'Phase 4: single-use readback token ledger. PK collision = replay_detected. Service-role only.';


--
-- Name: conversation_participants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversation_participants (
    conversation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    last_read_at timestamp with time zone,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    delivered_at timestamp with time zone,
    CONSTRAINT conversation_participants_role_check CHECK ((role = ANY (ARRAY['user'::text, 'consultant'::text, 'admin'::text])))
);


--
-- Name: conversations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.conversations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    last_message_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    consultant_state text,
    CONSTRAINT conversations_consultant_state_check CHECK ((consultant_state = ANY (ARRAY['pending_user_response'::text, 'waiting_documents'::text, 'under_review'::text, 'resolved'::text]))),
    CONSTRAINT conversations_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text, 'closed'::text, 'archived'::text])))
);


--
-- Name: coupons; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.coupons (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    code text NOT NULL,
    stripe_coupon_id text,
    kind text NOT NULL,
    percent_off numeric,
    amount_off_cents integer,
    currency text DEFAULT 'usd'::text NOT NULL,
    applies_to text DEFAULT 'processing_fee'::text NOT NULL,
    max_redemptions integer,
    redeemed_count integer DEFAULT 0 NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coupons_amount_off_cents_check CHECK (((amount_off_cents IS NULL) OR (amount_off_cents > 0))),
    CONSTRAINT coupons_applies_to_check CHECK ((applies_to = ANY (ARRAY['processing_fee'::text, 'addon'::text, 'subscription'::text, 'any'::text]))),
    CONSTRAINT coupons_check CHECK ((((kind = 'percent'::text) AND (percent_off IS NOT NULL) AND (amount_off_cents IS NULL)) OR ((kind = 'amount'::text) AND (amount_off_cents IS NOT NULL) AND (percent_off IS NULL)))),
    CONSTRAINT coupons_kind_check CHECK ((kind = ANY (ARRAY['percent'::text, 'amount'::text]))),
    CONSTRAINT coupons_max_redemptions_check CHECK (((max_redemptions IS NULL) OR (max_redemptions > 0))),
    CONSTRAINT coupons_percent_off_check CHECK (((percent_off IS NULL) OR ((percent_off > (0)::numeric) AND (percent_off <= (100)::numeric)))),
    CONSTRAINT coupons_redeemed_count_check CHECK ((redeemed_count >= 0))
);


--
-- Name: cross_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cross_verifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    doc_a_id uuid NOT NULL,
    doc_b_id uuid NOT NULL,
    field_compared text NOT NULL,
    result text NOT NULL,
    details_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cross_verifications_result_check CHECK ((result = ANY (ARRAY['match'::text, 'mismatch'::text, 'warning'::text])))
);


--
-- Name: device_push_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_push_tokens (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform text NOT NULL,
    device_name text,
    app_version text,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_push_tokens_platform_check CHECK ((platform = ANY (ARRAY['ios'::text, 'android'::text])))
);


--
-- Name: discount_redemptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discount_redemptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    coupon_id uuid NOT NULL,
    promotion_id uuid,
    user_id uuid NOT NULL,
    application_id uuid,
    payment_id uuid,
    list_price_cents integer NOT NULL,
    discount_cents integer NOT NULL,
    charged_price_cents integer NOT NULL,
    resulting_margin numeric NOT NULL,
    floor_ok boolean NOT NULL,
    config_snapshot_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT discount_redemptions_charged_price_cents_check CHECK ((charged_price_cents >= 0)),
    CONSTRAINT discount_redemptions_discount_cents_check CHECK ((discount_cents >= 0)),
    CONSTRAINT discount_redemptions_list_price_cents_check CHECK ((list_price_cents >= 0)),
    CONSTRAINT discount_redemptions_resulting_margin_check CHECK (((resulting_margin >= ('-1'::integer)::numeric) AND (resulting_margin <= (1)::numeric)))
);


--
-- Name: document_access_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_access_logs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_access_logs_action_check CHECK ((action = ANY (ARRAY['upload'::text, 'view'::text, 'download'::text, 'delete'::text, 'ocr'::text])))
);


--
-- Name: document_holder_confirmations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_holder_confirmations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    application_id uuid NOT NULL,
    confirmed_by uuid,
    holder_name text,
    stated_name text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_holder_confirmations_holder_name_check CHECK (((holder_name IS NULL) OR (length(holder_name) <= 300))),
    CONSTRAINT document_holder_confirmations_stated_name_check CHECK (((stated_name IS NULL) OR (length(stated_name) <= 300)))
);


--
-- Name: TABLE document_holder_confirmations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_holder_confirmations IS 'Applicant confirmations that a held passport/ID (holder_mismatch.needs_confirmation) is their own. Append-only audit; releases the hold like a consultant approval. Service-role write.';


--
-- Name: document_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    application_id uuid NOT NULL,
    requested_by uuid NOT NULL,
    document_type text NOT NULL,
    label text NOT NULL,
    notes text,
    due_date date,
    priority text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    checklist_item_id uuid,
    fulfilled_attachment_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_requests_priority_check CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text]))),
    CONSTRAINT document_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'submitted'::text, 'under_review'::text, 'approved'::text, 'rejected'::text])))
);


--
-- Name: document_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_code text NOT NULL,
    program text NOT NULL,
    template_code text NOT NULL,
    template_name text DEFAULT ''::text NOT NULL,
    kind text DEFAULT 'checklist'::text NOT NULL,
    document_code text,
    source_url text NOT NULL,
    resolved_pdf_url text,
    version_label text,
    storage_path text,
    sha256 text,
    byte_size integer,
    content_type text,
    fetched_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    status text DEFAULT 'error'::text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_verified_at timestamp with time zone,
    CONSTRAINT document_templates_byte_size_check CHECK (((byte_size IS NULL) OR (byte_size > 0))),
    CONSTRAINT document_templates_cached_status_requires_bytes CHECK (((status <> ALL (ARRAY['ok'::text, 'stale'::text])) OR ((storage_path IS NOT NULL) AND (sha256 IS NOT NULL)))),
    CONSTRAINT document_templates_content_type_check CHECK ((char_length(content_type) <= 128)),
    CONSTRAINT document_templates_country_code_check CHECK (((char_length(country_code) >= 2) AND (char_length(country_code) <= 12))),
    CONSTRAINT document_templates_document_code_check CHECK ((char_length(document_code) <= 64)),
    CONSTRAINT document_templates_error_message_check CHECK ((char_length(error_message) <= 1000)),
    CONSTRAINT document_templates_kind_check CHECK ((kind = ANY (ARRAY['checklist'::text, 'guide'::text, 'declaration'::text, 'specification'::text, 'instructions'::text]))),
    CONSTRAINT document_templates_program_check CHECK ((char_length(program) <= 64)),
    CONSTRAINT document_templates_sha256_check CHECK (((sha256 IS NULL) OR (char_length(sha256) = 64))),
    CONSTRAINT document_templates_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'stale'::text, 'blocked'::text, 'link_only'::text, 'error'::text]))),
    CONSTRAINT document_templates_template_code_check CHECK ((char_length(template_code) <= 48)),
    CONSTRAINT document_templates_template_name_check CHECK ((char_length(template_name) <= 250)),
    CONSTRAINT document_templates_version_label_check CHECK ((char_length(version_label) <= 64))
);


--
-- Name: TABLE document_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_templates IS 'Cached official document checklists, specifications, declaration templates and route guidance. One row per (country_code, program, template_code). Written only by the doc-template-refresh job; read by the delivery path. Never holds applicant data.';


--
-- Name: COLUMN document_templates.last_verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.document_templates.last_verified_at IS 'Last time the cached bytes were CONFIRMED current against the authority. See form_templates.last_verified_at.';


--
-- Name: document_translations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_translations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    application_id uuid NOT NULL,
    source_lang text NOT NULL,
    target_lang text DEFAULT 'en'::text NOT NULL,
    translated_text text NOT NULL,
    provider text,
    model text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE document_translations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.document_translations IS 'English (or target-lang) rendering of non-English document content for human review. Source OCR text is never overwritten. Service-role write.';


--
-- Name: document_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.document_verifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    verification_type text NOT NULL,
    result text NOT NULL,
    details_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    verified_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_verifications_result_check CHECK ((result = ANY (ARRAY['pass'::text, 'warn'::text, 'fail'::text]))),
    CONSTRAINT document_verifications_verification_type_check CHECK ((verification_type = ANY (ARRAY['identity'::text, 'expiry'::text, 'financial'::text, 'employment'::text, 'duplicate'::text])))
);


--
-- Name: escalation_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escalation_history (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    application_id uuid NOT NULL,
    escalated_by uuid NOT NULL,
    escalation_type text NOT NULL,
    reason text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT escalation_history_escalation_type_check CHECK ((escalation_type = ANY (ARRAY['complex_case'::text, 'legal_review'::text, 'supervisor_review'::text, 'specialist_review'::text]))),
    CONSTRAINT escalation_history_status_check CHECK ((status = ANY (ARRAY['open'::text, 'resolved'::text])))
);


--
-- Name: escalation_thresholds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.escalation_thresholds (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    key text NOT NULL,
    value numeric NOT NULL,
    note text,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: evidence_packages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_packages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid,
    submission_session_id uuid,
    version integer DEFAULT 1 NOT NULL,
    consultant_id uuid,
    approval_timestamp timestamp with time zone,
    execution_timestamp timestamp with time zone,
    audit_hash text NOT NULL,
    chain_verified boolean DEFAULT false NOT NULL,
    signature text NOT NULL,
    storage_path text NOT NULL,
    region text DEFAULT 'global'::text NOT NULL,
    extension_version text,
    schema_version text,
    package_version text DEFAULT '1.0'::text NOT NULL,
    hash_algo text DEFAULT 'sha256'::text NOT NULL,
    canon_version smallint DEFAULT 1 NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE evidence_packages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.evidence_packages IS 'Gate 2: immutable, signed evidence-package references. Write-once; re-exec => new version. Service-role write.';


--
-- Name: feature_flag_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_flag_audit (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    flag_key text NOT NULL,
    action text NOT NULL,
    before jsonb,
    after jsonb,
    actor_id uuid,
    actor_email text,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feature_flag_audit_action_check CHECK ((action = ANY (ARRAY['created'::text, 'updated'::text, 'deleted'::text])))
);


--
-- Name: feature_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.feature_flags (
    key text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    rollout_percentage smallint DEFAULT 0 NOT NULL,
    allowed_roles text[] DEFAULT '{}'::text[] NOT NULL,
    allowed_cohorts text[] DEFAULT '{}'::text[] NOT NULL,
    allowed_user_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    environments text[] DEFAULT '{}'::text[] NOT NULL,
    updated_by uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT feature_flags_key_check CHECK ((key ~ '^[a-z][a-z0-9_.]{1,62}[a-z0-9]$'::text)),
    CONSTRAINT feature_flags_rollout_percentage_check CHECK (((rollout_percentage >= 0) AND (rollout_percentage <= 100)))
);


--
-- Name: TABLE feature_flags; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.feature_flags IS 'Runtime state for flags DECLARED IN CODE (feature-flags/flag-registry.ts). A row for an unregistered key is ignored by the evaluator.';


--
-- Name: field_verifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.field_verifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    field_key text NOT NULL,
    section text,
    state public.verification_state DEFAULT 'EXTRACTED'::public.verification_state NOT NULL,
    value_snapshot text,
    value_hash text,
    source text,
    source_document_id uuid,
    user_confirmed_by uuid,
    user_confirmed_at timestamp with time zone,
    consultant_reviewed_by uuid,
    consultant_reviewed_at timestamp with time zone,
    consultant_approved_by uuid,
    consultant_approved_at timestamp with time zone,
    executed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT field_verifications_source_check CHECK (((source IS NULL) OR (source = ANY (ARRAY['profile'::text, 'document'::text, 'inferred'::text]))))
);


--
-- Name: TABLE field_verifications; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.field_verifications IS 'Gate 2: per-field verification state cache. Canonical history lives in audit_events. Service-role write.';


--
-- Name: form_template_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_template_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_template_id uuid NOT NULL,
    version_number integer NOT NULL,
    sha256 text NOT NULL,
    storage_path text NOT NULL,
    version_label text,
    byte_size integer,
    capability text,
    field_count integer,
    resolved_pdf_url text,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    superseded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT form_template_versions_supersede_ck CHECK (((is_active AND (superseded_at IS NULL)) OR ((NOT is_active) AND (superseded_at IS NOT NULL))))
);


--
-- Name: TABLE form_template_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.form_template_versions IS 'Version history for cached official government forms (spec §9). One active row per form_template; superseded rows keep their storage_path so the previous PDF stays reachable and comparable.';


--
-- Name: form_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_code text NOT NULL,
    program text NOT NULL,
    form_code text NOT NULL,
    form_name text DEFAULT ''::text NOT NULL,
    landing_url text NOT NULL,
    resolved_pdf_url text,
    version_label text,
    storage_path text,
    sha256 text,
    byte_size integer,
    capability text DEFAULT 'unknown'::text NOT NULL,
    field_count integer,
    fetched_at timestamp with time zone,
    last_checked_at timestamp with time zone,
    status text DEFAULT 'error'::text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_verified_at timestamp with time zone,
    CONSTRAINT form_templates_byte_size_check CHECK (((byte_size IS NULL) OR (byte_size > 0))),
    CONSTRAINT form_templates_cached_status_requires_bytes CHECK (((status <> ALL (ARRAY['ok'::text, 'stale'::text])) OR ((storage_path IS NOT NULL) AND (sha256 IS NOT NULL)))),
    CONSTRAINT form_templates_capability_check CHECK ((capability = ANY (ARRAY['acroform'::text, 'xfa'::text, 'unknown'::text]))),
    CONSTRAINT form_templates_country_code_check CHECK (((char_length(country_code) >= 2) AND (char_length(country_code) <= 12))),
    CONSTRAINT form_templates_error_message_check CHECK ((char_length(error_message) <= 1000)),
    CONSTRAINT form_templates_field_count_check CHECK (((field_count IS NULL) OR (field_count >= 0))),
    CONSTRAINT form_templates_form_code_check CHECK ((char_length(form_code) <= 32)),
    CONSTRAINT form_templates_form_name_check CHECK ((char_length(form_name) <= 200)),
    CONSTRAINT form_templates_program_check CHECK ((char_length(program) <= 64)),
    CONSTRAINT form_templates_sha256_check CHECK (((sha256 IS NULL) OR (char_length(sha256) = 64))),
    CONSTRAINT form_templates_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'stale'::text, 'blocked'::text, 'error'::text]))),
    CONSTRAINT form_templates_version_label_check CHECK ((char_length(version_label) <= 64))
);


--
-- Name: TABLE form_templates; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.form_templates IS 'Cached blank official government forms. One row per (country_code, program, form_code). Written only by the form-refresh job; read by the delivery path. Never holds applicant data.';


--
-- Name: COLUMN form_templates.last_verified_at; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.form_templates.last_verified_at IS 'Last time the cached bytes were CONFIRMED current against the authority (a successful refresh, changed or unchanged). Distinct from last_checked_at (last attempt) and fetched_at (last time the bytes themselves changed). Drives the freshness gate in the delivery path.';


--
-- Name: generated_document_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.generated_document_revisions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    generated_document_id uuid NOT NULL,
    application_id uuid NOT NULL,
    content_md text NOT NULL,
    edited_by uuid,
    edited_role text NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT generated_document_revisions_edited_role_check CHECK ((edited_role = ANY (ARRAY['applicant'::text, 'consultant'::text, 'admin'::text])))
);


--
-- Name: TABLE generated_document_revisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.generated_document_revisions IS 'Prior content of a generated document, captured before each overwrite (consultant edit or applicant approve-with-edits). Service-role write.';


--
-- Name: intake_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intake_messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    role text NOT NULL,
    content text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT intake_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);


--
-- Name: kb_answer_citations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_answer_citations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    retrieval_id uuid NOT NULL,
    chunk_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    claim_index integer NOT NULL,
    claim_text text NOT NULL,
    supporting_quote text,
    citation_url text NOT NULL,
    authority text NOT NULL,
    page_number integer,
    last_checked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_answer_citations_claim_index_check CHECK ((claim_index >= 0)),
    CONSTRAINT kb_answer_citations_claim_text_check CHECK ((char_length(claim_text) <= 2000)),
    CONSTRAINT kb_answer_citations_supporting_quote_check CHECK ((char_length(supporting_quote) <= 2000))
);


--
-- Name: TABLE kb_answer_citations; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_answer_citations IS 'Claim-level citations for a generated answer. One row per (claim, source). A claim with no row here is an unsupported claim, and the generator is required to drop it.';


--
-- Name: kb_blobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_blobs (
    sha256 text NOT NULL,
    byte_size bigint NOT NULL,
    content_type text NOT NULL,
    compression text DEFAULT 'none'::text NOT NULL,
    stored_bytes bigint,
    storage_path text,
    ref_count integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_blobs_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT kb_blobs_compression_check CHECK ((compression = ANY (ARRAY['none'::text, 'gzip'::text]))),
    CONSTRAINT kb_blobs_content_type_check CHECK ((char_length(content_type) <= 128)),
    CONSTRAINT kb_blobs_ref_count_check CHECK ((ref_count >= 0)),
    CONSTRAINT kb_blobs_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT kb_blobs_stored_bytes_check CHECK (((stored_bytes IS NULL) OR (stored_bytes >= 0)))
);


--
-- Name: TABLE kb_blobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_blobs IS 'Content-addressed store for original official files. One row per distinct byte sequence, ever. storage_path null = bytes intentionally not cached (redistribution not permitted); the hash still proves what was read.';


--
-- Name: kb_chunk_scopes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_chunk_scopes (
    chunk_id uuid NOT NULL,
    country_id uuid NOT NULL,
    visa_type_id uuid,
    reason text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    CONSTRAINT kb_chunk_scopes_reason_check CHECK ((reason = ANY (ARRAY['bloc_member'::text, 'shared_page'::text, 'mirrored'::text])))
);


--
-- Name: TABLE kb_chunk_scopes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_chunk_scopes IS 'Additional (country, visa type) applicability for a chunk whose publishing country is not the only one it governs — Schengen rules, shared pages. Reference, never duplication: the chunk text is stored once.';


--
-- Name: kb_chunk_texts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_chunk_texts (
    sha256 text NOT NULL,
    text text NOT NULL,
    char_count integer NOT NULL,
    token_estimate integer NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, text)) STORED,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_chunk_texts_char_count_check CHECK ((char_count >= 0)),
    CONSTRAINT kb_chunk_texts_sha256_check CHECK ((sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT kb_chunk_texts_token_estimate_check CHECK ((token_estimate >= 0))
);


--
-- Name: TABLE kb_chunk_texts; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_chunk_texts IS 'One physical copy of every distinct chunk of text in the corpus. Shared boilerplate across hundreds of government pages costs one row and one embedding. tsvector config is deliberately `simple` — multilingual corpus, and form codes must survive as literal lexemes.';


--
-- Name: kb_chunks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_chunks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    extraction_id uuid NOT NULL,
    source_version_id uuid NOT NULL,
    source_id uuid NOT NULL,
    section_id uuid,
    text_sha256 text NOT NULL,
    ordinal integer NOT NULL,
    country_id uuid NOT NULL,
    visa_type_id uuid,
    authority_rank smallint NOT NULL,
    source_role text NOT NULL,
    language text DEFAULT 'und'::text NOT NULL,
    heading_path text[] DEFAULT '{}'::text[] NOT NULL,
    page_number integer,
    section_kind text,
    form_codes text[] DEFAULT '{}'::text[] NOT NULL,
    effective_from date,
    effective_to date,
    status text DEFAULT 'current'::text NOT NULL,
    superseded_at timestamp with time zone,
    superseded_by uuid,
    confidence numeric(3,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_chunks_authority_rank_check CHECK (((authority_rank >= 1) AND (authority_rank <= 5))),
    CONSTRAINT kb_chunks_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT kb_chunks_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT kb_chunks_page_number_check CHECK (((page_number IS NULL) OR (page_number >= 1))),
    CONSTRAINT kb_chunks_status_check CHECK ((status = ANY (ARRAY['current'::text, 'superseded'::text, 'withdrawn'::text])))
);


--
-- Name: TABLE kb_chunks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_chunks IS 'A retrievable fragment with full provenance and the filters retrieval needs in one row. country_id/visa_type_id are denormalised so jurisdiction isolation is an index scan and can never be optimised away.';


--
-- Name: kb_embeddings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_embeddings (
    text_sha256 text NOT NULL,
    model text NOT NULL,
    dimensions smallint NOT NULL,
    embedding extensions.vector(1536) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_embeddings_dimensions_check CHECK (((dimensions >= 1) AND (dimensions <= 2000))),
    CONSTRAINT kb_embeddings_model_check CHECK ((char_length(model) <= 100))
);


--
-- Name: TABLE kb_embeddings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_embeddings IS 'One vector per distinct chunk text per embedding model version. Keyed by text hash, not chunk id, so N provenance records over identical text cost one embedding.';


--
-- Name: kb_extractions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_extractions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_version_id uuid NOT NULL,
    extractor text NOT NULL,
    extractor_version text NOT NULL,
    text_sha256 text NOT NULL,
    char_count integer NOT NULL,
    text text NOT NULL,
    language text DEFAULT 'und'::text NOT NULL,
    language_confidence numeric(3,2),
    ocr_applied boolean DEFAULT false NOT NULL,
    ocr_confidence numeric(3,2),
    page_count integer,
    table_count integer DEFAULT 0 NOT NULL,
    warnings text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_extractions_char_count_check CHECK ((char_count >= 0)),
    CONSTRAINT kb_extractions_extractor_check CHECK ((char_length(extractor) <= 64)),
    CONSTRAINT kb_extractions_extractor_version_check CHECK ((char_length(extractor_version) <= 32)),
    CONSTRAINT kb_extractions_language_check CHECK ((language ~ '^([a-z]{2}(-[A-Za-z]{2,4})?|und)$'::text)),
    CONSTRAINT kb_extractions_language_confidence_check CHECK (((language_confidence IS NULL) OR ((language_confidence >= (0)::numeric) AND (language_confidence <= (1)::numeric)))),
    CONSTRAINT kb_extractions_ocr_confidence_check CHECK (((ocr_confidence IS NULL) OR ((ocr_confidence >= (0)::numeric) AND (ocr_confidence <= (1)::numeric)))),
    CONSTRAINT kb_extractions_page_count_check CHECK (((page_count IS NULL) OR (page_count >= 0))),
    CONSTRAINT kb_extractions_table_count_check CHECK ((table_count >= 0)),
    CONSTRAINT kb_extractions_text_sha256_check CHECK ((text_sha256 ~ '^[0-9a-f]{64}$'::text))
);


--
-- Name: TABLE kb_extractions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_extractions IS 'Clean text extracted from one official source version by one extractor version. Never updated in place: a parser change makes a new row so already-embedded chunks keep meaning what they meant when they were embedded.';


--
-- Name: kb_freshness_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_freshness_policies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_role text,
    country_id uuid,
    visa_type_id uuid,
    risk_class text NOT NULL,
    check_interval interval NOT NULL,
    staleness_sla interval NOT NULL,
    auto_promote boolean DEFAULT false NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_freshness_no_autopromote_volatile CHECK (((risk_class <> 'volatile'::text) OR (auto_promote = false))),
    CONSTRAINT kb_freshness_policies_risk_class_check CHECK ((risk_class = ANY (ARRAY['volatile'::text, 'standard'::text, 'stable'::text])))
);


--
-- Name: TABLE kb_freshness_policies; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_freshness_policies IS 'Per-risk-class recheck cadence and staleness SLA. Volatile classes (fees, forms, temporary measures) are structurally barred from auto-promotion.';


--
-- Name: kb_ingestion_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_ingestion_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    idempotency_key text NOT NULL,
    source_id uuid,
    source_version_id uuid,
    kind text NOT NULL,
    state text DEFAULT 'queued'::text NOT NULL,
    attempt integer DEFAULT 0 NOT NULL,
    max_attempts integer DEFAULT 3 NOT NULL,
    checkpoint jsonb DEFAULT '{}'::jsonb NOT NULL,
    stats jsonb DEFAULT '{}'::jsonb NOT NULL,
    error_message text,
    run_id uuid,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_ingestion_jobs_attempt_check CHECK ((attempt >= 0)),
    CONSTRAINT kb_ingestion_jobs_error_message_check CHECK ((char_length(error_message) <= 4000)),
    CONSTRAINT kb_ingestion_jobs_kind_check CHECK ((kind = ANY (ARRAY['discover'::text, 'fetch'::text, 'extract'::text, 'chunk'::text, 'embed'::text, 'reindex'::text, 'sweep'::text]))),
    CONSTRAINT kb_ingestion_jobs_max_attempts_check CHECK ((max_attempts >= 1)),
    CONSTRAINT kb_ingestion_jobs_state_check CHECK ((state = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'failed'::text, 'skipped'::text, 'quarantined'::text])))
);


--
-- Name: TABLE kb_ingestion_jobs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_ingestion_jobs IS 'One row per unit of ingestion work, keyed by an idempotency key derived from its subject. Retries and re-enqueues converge on the same row rather than duplicating work or double-writing chunks.';


--
-- Name: kb_quarantine; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_quarantine (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid,
    source_version_id uuid,
    blob_sha256 text,
    reason text NOT NULL,
    detail text,
    sample text,
    resolved boolean DEFAULT false NOT NULL,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_quarantine_detail_check CHECK ((char_length(detail) <= 4000)),
    CONSTRAINT kb_quarantine_reason_check CHECK ((reason = ANY (ARRAY['extraction_failed'::text, 'mime_mismatch'::text, 'oversize'::text, 'suspicious_content'::text, 'encrypted'::text, 'low_confidence'::text]))),
    CONSTRAINT kb_quarantine_resolution_note_check CHECK ((char_length(resolution_note) <= 2000)),
    CONSTRAINT kb_quarantine_sample_check CHECK ((char_length(sample) <= 2000))
);


--
-- Name: TABLE kb_quarantine; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_quarantine IS 'Content the pipeline refused to index, and why. A quarantined version never reaches retrieval; it reaches an admin.';


--
-- Name: kb_retrieval_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_retrieval_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    application_id uuid,
    query_text text NOT NULL,
    query_hash text NOT NULL,
    country_id uuid,
    visa_type_id uuid,
    filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    strategy text NOT NULL,
    embedding_model text,
    candidate_count integer DEFAULT 0 NOT NULL,
    returned_count integer DEFAULT 0 NOT NULL,
    top_score numeric(6,4),
    returned_chunk_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    cache_hit boolean DEFAULT false NOT NULL,
    latency_ms integer,
    outcome text DEFAULT 'answered'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_retrieval_logs_candidate_count_check CHECK ((candidate_count >= 0)),
    CONSTRAINT kb_retrieval_logs_latency_ms_check CHECK (((latency_ms IS NULL) OR (latency_ms >= 0))),
    CONSTRAINT kb_retrieval_logs_outcome_check CHECK ((outcome = ANY (ARRAY['answered'::text, 'insufficient_evidence'::text, 'conflicting'::text, 'error'::text]))),
    CONSTRAINT kb_retrieval_logs_query_hash_check CHECK ((query_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT kb_retrieval_logs_query_text_check CHECK ((char_length(query_text) <= 2000)),
    CONSTRAINT kb_retrieval_logs_returned_count_check CHECK ((returned_count >= 0)),
    CONSTRAINT kb_retrieval_logs_strategy_check CHECK ((strategy = ANY (ARRAY['vector'::text, 'lexical'::text, 'hybrid'::text, 'form_code'::text])))
);


--
-- Name: TABLE kb_retrieval_logs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_retrieval_logs IS 'Every retrieval, with its filters, strategy and result ids. The evaluation harness and the relevance dashboard both read this. Owner-scoped: it records what a person asked.';


--
-- Name: kb_review_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind text NOT NULL,
    severity text DEFAULT 'medium'::text NOT NULL,
    country_id uuid,
    visa_type_id uuid,
    source_id uuid,
    source_change_id uuid,
    title text NOT NULL,
    detail text,
    evidence jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text NOT NULL,
    state text DEFAULT 'open'::text NOT NULL,
    assigned_to uuid,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_note text,
    occurrences integer DEFAULT 1 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_review_queue_detail_check CHECK ((char_length(detail) <= 8000)),
    CONSTRAINT kb_review_queue_kind_check CHECK ((kind = ANY (ARRAY['coverage_gap'::text, 'stale_source'::text, 'extraction_warning'::text, 'material_change'::text, 'conflicting_sources'::text, 'low_citation'::text, 'broken_url'::text]))),
    CONSTRAINT kb_review_queue_occurrences_check CHECK ((occurrences >= 1)),
    CONSTRAINT kb_review_queue_resolution_note_check CHECK ((char_length(resolution_note) <= 4000)),
    CONSTRAINT kb_review_queue_severity_check CHECK ((severity = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT kb_review_queue_state_check CHECK ((state = ANY (ARRAY['open'::text, 'acknowledged'::text, 'resolved'::text, 'dismissed'::text]))),
    CONSTRAINT kb_review_queue_title_check CHECK ((char_length(title) <= 300))
);


--
-- Name: TABLE kb_review_queue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_review_queue IS 'Human review tasks raised by the knowledge layer. dedupe_key collapses a recurring finding into one row with an occurrence count so a persistent gap does not become a thousand tickets.';


--
-- Name: kb_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    extraction_id uuid NOT NULL,
    ordinal integer NOT NULL,
    kind text NOT NULL,
    heading_path text[] DEFAULT '{}'::text[] NOT NULL,
    heading_level smallint,
    page_number integer,
    char_start integer NOT NULL,
    char_end integer NOT NULL,
    text text NOT NULL,
    table_header text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kb_sections_char_end_check CHECK ((char_end >= 0)),
    CONSTRAINT kb_sections_char_start_check CHECK ((char_start >= 0)),
    CONSTRAINT kb_sections_heading_level_check CHECK (((heading_level IS NULL) OR ((heading_level >= 1) AND (heading_level <= 6)))),
    CONSTRAINT kb_sections_kind_check CHECK ((kind = ANY (ARRAY['heading'::text, 'prose'::text, 'list'::text, 'table'::text, 'checklist'::text, 'figure'::text, 'metadata'::text]))),
    CONSTRAINT kb_sections_ordinal_check CHECK ((ordinal >= 0)),
    CONSTRAINT kb_sections_page_number_check CHECK (((page_number IS NULL) OR (page_number >= 1))),
    CONSTRAINT kb_sections_range CHECK ((char_end >= char_start))
);


--
-- Name: TABLE kb_sections; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.kb_sections IS 'Structural decomposition of an extraction: headings, prose, lists and tables in reading order. Chunking cuts along these, never across them.';


--
-- Name: kb_storage_stats; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.kb_storage_stats WITH (security_invoker='true') AS
 SELECT ( SELECT count(*) AS count
           FROM public.kb_blobs) AS blob_count,
    ( SELECT COALESCE(sum(kb_blobs.byte_size), (0)::numeric) AS "coalesce"
           FROM public.kb_blobs) AS blob_logical_bytes,
    ( SELECT COALESCE(sum(COALESCE(kb_blobs.stored_bytes, kb_blobs.byte_size)), (0)::numeric) AS "coalesce"
           FROM public.kb_blobs) AS blob_stored_bytes,
    ( SELECT count(*) AS count
           FROM public.kb_chunks) AS chunk_count,
    ( SELECT count(*) AS count
           FROM public.kb_chunk_texts) AS distinct_chunk_texts,
    ( SELECT count(*) AS count
           FROM public.kb_embeddings) AS embedding_count,
    ( SELECT count(DISTINCT kb_embeddings.model) AS count
           FROM public.kb_embeddings) AS embedding_models,
    ( SELECT COALESCE(sum(kb_chunk_texts.char_count), (0)::bigint) AS "coalesce"
           FROM public.kb_chunk_texts) AS distinct_chunk_chars,
    ( SELECT COALESCE(sum(t.char_count), (0)::bigint) AS "coalesce"
           FROM (public.kb_chunks c
             JOIN public.kb_chunk_texts t ON ((t.sha256 = c.text_sha256)))) AS naive_chunk_chars;


--
-- Name: VIEW kb_storage_stats; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.kb_storage_stats IS 'Corpus size and the deduplication saving: naive_chunk_chars is what the corpus would occupy if every chunk instance stored its own text.';


--
-- Name: kpi_funnel_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_funnel_daily (
    day date NOT NULL,
    funnel text NOT NULL,
    step text NOT NULL,
    step_index integer NOT NULL,
    dim_key text DEFAULT ''::text NOT NULL,
    dim_val text DEFAULT ''::text NOT NULL,
    entered bigint DEFAULT 0 NOT NULL,
    converted bigint DEFAULT 0 NOT NULL
);


--
-- Name: kpi_metric_daily; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_metric_daily (
    day date NOT NULL,
    metric text NOT NULL,
    dim_key text DEFAULT ''::text NOT NULL,
    dim_val text DEFAULT ''::text NOT NULL,
    value_num numeric NOT NULL
);


--
-- Name: kpi_retention_cohort; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kpi_retention_cohort (
    cohort_month date NOT NULL,
    period_index integer NOT NULL,
    dim_key text DEFAULT ''::text NOT NULL,
    dim_val text DEFAULT ''::text NOT NULL,
    cohort_size bigint DEFAULT 0 NOT NULL,
    retained bigint DEFAULT 0 NOT NULL,
    retained_cents bigint DEFAULT 0 NOT NULL
);


--
-- Name: login_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.login_history (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid,
    email text,
    success boolean NOT NULL,
    failure_reason text,
    ip text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketing_attribution; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketing_attribution (
    user_id uuid NOT NULL,
    anon_id text,
    first_touch_at timestamp with time zone DEFAULT now() NOT NULL,
    last_touch_at timestamp with time zone DEFAULT now() NOT NULL,
    utm_source text,
    utm_medium text,
    utm_campaign text,
    utm_term text,
    utm_content text,
    referrer_host text,
    landing_path text
);


--
-- Name: TABLE marketing_attribution; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.marketing_attribution IS 'Campaign attribution per user. Store host/path/utm tags only, never full URLs or PII.';


--
-- Name: message_attachments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.message_attachments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT message_attachments_kind_check CHECK ((kind = ANY (ARRAY['file'::text, 'image'::text])))
);


--
-- Name: messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    conversation_id uuid NOT NULL,
    sender_id uuid NOT NULL,
    sender_role text NOT NULL,
    category text DEFAULT 'general'::text NOT NULL,
    body text NOT NULL,
    parent_message_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig, COALESCE(body, ''::text))) STORED,
    client_id uuid,
    CONSTRAINT messages_category_check CHECK ((category = ANY (ARRAY['general'::text, 'documents'::text, 'eligibility'::text, 'application_status'::text, 'payment'::text, 'travel_history'::text, 'biometrics'::text, 'medical'::text, 'other'::text]))),
    CONSTRAINT messages_sender_role_check CHECK ((sender_role = ANY (ARRAY['user'::text, 'consultant'::text, 'admin'::text, 'ai'::text])))
);


--
-- Name: COLUMN messages.client_id; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.messages.client_id IS 'Client-supplied idempotency key. When present, a repeated send with the same (conversation_id, sender_id, client_id) resolves to the existing row instead of inserting a duplicate. Set by the mobile offline queue; optional for all other callers.';


--
-- Name: notification_broadcasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_broadcasts (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    link text,
    category text DEFAULT 'system'::text NOT NULL,
    audience jsonb NOT NULL,
    status text DEFAULT 'sending'::text NOT NULL,
    recipient_count integer DEFAULT 0 NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    CONSTRAINT notification_broadcasts_status_check CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'failed'::text])))
);


--
-- Name: notification_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_deliveries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    notification_id uuid,
    user_id uuid NOT NULL,
    event_type text NOT NULL,
    channel text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    error text,
    dedupe_key text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT notification_deliveries_channel_check CHECK ((channel = ANY (ARRAY['in_app'::text, 'email'::text, 'web_push'::text, 'sms'::text]))),
    CONSTRAINT notification_deliveries_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'sent'::text, 'failed'::text, 'skipped'::text, 'dead'::text])))
);


--
-- Name: notification_preferences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_preferences (
    user_id uuid NOT NULL,
    email_enabled boolean DEFAULT true NOT NULL,
    push_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    categories jsonb DEFAULT '{}'::jsonb NOT NULL,
    quiet_hours_start smallint,
    quiet_hours_end smallint,
    timezone text,
    language text,
    sms_enabled boolean DEFAULT false NOT NULL,
    CONSTRAINT notification_prefs_qh_end_chk CHECK (((quiet_hours_end IS NULL) OR ((quiet_hours_end >= 0) AND (quiet_hours_end <= 23)))),
    CONSTRAINT notification_prefs_qh_start_chk CHECK (((quiet_hours_start IS NULL) OR ((quiet_hours_start >= 0) AND (quiet_hours_start <= 23))))
);


--
-- Name: notification_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notification_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    event_type text NOT NULL,
    locale text DEFAULT 'en'::text NOT NULL,
    subject text,
    title text NOT NULL,
    body text NOT NULL,
    variables text[] DEFAULT '{}'::text[] NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    type text NOT NULL,
    conversation_id uuid,
    message_id uuid,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    category text DEFAULT 'system'::text NOT NULL,
    title text,
    body text,
    link text,
    data jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: ocr_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ocr_runs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    document_id uuid NOT NULL,
    application_id uuid NOT NULL,
    provider text NOT NULL,
    provider_model text,
    region text DEFAULT 'global'::text NOT NULL,
    status text DEFAULT 'complete'::text NOT NULL,
    page_count integer,
    raw_text_hash text,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ocr_runs_page_count_check CHECK (((page_count IS NULL) OR (page_count >= 0))),
    CONSTRAINT ocr_runs_provider_check CHECK ((provider = ANY (ARRAY['mock'::text, 'openai'::text, 'azure-di'::text, 'aws-textract'::text, 'google-docai'::text]))),
    CONSTRAINT ocr_runs_status_check CHECK ((status = ANY (ARRAY['complete'::text, 'failed'::text])))
);


--
-- Name: TABLE ocr_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ocr_runs IS 'Gate 2: one row per OCR pass. Provenance run-identity (provider/model/region). Service-role write.';


--
-- Name: ops_agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_agent_runs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    agent text NOT NULL,
    task text,
    product_id uuid,
    status text DEFAULT 'running'::text NOT NULL,
    cost_usd numeric,
    tokens integer,
    output_ref text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    CONSTRAINT ops_agent_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: ops_experiments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_experiments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    hypothesis text NOT NULL,
    variant text,
    metric text,
    status text DEFAULT 'planned'::text NOT NULL,
    result text,
    ice_score numeric,
    started_at timestamp with time zone,
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_experiments_status_check CHECK ((status = ANY (ARRAY['planned'::text, 'running'::text, 'complete'::text, 'abandoned'::text])))
);


--
-- Name: ops_marketing_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_marketing_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    channel text NOT NULL,
    campaign text,
    event_type text NOT NULL,
    metrics jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ops_products; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_products (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    status text DEFAULT 'idea'::text NOT NULL,
    market text,
    opportunity_score integer,
    legal_risk text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ops_products_legal_risk_check CHECK ((legal_risk = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'critical'::text]))),
    CONSTRAINT ops_products_opportunity_score_check CHECK (((opportunity_score >= 0) AND (opportunity_score <= 100))),
    CONSTRAINT ops_products_status_check CHECK ((status = ANY (ARRAY['idea'::text, 'research'::text, 'building'::text, 'launched'::text, 'paused'::text, 'killed'::text])))
);


--
-- Name: TABLE ops_products; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ops_products IS 'Internal ops. Service-role only (RLS on, no client policies). No end-user PII.';


--
-- Name: ops_revenue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ops_revenue (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    product_id uuid,
    source text NOT NULL,
    amount_cents bigint DEFAULT 0 NOT NULL,
    currency text DEFAULT 'CAD'::text NOT NULL,
    mrr_cents bigint,
    stripe_ref text,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE ops_revenue; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.ops_revenue IS 'Internal ops. stripe_ref is an opaque id; never store card/payment-instrument data.';


--
-- Name: organization_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_invitations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    token text NOT NULL,
    invited_by uuid,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    accepted_at timestamp with time zone,
    CONSTRAINT organization_invitations_role_check CHECK ((role = ANY (ARRAY['org_admin'::text, 'member'::text, 'consultant'::text]))),
    CONSTRAINT organization_invitations_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'revoked'::text, 'expired'::text])))
);


--
-- Name: organization_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization_members (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_members_role_check CHECK ((role = ANY (ARRAY['org_admin'::text, 'member'::text, 'consultant'::text]))),
    CONSTRAINT organization_members_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text])))
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    owner_user_id uuid NOT NULL,
    plan text DEFAULT 'free'::text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: partner_access_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_access_tokens (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    token_hash text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    grant_type text NOT NULL,
    subject_user_id uuid,
    expires_at timestamp with time zone NOT NULL,
    revoked_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_access_tokens_grant_type_check CHECK ((grant_type = ANY (ARRAY['client_credentials'::text, 'authorization_code'::text])))
);


--
-- Name: partner_api_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_api_keys (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    name text NOT NULL,
    prefix text NOT NULL,
    key_hash text NOT NULL,
    last_four text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    rotated_from uuid,
    expires_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_by uuid,
    revoked_at timestamp with time zone,
    revoked_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_api_keys_status_check CHECK ((status = ANY (ARRAY['active'::text, 'rotating'::text, 'revoked'::text])))
);


--
-- Name: partner_api_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_api_requests (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    environment text NOT NULL,
    method text NOT NULL,
    route_template text NOT NULL,
    api_version text DEFAULT 'v1'::text NOT NULL,
    status_code integer NOT NULL,
    latency_ms integer NOT NULL,
    request_id text NOT NULL,
    credential_kind text NOT NULL,
    credential_id uuid,
    error_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_api_requests_credential_kind_check CHECK ((credential_kind = ANY (ARRAY['api_key'::text, 'oauth_token'::text]))),
    CONSTRAINT partner_api_requests_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'live'::text])))
);


--
-- Name: partner_applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_applications (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    partner_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    environment text NOT NULL,
    client_id text NOT NULL,
    client_secret_hash text,
    client_type text DEFAULT 'confidential'::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    requested_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    grant_types text[] DEFAULT '{client_credentials}'::text[] NOT NULL,
    redirect_uris text[] DEFAULT '{}'::text[] NOT NULL,
    ip_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    status_reason text,
    created_by uuid,
    approved_at timestamp with time zone,
    approved_by uuid,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_applications_client_type_check CHECK ((client_type = ANY (ARRAY['confidential'::text, 'public'::text]))),
    CONSTRAINT partner_applications_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'live'::text]))),
    CONSTRAINT partner_applications_status_check CHECK ((status = ANY (ARRAY['pending_review'::text, 'active'::text, 'suspended'::text, 'revoked'::text])))
);


--
-- Name: partner_authorization_codes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_authorization_codes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    code_hash text NOT NULL,
    subject_user_id uuid NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    redirect_uri text NOT NULL,
    code_challenge text NOT NULL,
    code_challenge_method text DEFAULT 'S256'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_authorization_codes_code_challenge_method_check CHECK ((code_challenge_method = 'S256'::text))
);


--
-- Name: partner_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    organization_id uuid,
    subject_user_id uuid,
    event_type text NOT NULL,
    resource_type text NOT NULL,
    resource_id uuid,
    environment text DEFAULT 'live'::text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    sequence bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_events_environment_check CHECK ((environment = ANY (ARRAY['sandbox'::text, 'live'::text])))
);


--
-- Name: partner_events_sequence_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.partner_events_sequence_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: partner_events_sequence_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.partner_events_sequence_seq OWNED BY public.partner_events.sequence;


--
-- Name: partner_idempotency_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_idempotency_keys (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    idempotency_key text NOT NULL,
    request_hash text NOT NULL,
    route_template text NOT NULL,
    status_code integer,
    response_body jsonb,
    state text DEFAULT 'in_progress'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_idempotency_keys_state_check CHECK ((state = ANY (ARRAY['in_progress'::text, 'completed'::text])))
);


--
-- Name: partner_sandbox_resources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_sandbox_resources (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    resource_type text NOT NULL,
    resource_key text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: partner_usage_counters; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_usage_counters (
    application_id uuid NOT NULL,
    window_kind text NOT NULL,
    window_start timestamp with time zone NOT NULL,
    count bigint DEFAULT 0 NOT NULL,
    CONSTRAINT partner_usage_counters_window_kind_check CHECK ((window_kind = ANY (ARRAY['minute'::text, 'day'::text, 'month'::text])))
);


--
-- Name: partner_user_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_user_consents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone
);


--
-- Name: partner_webhook_deliveries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_webhook_deliveries (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    endpoint_id uuid NOT NULL,
    event_id uuid NOT NULL,
    event_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempt_count integer DEFAULT 0 NOT NULL,
    next_attempt_at timestamp with time zone DEFAULT now() NOT NULL,
    last_status_code integer,
    last_error text,
    duration_ms integer,
    delivered_at timestamp with time zone,
    replayed_from uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'delivering'::text, 'delivered'::text, 'failed'::text, 'dead'::text])))
);


--
-- Name: partner_webhook_endpoints; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partner_webhook_endpoints (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    url text NOT NULL,
    description text,
    events text[] DEFAULT '{}'::text[] NOT NULL,
    status text DEFAULT 'pending_verification'::text NOT NULL,
    secret_encrypted text NOT NULL,
    previous_secret_encrypted text,
    previous_secret_expires_at timestamp with time zone,
    verification_token text,
    verified_at timestamp with time zone,
    consecutive_failures integer DEFAULT 0 NOT NULL,
    disabled_reason text,
    disabled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partner_webhook_endpoints_status_check CHECK ((status = ANY (ARRAY['pending_verification'::text, 'active'::text, 'disabled'::text])))
);


--
-- Name: partners; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.partners (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    organization_id uuid NOT NULL,
    legal_name text NOT NULL,
    contact_email text NOT NULL,
    website text,
    status text DEFAULT 'pending'::text NOT NULL,
    tier text DEFAULT 'standard'::text NOT NULL,
    compliance jsonb DEFAULT '{}'::jsonb NOT NULL,
    status_reason text,
    approved_at timestamp with time zone,
    approved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT partners_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'rejected'::text]))),
    CONSTRAINT partners_tier_check CHECK ((tier = ANY (ARRAY['standard'::text, 'scale'::text, 'enterprise'::text])))
);


--
-- Name: payment_disputes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_disputes (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    payment_id uuid,
    stripe_dispute_id text NOT NULL,
    provider_object_id text NOT NULL,
    amount_cents integer,
    currency text,
    reason text,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: payment_dunning; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_dunning (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    subscription_id uuid NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_attempt_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_dunning_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT payment_dunning_status_check CHECK ((status = ANY (ARRAY['active'::text, 'recovered'::text, 'canceled'::text])))
);


--
-- Name: payment_event_processing; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_event_processing (
    provider_event_id text NOT NULL,
    status text NOT NULL,
    attempt_count integer DEFAULT 1 NOT NULL,
    claimed_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    last_error text,
    CONSTRAINT payment_event_processing_attempt_count_check CHECK ((attempt_count > 0)),
    CONSTRAINT payment_event_processing_processed_at_check CHECK ((((status = 'processed'::text) AND (processed_at IS NOT NULL) AND (last_error IS NULL)) OR ((status <> 'processed'::text) AND (processed_at IS NULL)))),
    CONSTRAINT payment_event_processing_status_check CHECK ((status = ANY (ARRAY['processing'::text, 'processed'::text, 'failed'::text])))
);


--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    provider text NOT NULL,
    event_type text NOT NULL,
    provider_event_id text NOT NULL,
    provider_object_id text NOT NULL,
    amount_minor bigint,
    currency text,
    direction text NOT NULL,
    user_id uuid,
    related_entity jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_events_direction_check CHECK ((direction = ANY (ARRAY['credit'::text, 'debit'::text])))
);


--
-- Name: TABLE payment_events; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.payment_events IS 'SP1: append-only payment ledger. UPDATE/DELETE blocked. Event-level idempotency via provider_event_id UNIQUE.';


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    application_id uuid NOT NULL,
    stripe_payment_intent_id text,
    plan_tier text,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    feature text DEFAULT 'plan'::text NOT NULL,
    visa_type text,
    country_code text,
    amount_cents integer,
    currency text DEFAULT 'usd'::text NOT NULL,
    provider text DEFAULT 'stripe'::text NOT NULL,
    invoice_id text,
    invoice_url text,
    tax_cents integer,
    discount_cents integer,
    disputed_at timestamp with time zone,
    CONSTRAINT payments_amount_cents_check CHECK (((amount_cents IS NULL) OR (amount_cents >= 0))),
    CONSTRAINT payments_feature_check CHECK ((feature = ANY (ARRAY['plan'::text, 'prefill'::text, 'processing_fee'::text, 'addon'::text]))),
    CONSTRAINT payments_plan_tier_check CHECK ((plan_tier = ANY (ARRAY['self_service'::text, 'copilot'::text, 'expert'::text]))),
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'complete'::text, 'failed'::text, 'refunded'::text])))
);


--
-- Name: COLUMN payments.amount_cents; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.payments.amount_cents IS 'Amount in the currency''s minor unit (see payments.currency).';


--
-- Name: payout_tax_statements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payout_tax_statements (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    consultant_id uuid NOT NULL,
    tax_year integer NOT NULL,
    currency text DEFAULT 'usd'::text NOT NULL,
    gross_paid_cents bigint DEFAULT 0 NOT NULL,
    payout_count integer DEFAULT 0 NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payout_tax_statements_gross_paid_cents_check CHECK ((gross_paid_cents >= 0)),
    CONSTRAINT payout_tax_statements_payout_count_check CHECK ((payout_count >= 0))
);


--
-- Name: permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permissions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    key text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: post_submission_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.post_submission_events (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    event_type text NOT NULL,
    raw_email_encrypted text,
    summary text,
    deadline timestamp with time zone,
    status text DEFAULT 'new'::text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT post_submission_events_event_type_check CHECK ((event_type = ANY (ARRAY['biometrics'::text, 'passport_request'::text, 'adr'::text, 'medical'::text, 'approval'::text, 'refusal'::text]))),
    CONSTRAINT post_submission_events_status_check CHECK ((status = ANY (ARRAY['new'::text, 'actioned'::text, 'complete'::text])))
);


--
-- Name: preflight_reviews; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.preflight_reviews (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    submission_session_id uuid,
    status public.preflight_status DEFAULT 'in_review'::public.preflight_status NOT NULL,
    reviewer_id uuid,
    reviewer_role public.audit_actor_role,
    passport_reviewed boolean DEFAULT false NOT NULL,
    dates_reviewed boolean DEFAULT false NOT NULL,
    travel_history_reviewed boolean DEFAULT false NOT NULL,
    addresses_reviewed boolean DEFAULT false NOT NULL,
    employment_reviewed boolean DEFAULT false NOT NULL,
    final_approval boolean DEFAULT false NOT NULL,
    locked_diff_hash text,
    extension_version text,
    schema_version text,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone,
    invalidated_at timestamp with time zone,
    CONSTRAINT preflight_completed_requires_all_checks CHECK (((status <> 'completed'::public.preflight_status) OR (passport_reviewed AND dates_reviewed AND travel_history_reviewed AND addresses_reviewed AND employment_reviewed AND final_approval AND (locked_diff_hash IS NOT NULL) AND (completed_at IS NOT NULL))))
);


--
-- Name: TABLE preflight_reviews; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.preflight_reviews IS 'Gate 2: mandatory preflight diff review. completed requires all 6 checks + locked_diff_hash. Service-role write.';


--
-- Name: pricing_constants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_constants (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    key text NOT NULL,
    value numeric NOT NULL,
    note text,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_country_factors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_country_factors (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    country_code text NOT NULL,
    labor_band text NOT NULL,
    labor_multiplier numeric NOT NULL,
    ai_complexity_multiplier numeric DEFAULT 1.0 NOT NULL,
    ppp_factor numeric DEFAULT 1.0 NOT NULL,
    reviewer_rate_usd numeric NOT NULL,
    price_band_min numeric NOT NULL,
    price_band_max numeric NOT NULL,
    priceable boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT pricing_country_factors_ai_complexity_multiplier_check CHECK ((ai_complexity_multiplier > (0)::numeric)),
    CONSTRAINT pricing_country_factors_check CHECK ((price_band_max >= price_band_min)),
    CONSTRAINT pricing_country_factors_labor_band_check CHECK ((labor_band = ANY (ARRAY['low'::text, 'mid'::text, 'high'::text, 'origin'::text]))),
    CONSTRAINT pricing_country_factors_labor_multiplier_check CHECK ((labor_multiplier > (0)::numeric)),
    CONSTRAINT pricing_country_factors_ppp_factor_check CHECK ((ppp_factor > (0)::numeric)),
    CONSTRAINT pricing_country_factors_price_band_min_check CHECK ((price_band_min >= (0)::numeric)),
    CONSTRAINT pricing_country_factors_reviewer_rate_usd_check CHECK ((reviewer_rate_usd > (0)::numeric))
);


--
-- Name: pricing_quote_audit; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_quote_audit (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    visa_type text NOT NULL,
    country_code text NOT NULL,
    recommended_price numeric NOT NULL,
    gross_margin numeric NOT NULL,
    breakdown jsonb DEFAULT '{}'::jsonb NOT NULL,
    config_snapshot_id uuid,
    shown_to_user uuid,
    event text DEFAULT 'recompute'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pricing_visa_tiers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pricing_visa_tiers (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    visa_type text NOT NULL,
    complexity_tier text NOT NULL,
    compressed_review_hours numeric NOT NULL,
    lawyer_flag boolean DEFAULT false NOT NULL,
    priceable boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ai_cost_base_usd numeric DEFAULT 0 NOT NULL,
    base_anchor_usd numeric DEFAULT 0 NOT NULL,
    human_fee_usd numeric DEFAULT 0 NOT NULL,
    CONSTRAINT pricing_visa_tiers_ai_cost_base_usd_check CHECK ((ai_cost_base_usd >= (0)::numeric)),
    CONSTRAINT pricing_visa_tiers_base_anchor_usd_check CHECK ((base_anchor_usd >= (0)::numeric)),
    CONSTRAINT pricing_visa_tiers_complexity_tier_check CHECK ((complexity_tier = ANY (ARRAY['low'::text, 'med'::text, 'med_high'::text, 'high'::text]))),
    CONSTRAINT pricing_visa_tiers_compressed_review_hours_check CHECK ((compressed_review_hours >= (0)::numeric)),
    CONSTRAINT pricing_visa_tiers_human_fee_usd_check CHECK ((human_fee_usd >= (0)::numeric))
);


--
-- Name: privacy_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.privacy_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    subject_email text NOT NULL,
    kind text NOT NULL,
    status text DEFAULT 'completed'::text NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT privacy_requests_kind_check CHECK ((kind = ANY (ARRAY['export'::text, 'deletion'::text]))),
    CONSTRAINT privacy_requests_status_check CHECK ((status = ANY (ARRAY['completed'::text, 'failed'::text])))
);


--
-- Name: promotions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.promotions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    name text NOT NULL,
    coupon_id uuid NOT NULL,
    stripe_promotion_code_id text,
    audience text DEFAULT 'all'::text NOT NULL,
    country_code text,
    visa_type text,
    starts_at timestamp with time zone DEFAULT now() NOT NULL,
    ends_at timestamp with time zone,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT promotions_audience_check CHECK ((audience = ANY (ARRAY['all'::text, 'returning'::text, 'family_bundle'::text, 'new_corridor'::text, 'manual'::text])))
);


--
-- Name: push_subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.push_subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    endpoint text NOT NULL,
    p256dh text NOT NULL,
    auth text NOT NULL,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: reconciliation_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_exceptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    run_id uuid,
    kind text NOT NULL,
    provider_object_id text NOT NULL,
    expected jsonb,
    actual jsonb,
    resolved boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reconciliation_exceptions_kind_check CHECK ((kind = ANY (ARRAY['missing_in_ledger'::text, 'phantom_in_ledger'::text, 'amount_mismatch'::text])))
);


--
-- Name: reconciliation_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reconciliation_runs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    run_date date NOT NULL,
    range_start timestamp with time zone NOT NULL,
    range_end timestamp with time zone NOT NULL,
    provider text NOT NULL,
    matched_count integer DEFAULT 0 NOT NULL,
    exception_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone
);


--
-- Name: refunds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refunds (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    payment_id uuid,
    stripe_refund_id text,
    amount_cents integer NOT NULL,
    reason text,
    status text DEFAULT 'pending'::text NOT NULL,
    initiated_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refunds_amount_cents_check CHECK ((amount_cents >= 0)),
    CONSTRAINT refunds_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed'::text])))
);


--
-- Name: reminder_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reminder_log (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    application_id uuid NOT NULL,
    user_id uuid NOT NULL,
    stage text NOT NULL,
    kind text NOT NULL,
    sent_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reminder_log_kind_check CHECK ((kind = ANY (ARRAY['stall_3'::text, 'stall_7'::text, 'stall_14'::text])))
);


--
-- Name: TABLE reminder_log; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.reminder_log IS 'Epic B: append-only reminder dedupe. Service-role only.';


--
-- Name: risk_weights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.risk_weights (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    dimension text NOT NULL,
    weight numeric NOT NULL,
    note text,
    effective_from timestamp with time zone DEFAULT now() NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT risk_weights_dimension_check CHECK ((dimension = ANY (ARRAY['documentation'::text, 'financial'::text, 'travel_history'::text, 'home_ties'::text, 'employment'::text, 'consistency'::text]))),
    CONSTRAINT risk_weights_weight_check CHECK (((weight >= (0)::numeric) AND (weight <= (1)::numeric)))
);


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    key text NOT NULL,
    name text NOT NULL,
    description text,
    scope text DEFAULT 'platform'::text NOT NULL,
    is_system boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_scope_check CHECK ((scope = ANY (ARRAY['platform'::text, 'organization'::text])))
);


--
-- Name: section_verification; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.section_verification WITH (security_invoker='true') AS
 SELECT application_id,
    section,
    min(state) AS section_state,
    count(*) AS field_count,
    count(*) FILTER (WHERE (state >= 'EXECUTION_READY'::public.verification_state)) AS ready_count
   FROM public.field_verifications
  GROUP BY application_id, section;


--
-- Name: VIEW section_verification; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.section_verification IS 'Section rollup over field_verifications. security_invoker=true — the view MUST evaluate under the caller''s RLS, otherwise it re-exposes every tenant''s rows (the underlying table is owner-read only). Do not remove.';


--
-- Name: subscription_credits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscription_credits (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    subscription_id uuid NOT NULL,
    user_id uuid NOT NULL,
    period_start timestamp with time zone NOT NULL,
    period_end timestamp with time zone NOT NULL,
    granted integer DEFAULT 0 NOT NULL,
    consumed integer DEFAULT 0 NOT NULL,
    stripe_usage_record_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscription_credits_check CHECK ((consumed <= granted)),
    CONSTRAINT subscription_credits_consumed_check CHECK ((consumed >= 0)),
    CONSTRAINT subscription_credits_granted_check CHECK ((granted >= 0))
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    stripe_subscription_id text NOT NULL,
    stripe_customer_id text NOT NULL,
    plan text NOT NULL,
    status text NOT NULL,
    billing_interval text DEFAULT 'month'::text NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT subscriptions_billing_interval_check CHECK ((billing_interval = ANY (ARRAY['month'::text, 'year'::text]))),
    CONSTRAINT subscriptions_plan_check CHECK ((plan = ANY (ARRAY['base'::text, 'pro'::text, 'premium'::text]))),
    CONSTRAINT subscriptions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'trialing'::text, 'past_due'::text, 'canceled'::text, 'incomplete'::text])))
);


--
-- Name: template_revisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_revisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    country_code text NOT NULL,
    program text NOT NULL,
    code text NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    change_kind text NOT NULL,
    previous_sha256 text,
    new_sha256 text NOT NULL,
    previous_version_label text,
    new_version_label text,
    previous_field_count integer,
    new_field_count integer,
    resolved_url text,
    byte_size integer,
    storage_path text,
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT template_revisions_byte_size_check CHECK (((byte_size IS NULL) OR (byte_size > 0))),
    CONSTRAINT template_revisions_change_kind_check CHECK ((change_kind = ANY (ARRAY['first_cache'::text, 'revision'::text, 'silent_reissue'::text]))),
    CONSTRAINT template_revisions_code_check CHECK ((char_length(code) <= 48)),
    CONSTRAINT template_revisions_country_code_check CHECK (((char_length(country_code) >= 2) AND (char_length(country_code) <= 12))),
    CONSTRAINT template_revisions_name_check CHECK ((char_length(name) <= 250)),
    CONSTRAINT template_revisions_new_field_count_check CHECK (((new_field_count IS NULL) OR (new_field_count >= 0))),
    CONSTRAINT template_revisions_new_sha256_check CHECK ((char_length(new_sha256) = 64)),
    CONSTRAINT template_revisions_new_version_label_check CHECK ((char_length(new_version_label) <= 64)),
    CONSTRAINT template_revisions_previous_field_count_check CHECK (((previous_field_count IS NULL) OR (previous_field_count >= 0))),
    CONSTRAINT template_revisions_previous_sha256_check CHECK (((previous_sha256 IS NULL) OR (char_length(previous_sha256) = 64))),
    CONSTRAINT template_revisions_previous_version_label_check CHECK ((char_length(previous_version_label) <= 64)),
    CONSTRAINT template_revisions_program_check CHECK ((char_length(program) <= 64)),
    CONSTRAINT template_revisions_source_check CHECK ((source = ANY (ARRAY['form'::text, 'document'::text])))
);


--
-- Name: TABLE template_revisions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.template_revisions IS 'Append-only history of every change to a cached government form or document. Written by the refresh jobs; read by ops. Never holds applicant data.';


--
-- Name: template_sweep_findings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.template_sweep_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    authority text NOT NULL,
    code text NOT NULL,
    title text DEFAULT ''::text NOT NULL,
    url text NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    note text,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    resolved_at timestamp with time zone,
    resolved_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT template_sweep_findings_authority_check CHECK ((char_length(authority) <= 32)),
    CONSTRAINT template_sweep_findings_code_check CHECK ((char_length(code) <= 48)),
    CONSTRAINT template_sweep_findings_note_check CHECK ((char_length(note) <= 1000)),
    CONSTRAINT template_sweep_findings_status_check CHECK ((status = ANY (ARRAY['new'::text, 'acknowledged'::text, 'added'::text, 'ignored'::text]))),
    CONSTRAINT template_sweep_findings_title_check CHECK ((char_length(title) <= 250))
);


--
-- Name: TABLE template_sweep_findings; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.template_sweep_findings IS 'Artifacts found on a government forms index that are not in VisaAI''s catalog. A PROPOSAL queue for a human — the sweep never edits the catalog itself, because an unreviewed government URL must never reach an applicant.';


--
-- Name: user_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_profiles (
    user_id uuid NOT NULL,
    first_name text,
    last_name text,
    phone text,
    address_line1 text,
    address_line2 text,
    city text,
    region text,
    postal_code text,
    country text,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    avatar_url text,
    privacy jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_roles (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    organization_id uuid,
    granted_by uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text,
    full_name text,
    nationality text,
    stripe_customer_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    email_reminders boolean DEFAULT true NOT NULL,
    onboarded_at timestamp with time zone,
    preferred_language text,
    status text DEFAULT 'active'::text NOT NULL,
    status_reason text,
    status_changed_at timestamp with time zone,
    status_changed_by uuid,
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'deleted'::text])))
);


--
-- Name: v_application_funnel; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_application_funnel WITH (security_invoker='on') AS
 SELECT id AS application_id,
    user_id,
    status,
    created_at,
    (EXISTS ( SELECT 1
           FROM public.vri_scores v
          WHERE (v.application_id = a.id))) AS reached_readiness,
    ( SELECT max(e.occurred_at) AS max
           FROM public.analytics_events e
          WHERE ((e.application_id = a.id) AND (e.event_name = 'application_readiness_reached'::text))) AS readiness_reached_at
   FROM public.applications a;


--
-- Name: VIEW v_application_funnel; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_application_funnel IS 'North-star funnel: reached_readiness marks an application that earned a VRI score.';


--
-- Name: v_client_dml_grants_without_policy; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_client_dml_grants_without_policy WITH (security_invoker='true') AS
 WITH dml AS (
         SELECT DISTINCT role_table_grants.table_name
           FROM information_schema.role_table_grants
          WHERE (((role_table_grants.table_schema)::name = 'public'::name) AND ((role_table_grants.grantee)::name = ANY (ARRAY['anon'::name, 'authenticated'::name])) AND ((role_table_grants.privilege_type)::text = ANY ((ARRAY['INSERT'::character varying, 'UPDATE'::character varying, 'DELETE'::character varying])::text[])))
        ), writable AS (
         SELECT DISTINCT pg_policies.tablename AS table_name
           FROM pg_policies
          WHERE ((pg_policies.schemaname = 'public'::name) AND (pg_policies.cmd = ANY (ARRAY['INSERT'::text, 'UPDATE'::text, 'DELETE'::text, 'ALL'::text])) AND (pg_policies.roles && ARRAY['anon'::name, 'authenticated'::name, 'public'::name]))
        )
 SELECT d.table_name
   FROM (dml d
     LEFT JOIN writable w USING (table_name))
  WHERE (w.table_name IS NULL);


--
-- Name: VIEW v_client_dml_grants_without_policy; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_client_dml_grants_without_policy IS 'DB-003 invariant: must return zero rows. A row is an INSERT/UPDATE/DELETE grant to anon/authenticated that no RLS policy can exercise.';


--
-- Name: v_public_indexes; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.v_public_indexes WITH (security_invoker='true') AS
 SELECT schemaname,
    tablename,
    indexname
   FROM pg_indexes
  WHERE (schemaname = 'public'::name);


--
-- Name: VIEW v_public_indexes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.v_public_indexes IS 'PERF-007 support: index names only, no data. Lets CI assert that redundant indexes were not recreated.';


--
-- Name: visa_countries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_countries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    is_bloc boolean DEFAULT false NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    localized_names jsonb DEFAULT '{}'::jsonb NOT NULL,
    immigration_authority text,
    immigration_authority_url text,
    foreign_affairs_authority text,
    foreign_affairs_authority_url text,
    official_visa_url text,
    evisa_portal_url text,
    official_languages text[] DEFAULT '{}'::text[] NOT NULL,
    fee_currency text,
    support_state text DEFAULT 'preview'::text NOT NULL,
    data_quality text DEFAULT 'unverified'::text NOT NULL,
    last_verified_at timestamp with time zone,
    jurisdiction_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visa_countries_code_check CHECK (((code = upper(code)) AND ((char_length(code) >= 2) AND (char_length(code) <= 12)))),
    CONSTRAINT visa_countries_data_quality_check CHECK ((data_quality = ANY (ARRAY['verified'::text, 'stale'::text, 'unverified'::text, 'failing'::text]))),
    CONSTRAINT visa_countries_fee_currency_check CHECK (((fee_currency IS NULL) OR (fee_currency ~ '^[A-Z]{3}$'::text))),
    CONSTRAINT visa_countries_foreign_affairs_authority_check CHECK ((char_length(foreign_affairs_authority) <= 200)),
    CONSTRAINT visa_countries_immigration_authority_check CHECK ((char_length(immigration_authority) <= 200)),
    CONSTRAINT visa_countries_jurisdiction_note_check CHECK ((char_length(jurisdiction_note) <= 1000)),
    CONSTRAINT visa_countries_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 120))),
    CONSTRAINT visa_countries_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT visa_countries_support_state_check CHECK ((support_state = ANY (ARRAY['supported'::text, 'preview'::text, 'unsupported'::text])))
);


--
-- Name: TABLE visa_countries; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_countries IS 'Canonical destination registry: one row per country or bloc VisaAI can serve, with its immigration authority and official portals. Government reference data — never user-owned. Service-role write only.';


--
-- Name: visa_requirements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_requirements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    visa_type_id uuid NOT NULL,
    requirement_code text NOT NULL,
    kind text NOT NULL,
    officially_required boolean DEFAULT true NOT NULL,
    label text NOT NULL,
    description text,
    official_form_code text,
    official_form_url text,
    rule jsonb,
    parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_version_id uuid NOT NULL,
    source_excerpt text,
    extraction_method text DEFAULT 'manual'::text NOT NULL,
    confidence numeric(3,2),
    status text DEFAULT 'draft'::text NOT NULL,
    display_order integer DEFAULT 100 NOT NULL,
    last_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source_excerpt_display text,
    CONSTRAINT visa_requirements_confidence_check CHECK (((confidence IS NULL) OR ((confidence >= (0)::numeric) AND (confidence <= (1)::numeric)))),
    CONSTRAINT visa_requirements_display_excerpt_len CHECK (((source_excerpt_display IS NULL) OR (char_length(source_excerpt_display) <= 4000))),
    CONSTRAINT visa_requirements_extraction_method_check CHECK ((extraction_method = ANY (ARRAY['manual'::text, 'parser'::text, 'ai_assisted'::text]))),
    CONSTRAINT visa_requirements_kind_check CHECK ((kind = ANY (ARRAY['form'::text, 'evidence'::text, 'condition'::text, 'fee'::text, 'step'::text, 'recommended'::text]))),
    CONSTRAINT visa_requirements_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 300))),
    CONSTRAINT visa_requirements_official_form_code_check CHECK ((char_length(official_form_code) <= 64)),
    CONSTRAINT visa_requirements_recommended_not_official CHECK (((kind <> 'recommended'::text) OR (officially_required = false))),
    CONSTRAINT visa_requirements_requirement_code_check CHECK ((requirement_code ~ '^[a-z0-9_]+$'::text)),
    CONSTRAINT visa_requirements_source_excerpt_check CHECK ((char_length(source_excerpt) <= 4000)),
    CONSTRAINT visa_requirements_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'retired'::text])))
);


--
-- Name: TABLE visa_requirements; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_requirements IS 'Typed, sourced, conditionally-scoped visa requirements. Every row cites the exact source VERSION it was read from. kind = recommended is VisaAI advice and is structurally barred from claiming official status.';


--
-- Name: COLUMN visa_requirements.source_excerpt; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visa_requirements.source_excerpt IS 'The MATCHING text: normalized and lowercased exactly as the monitor produces it, so verify-excerpts.ts, verify-extraction-bounds.ts and the change detector all compare like with like. Not for display -- see source_excerpt_display.';


--
-- Name: COLUMN visa_requirements.source_excerpt_display; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visa_requirements.source_excerpt_display IS 'The excerpt with the authority''s own capitalisation, for QUOTING on the public page. Derived from the same span of the same page version as source_excerpt by scripts/derive-display-excerpts.ts. NULL means the authority''s wording could not be established, and the page must then render no quotation rather than quoting the lowercased matching text. Never back-fill this from source_excerpt.';


--
-- Name: visa_sources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_sources (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_id uuid NOT NULL,
    visa_type_id uuid,
    role text NOT NULL,
    authority text NOT NULL,
    authority_rank smallint DEFAULT 1 NOT NULL,
    canonical_url text NOT NULL,
    source_url text NOT NULL,
    title text,
    language text DEFAULT 'en'::text NOT NULL,
    robots_state text DEFAULT 'unknown'::text NOT NULL,
    redistribution text DEFAULT 'unknown'::text NOT NULL,
    check_interval interval DEFAULT '1 day'::interval NOT NULL,
    freshness_sla interval DEFAULT '30 days'::interval NOT NULL,
    active boolean DEFAULT true NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_checked_at timestamp with time zone,
    last_success_at timestamp with time zone,
    last_changed_at timestamp with time zone,
    failure_streak integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visa_sources_authority_check CHECK ((char_length(authority) <= 200)),
    CONSTRAINT visa_sources_authority_rank_check CHECK (((authority_rank >= 1) AND (authority_rank <= 5))),
    CONSTRAINT visa_sources_failure_streak_check CHECK ((failure_streak >= 0)),
    CONSTRAINT visa_sources_language_check CHECK ((language ~ '^[a-z]{2}(-[A-Za-z]{2,4})?$'::text)),
    CONSTRAINT visa_sources_redistribution_check CHECK ((redistribution = ANY (ARRAY['permitted'::text, 'prohibited'::text, 'unknown'::text]))),
    CONSTRAINT visa_sources_robots_state_check CHECK ((robots_state = ANY (ARRAY['allowed'::text, 'disallowed'::text, 'unknown'::text]))),
    CONSTRAINT visa_sources_role_check CHECK ((role = ANY (ARRAY['index'::text, 'landing'::text, 'eligibility'::text, 'requirements'::text, 'documents'::text, 'forms'::text, 'fees'::text, 'processing_times'::text, 'application'::text, 'policy'::text, 'news'::text]))),
    CONSTRAINT visa_sources_title_check CHECK ((char_length(title) <= 500))
);


--
-- Name: TABLE visa_sources; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_sources IS 'Registry of official government pages VisaAI monitors. One row per (source_url, visa_type_id): a single authority page frequently covers several visa types, and a country-level row (visa_type_id null) covers the authority index pages. Every visa requirement must cite a version of one of these rows. authority_rank 1-5 are all government sources; third-party sites are not permitted here.';


--
-- Name: visa_types; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_types (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    country_id uuid NOT NULL,
    visaai_id text NOT NULL,
    category text NOT NULL,
    official_name text NOT NULL,
    official_code text,
    official_stream text,
    slug text NOT NULL,
    aliases text[] DEFAULT '{}'::text[] NOT NULL,
    purpose text,
    official_description text,
    lifecycle_state text DEFAULT 'active'::text NOT NULL,
    effective_from date,
    effective_to date,
    program_id text,
    last_verified_at timestamp with time zone,
    data_quality text DEFAULT 'unverified'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visa_types_category_check CHECK ((category = ANY (ARRAY['visitor'::text, 'tourism'::text, 'business'::text, 'transit'::text, 'student'::text, 'work'::text, 'skilled_worker'::text, 'temporary_worker'::text, 'seasonal_work'::text, 'working_holiday'::text, 'youth_mobility'::text, 'digital_nomad'::text, 'investor'::text, 'entrepreneur'::text, 'family'::text, 'spouse_partner'::text, 'parent'::text, 'dependant'::text, 'family_reunification'::text, 'research'::text, 'academic'::text, 'exchange'::text, 'medical'::text, 'religious'::text, 'volunteer'::text, 'diplomatic'::text, 'official'::text, 'media'::text, 'crew'::text, 'performer'::text, 'cultural_sport'::text, 'humanitarian'::text, 'permanent_residence'::text, 'evisa'::text, 'eta'::text, 'other'::text]))),
    CONSTRAINT visa_types_data_quality_check CHECK ((data_quality = ANY (ARRAY['verified'::text, 'stale'::text, 'unverified'::text, 'failing'::text]))),
    CONSTRAINT visa_types_effective_range CHECK (((effective_from IS NULL) OR (effective_to IS NULL) OR (effective_to >= effective_from))),
    CONSTRAINT visa_types_lifecycle_state_check CHECK ((lifecycle_state = ANY (ARRAY['active'::text, 'discontinued'::text, 'proposed'::text]))),
    CONSTRAINT visa_types_official_code_check CHECK ((char_length(official_code) <= 64)),
    CONSTRAINT visa_types_official_name_check CHECK (((char_length(official_name) >= 1) AND (char_length(official_name) <= 250))),
    CONSTRAINT visa_types_official_stream_check CHECK ((char_length(official_stream) <= 120)),
    CONSTRAINT visa_types_program_id_check CHECK ((char_length(program_id) <= 64)),
    CONSTRAINT visa_types_purpose_check CHECK ((char_length(purpose) <= 500)),
    CONSTRAINT visa_types_slug_check CHECK ((slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text)),
    CONSTRAINT visa_types_visaai_id_check CHECK ((visaai_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'::text))
);


--
-- Name: TABLE visa_types; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_types IS 'Per-destination catalog of visa, permit and entry-authorization categories as the issuing authority defines them. official_name/official_code are government wording and must never be paraphrased.';


--
-- Name: visa_publishable_pages; Type: VIEW; Schema: public; Owner: -
--

CREATE VIEW public.visa_publishable_pages WITH (security_invoker='true') AS
 SELECT c.code AS country_code,
    c.slug AS country_slug,
    c.name AS country_name,
    t.id AS visa_type_id,
    t.visaai_id,
    t.slug AS visa_slug,
    t.official_name,
    t.category,
    rq.cnt AS official_requirement_count,
    sc.cnt AS source_count,
    GREATEST(COALESCE(t.last_verified_at, '1970-01-01 00:00:00+00'::timestamp with time zone), COALESCE(c.last_verified_at, '1970-01-01 00:00:00+00'::timestamp with time zone)) AS last_verified_at
   FROM (((public.visa_countries c
     JOIN public.visa_types t ON ((t.country_id = c.id)))
     JOIN LATERAL ( SELECT count(*) AS cnt
           FROM public.visa_requirements r
          WHERE ((r.visa_type_id = t.id) AND (r.status = 'active'::text) AND r.officially_required)) rq ON (true))
     JOIN LATERAL ( SELECT count(*) AS cnt
           FROM public.visa_sources s
          WHERE ((s.visa_type_id = t.id) AND s.active)) sc ON (true))
  WHERE ((c.support_state = 'supported'::text) AND (t.lifecycle_state = 'active'::text) AND (rq.cnt > 0) AND (sc.cnt > 0));


--
-- Name: VIEW visa_publishable_pages; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON VIEW public.visa_publishable_pages IS 'Visa types that may be published: supported country, active lifecycle, at least one active official requirement and one active source. Counts come from lateral subqueries -- see the migration header before rewriting this as a join, it was 5x slower that way and it is the hottest read in prod.';


--
-- Name: visa_requirement_bootstrap_skips; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_requirement_bootstrap_skips (
    visa_type_id uuid NOT NULL,
    requirement_code text NOT NULL,
    source_hint text,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE visa_requirement_bootstrap_skips; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_requirement_bootstrap_skips IS 'Requirements a replay could not plant because their source has never been fetched successfully (authority blocks our egress). Empty in production, where those migrations failed outright instead. Read it to see which routes are silent because of a fetch failure rather than because they have no rules.';


--
-- Name: visa_source_changes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_source_changes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    from_version_id uuid,
    to_version_id uuid NOT NULL,
    run_id uuid,
    state text DEFAULT 'detected'::text NOT NULL,
    classification text DEFAULT 'cosmetic'::text NOT NULL,
    escalation_reasons text[] DEFAULT '{}'::text[] NOT NULL,
    requires_review boolean DEFAULT true NOT NULL,
    summary text,
    diff jsonb,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visa_source_changes_active_was_reviewed CHECK (((state <> 'active'::text) OR (requires_review = false) OR (reviewed_at IS NOT NULL))),
    CONSTRAINT visa_source_changes_classification_check CHECK ((classification = ANY (ARRAY['cosmetic'::text, 'editorial'::text, 'material'::text, 'structural'::text]))),
    CONSTRAINT visa_source_changes_review_note_check CHECK ((char_length(review_note) <= 2000)),
    CONSTRAINT visa_source_changes_state_check CHECK ((state = ANY (ARRAY['detected'::text, 'parsed'::text, 'validated'::text, 'tested'::text, 'approved'::text, 'active'::text, 'rejected'::text, 'failed'::text]))),
    CONSTRAINT visa_source_changes_summary_check CHECK ((char_length(summary) <= 4000))
);


--
-- Name: TABLE visa_source_changes; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_source_changes IS 'Promotion queue for detected government changes. detected -> parsed -> validated -> tested -> approved -> active. Material changes always require human review before they reach a user. ADMIN-READ ONLY: carries reviewer identities and internal review notes.';


--
-- Name: visa_source_checks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_source_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    run_id uuid NOT NULL,
    checked_at timestamp with time zone DEFAULT now() NOT NULL,
    status text NOT NULL,
    http_status integer,
    duration_ms integer,
    redirect_url text,
    version_id uuid,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visa_source_checks_duration_ms_check CHECK (((duration_ms IS NULL) OR (duration_ms >= 0))),
    CONSTRAINT visa_source_checks_error_message_check CHECK ((char_length(error_message) <= 2000)),
    CONSTRAINT visa_source_checks_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'changed'::text, 'unavailable'::text, 'blocked'::text, 'parse_error'::text, 'redirected'::text, 'client_rendered'::text])))
);


--
-- Name: TABLE visa_source_checks; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_source_checks IS 'Per-run outcome for every source check. Powers sync metrics, freshness SLAs and persistent-failure alerts.';


--
-- Name: COLUMN visa_source_checks.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visa_source_checks.status IS 'ok | changed | unavailable | blocked | parse_error | redirected | client_rendered. parse_error means WE could not read a page that has text; client_rendered means the page has no server-rendered text to read. Keeping them apart is what stops a permanently-red signal from burying the fixable failures.';


--
-- Name: visa_source_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_source_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_id uuid NOT NULL,
    version_number integer NOT NULL,
    raw_sha256 text NOT NULL,
    normalized_sha256 text NOT NULL,
    http_status integer,
    content_type text,
    byte_size integer,
    storage_path text,
    published_at date,
    effective_from date,
    extractor_version text DEFAULT 'v1'::text NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    superseded_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    normalized_text text,
    blob_sha256 text,
    CONSTRAINT visa_source_versions_byte_size_check CHECK (((byte_size IS NULL) OR (byte_size >= 0))),
    CONSTRAINT visa_source_versions_content_type_check CHECK ((char_length(content_type) <= 128)),
    CONSTRAINT visa_source_versions_extractor_version_check CHECK ((char_length(extractor_version) <= 32)),
    CONSTRAINT visa_source_versions_normalized_sha256_check CHECK ((char_length(normalized_sha256) = 64)),
    CONSTRAINT visa_source_versions_raw_sha256_check CHECK ((char_length(raw_sha256) = 64)),
    CONSTRAINT visa_source_versions_version_number_check CHECK ((version_number > 0))
);


--
-- Name: TABLE visa_source_versions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_source_versions IS 'Immutable snapshots of an official page. Never updated in place and never deleted: history is what makes a change detectable and a requirement defensible. normalized_sha256 is the only hash a change event may key on.';


--
-- Name: COLUMN visa_source_versions.normalized_text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visa_source_versions.normalized_text IS 'Normalized page text as of this version, retained so the NEXT version can be diffed against it. Null on versions filed before 2026-08-24, which is why a change against one of those must report that it cannot be characterised rather than treating the whole page as new.';


--
-- Name: visa_sync_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.visa_sync_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    finished_at timestamp with time zone,
    trigger text DEFAULT 'schedule'::text NOT NULL,
    sources_checked integer DEFAULT 0 NOT NULL,
    ok_count integer DEFAULT 0 NOT NULL,
    changed_count integer DEFAULT 0 NOT NULL,
    unavailable_count integer DEFAULT 0 NOT NULL,
    blocked_count integer DEFAULT 0 NOT NULL,
    parse_error_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'running'::text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    client_rendered_count integer DEFAULT 0 NOT NULL,
    CONSTRAINT visa_sync_runs_error_message_check CHECK ((char_length(error_message) <= 2000)),
    CONSTRAINT visa_sync_runs_status_check CHECK ((status = ANY (ARRAY['running'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT visa_sync_runs_trigger_check CHECK ((trigger = ANY (ARRAY['schedule'::text, 'manual'::text, 'backfill'::text])))
);


--
-- Name: TABLE visa_sync_runs; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.visa_sync_runs IS 'One row per morning synchronization run. The numerator/denominator behind every sync metric and the operational report.';


--
-- Name: COLUMN visa_sync_runs.client_rendered_count; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.visa_sync_runs.client_rendered_count IS 'Sources that returned 200 with no server-rendered text. Separate from parse_error_count: that one means our parser failed on a page that HAS text, this one means the page has none to read.';


--
-- Name: voice_consents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_consents (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    kind text NOT NULL,
    granted boolean NOT NULL,
    policy_version text NOT NULL,
    granted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voice_consents_kind_check CHECK ((kind = ANY (ARRAY['microphone'::text, 'transcription'::text, 'transcript_retention'::text, 'transcript_sharing'::text])))
);


--
-- Name: voice_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_messages (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    message_id uuid NOT NULL,
    conversation_id uuid NOT NULL,
    storage_path text NOT NULL,
    mime_type text NOT NULL,
    duration_ms integer DEFAULT 0 NOT NULL,
    size_bytes bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: voice_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_sessions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    user_id uuid NOT NULL,
    application_id uuid,
    status text DEFAULT 'active'::text NOT NULL,
    language text DEFAULT 'en'::text NOT NULL,
    audio_ms integer DEFAULT 0 NOT NULL,
    tokens_used integer DEFAULT 0 NOT NULL,
    cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    turn_count integer DEFAULT 0 NOT NULL,
    end_reason text,
    escalated_to_consultation_id uuid,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now() NOT NULL,
    ended_at timestamp with time zone,
    CONSTRAINT voice_sessions_audio_ms_check CHECK ((audio_ms >= 0)),
    CONSTRAINT voice_sessions_cost_usd_check CHECK ((cost_usd >= (0)::numeric)),
    CONSTRAINT voice_sessions_status_check CHECK ((status = ANY (ARRAY['active'::text, 'paused'::text, 'ended'::text, 'expired'::text, 'failed'::text]))),
    CONSTRAINT voice_sessions_tokens_used_check CHECK ((tokens_used >= 0)),
    CONSTRAINT voice_sessions_turn_count_check CHECK ((turn_count >= 0))
);


--
-- Name: TABLE voice_sessions; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.voice_sessions IS 'Voice assistant sessions. Raw audio is never stored; only derived text.';


--
-- Name: voice_transcript_turns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.voice_transcript_turns (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    session_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role text NOT NULL,
    text text NOT NULL,
    redacted_text text,
    language text,
    confidence numeric(4,3),
    safety_flags text[] DEFAULT '{}'::text[] NOT NULL,
    audio_ms integer,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voice_transcript_turns_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text, 'system'::text])))
);


--
-- Name: COLUMN voice_transcript_turns.redacted_text; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.voice_transcript_turns.redacted_text IS 'PII-redacted copy for logs/analytics/audit. `text` keeps content the model needs.';


--
-- Name: vri_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vri_recommendations (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    vri_score_id uuid NOT NULL,
    factor text NOT NULL,
    issue text NOT NULL,
    recommendation_text text NOT NULL,
    priority integer DEFAULT 0 NOT NULL
);


--
-- Name: vri_visa_suggestions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.vri_visa_suggestions (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    vri_score_id uuid NOT NULL,
    country_code text NOT NULL,
    visa_category text NOT NULL,
    approval_likelihood integer NOT NULL,
    reasoning text NOT NULL,
    required_documents jsonb DEFAULT '[]'::jsonb NOT NULL,
    official_source text,
    rank integer DEFAULT 0 NOT NULL,
    required_forms jsonb DEFAULT '[]'::jsonb NOT NULL,
    CONSTRAINT vri_visa_suggestions_approval_likelihood_check CHECK (((approval_likelihood >= 0) AND (approval_likelihood <= 100)))
);


--
-- Name: analytics_event_stream_202607; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream ATTACH PARTITION public.analytics_event_stream_202607 FOR VALUES FROM ('2026-07-01 00:00:00+00') TO ('2026-08-01 00:00:00+00');


--
-- Name: analytics_event_stream_202608; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream ATTACH PARTITION public.analytics_event_stream_202608 FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');


--
-- Name: analytics_event_stream_202609; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream ATTACH PARTITION public.analytics_event_stream_202609 FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');


--
-- Name: analytics_event_stream_202610; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream ATTACH PARTITION public.analytics_event_stream_202610 FOR VALUES FROM ('2026-10-01 00:00:00+00') TO ('2026-11-01 00:00:00+00');


--
-- Name: analytics_event_stream_202611; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream ATTACH PARTITION public.analytics_event_stream_202611 FOR VALUES FROM ('2026-11-01 00:00:00+00') TO ('2026-12-01 00:00:00+00');


--
-- Name: analytics_event_stream_202612; Type: TABLE ATTACH; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream ATTACH PARTITION public.analytics_event_stream_202612 FOR VALUES FROM ('2026-12-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');


--
-- Name: partner_events sequence; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_events ALTER COLUMN sequence SET DEFAULT nextval('public.partner_events_sequence_seq'::regclass);


--
-- Name: account_lockouts account_lockouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.account_lockouts
    ADD CONSTRAINT account_lockouts_pkey PRIMARY KEY (email, ip);


--
-- Name: action_items action_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_items
    ADD CONSTRAINT action_items_pkey PRIMARY KEY (id);


--
-- Name: addon_purchases addon_purchases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addon_purchases
    ADD CONSTRAINT addon_purchases_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_events ai_usage_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_events
    ADD CONSTRAINT ai_usage_events_pkey PRIMARY KEY (id);


--
-- Name: analytics_alert_event analytics_alert_event_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_alert_event
    ADD CONSTRAINT analytics_alert_event_pkey PRIMARY KEY (id);


--
-- Name: analytics_alert_rule analytics_alert_rule_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_alert_rule
    ADD CONSTRAINT analytics_alert_rule_pkey PRIMARY KEY (id);


--
-- Name: analytics_daily_active analytics_daily_active_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_daily_active
    ADD CONSTRAINT analytics_daily_active_pkey PRIMARY KEY (day);


--
-- Name: analytics_event_daily analytics_event_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_daily
    ADD CONSTRAINT analytics_event_daily_pkey PRIMARY KEY (day, name);


--
-- Name: analytics_event_stream analytics_event_stream_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream
    ADD CONSTRAINT analytics_event_stream_pkey PRIMARY KEY (event_id, occurred_at);


--
-- Name: analytics_event_stream_202607 analytics_event_stream_202607_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream_202607
    ADD CONSTRAINT analytics_event_stream_202607_pkey PRIMARY KEY (event_id, occurred_at);


--
-- Name: analytics_event_stream_202608 analytics_event_stream_202608_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream_202608
    ADD CONSTRAINT analytics_event_stream_202608_pkey PRIMARY KEY (event_id, occurred_at);


--
-- Name: analytics_event_stream_202609 analytics_event_stream_202609_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream_202609
    ADD CONSTRAINT analytics_event_stream_202609_pkey PRIMARY KEY (event_id, occurred_at);


--
-- Name: analytics_event_stream_202610 analytics_event_stream_202610_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream_202610
    ADD CONSTRAINT analytics_event_stream_202610_pkey PRIMARY KEY (event_id, occurred_at);


--
-- Name: analytics_event_stream_202611 analytics_event_stream_202611_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream_202611
    ADD CONSTRAINT analytics_event_stream_202611_pkey PRIMARY KEY (event_id, occurred_at);


--
-- Name: analytics_event_stream_202612 analytics_event_stream_202612_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_event_stream_202612
    ADD CONSTRAINT analytics_event_stream_202612_pkey PRIMARY KEY (event_id, occurred_at);


--
-- Name: analytics_events analytics_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_pkey PRIMARY KEY (id);


--
-- Name: analytics_identity_map analytics_identity_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_identity_map
    ADD CONSTRAINT analytics_identity_map_pkey PRIMARY KEY (anonymous_id);


--
-- Name: analytics_report_run analytics_report_run_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_report_run
    ADD CONSTRAINT analytics_report_run_pkey PRIMARY KEY (id);


--
-- Name: analytics_saved_report analytics_saved_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_saved_report
    ADD CONSTRAINT analytics_saved_report_pkey PRIMARY KEY (id);


--
-- Name: analytics_scheduled_report analytics_scheduled_report_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_scheduled_report
    ADD CONSTRAINT analytics_scheduled_report_pkey PRIMARY KEY (id);


--
-- Name: application_item_reviews application_item_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_item_reviews
    ADD CONSTRAINT application_item_reviews_pkey PRIMARY KEY (id);


--
-- Name: application_outcomes application_outcomes_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_outcomes
    ADD CONSTRAINT application_outcomes_application_id_key UNIQUE (application_id);


--
-- Name: application_outcomes application_outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_outcomes
    ADD CONSTRAINT application_outcomes_pkey PRIMARY KEY (id);


--
-- Name: application_profiles application_profiles_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_profiles
    ADD CONSTRAINT application_profiles_application_id_key UNIQUE (application_id);


--
-- Name: application_profiles application_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_profiles
    ADD CONSTRAINT application_profiles_pkey PRIMARY KEY (id);


--
-- Name: applications applications_monitor_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_monitor_token_key UNIQUE (monitor_token);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: audit_chain_state audit_chain_state_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_state
    ADD CONSTRAINT audit_chain_state_pkey PRIMARY KEY (application_id);


--
-- Name: audit_events audit_events_application_id_row_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_application_id_row_hash_key UNIQUE (application_id, row_hash);


--
-- Name: audit_events audit_events_application_id_seq_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_application_id_seq_key UNIQUE (application_id, seq);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (id);


--
-- Name: auth_audit_log auth_audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_log
    ADD CONSTRAINT auth_audit_log_pkey PRIMARY KEY (id);


--
-- Name: beta_cohort_members beta_cohort_members_cohort_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_cohort_members
    ADD CONSTRAINT beta_cohort_members_cohort_id_user_id_key UNIQUE (cohort_id, user_id);


--
-- Name: beta_cohort_members beta_cohort_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_cohort_members
    ADD CONSTRAINT beta_cohort_members_pkey PRIMARY KEY (id);


--
-- Name: beta_cohorts beta_cohorts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_cohorts
    ADD CONSTRAINT beta_cohorts_pkey PRIMARY KEY (id);


--
-- Name: beta_cohorts beta_cohorts_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_cohorts
    ADD CONSTRAINT beta_cohorts_slug_key UNIQUE (slug);


--
-- Name: beta_feedback beta_feedback_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_pkey PRIMARY KEY (id);


--
-- Name: checklist_items checklist_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_pkey PRIMARY KEY (id);


--
-- Name: consultant_approvals consultant_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_approvals
    ADD CONSTRAINT consultant_approvals_pkey PRIMARY KEY (id);


--
-- Name: consultant_assignments consultant_assignments_application_id_consultant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_assignments
    ADD CONSTRAINT consultant_assignments_application_id_consultant_id_key UNIQUE (application_id, consultant_id);


--
-- Name: consultant_assignments consultant_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_assignments
    ADD CONSTRAINT consultant_assignments_pkey PRIMARY KEY (id);


--
-- Name: consultant_availability consultant_availability_consultant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_availability
    ADD CONSTRAINT consultant_availability_consultant_id_key UNIQUE (consultant_id);


--
-- Name: consultant_availability consultant_availability_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_availability
    ADD CONSTRAINT consultant_availability_pkey PRIMARY KEY (id);


--
-- Name: consultant_commission_rules consultant_commission_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_commission_rules
    ADD CONSTRAINT consultant_commission_rules_pkey PRIMARY KEY (id);


--
-- Name: consultant_countries consultant_countries_consultant_id_country_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_countries
    ADD CONSTRAINT consultant_countries_consultant_id_country_code_key UNIQUE (consultant_id, country_code);


--
-- Name: consultant_countries consultant_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_countries
    ADD CONSTRAINT consultant_countries_pkey PRIMARY KEY (id);


--
-- Name: consultant_notes consultant_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_notes
    ADD CONSTRAINT consultant_notes_pkey PRIMARY KEY (id);


--
-- Name: consultant_payout_items consultant_payout_items_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_payout_items
    ADD CONSTRAINT consultant_payout_items_pkey PRIMARY KEY (id);


--
-- Name: consultant_payout_items consultant_payout_items_service_order_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_payout_items
    ADD CONSTRAINT consultant_payout_items_service_order_id_key UNIQUE (service_order_id);


--
-- Name: consultant_payouts consultant_payouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_payouts
    ADD CONSTRAINT consultant_payouts_pkey PRIMARY KEY (id);


--
-- Name: consultant_payouts consultant_payouts_stripe_transfer_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_payouts
    ADD CONSTRAINT consultant_payouts_stripe_transfer_id_key UNIQUE (stripe_transfer_id);


--
-- Name: consultant_profiles consultant_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_profiles
    ADD CONSTRAINT consultant_profiles_pkey PRIMARY KEY (id);


--
-- Name: consultant_profiles consultant_profiles_stripe_connect_account_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_profiles
    ADD CONSTRAINT consultant_profiles_stripe_connect_account_id_key UNIQUE (stripe_connect_account_id);


--
-- Name: consultant_profiles consultant_profiles_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_profiles
    ADD CONSTRAINT consultant_profiles_user_id_key UNIQUE (user_id);


--
-- Name: consultant_reviews consultant_reviews_consultant_id_user_id_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_reviews
    ADD CONSTRAINT consultant_reviews_consultant_id_user_id_application_id_key UNIQUE (consultant_id, user_id, application_id);


--
-- Name: consultant_reviews consultant_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_reviews
    ADD CONSTRAINT consultant_reviews_pkey PRIMARY KEY (id);


--
-- Name: consultant_service_orders consultant_service_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_service_orders
    ADD CONSTRAINT consultant_service_orders_pkey PRIMARY KEY (id);


--
-- Name: consultant_service_orders consultant_service_orders_stripe_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_service_orders
    ADD CONSTRAINT consultant_service_orders_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);


--
-- Name: consultant_skills consultant_skills_consultant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_skills
    ADD CONSTRAINT consultant_skills_consultant_id_key UNIQUE (consultant_id);


--
-- Name: consultant_skills consultant_skills_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_skills
    ADD CONSTRAINT consultant_skills_pkey PRIMARY KEY (id);


--
-- Name: consultant_tax_profiles consultant_tax_profiles_consultant_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_tax_profiles
    ADD CONSTRAINT consultant_tax_profiles_consultant_id_key UNIQUE (consultant_id);


--
-- Name: consultant_tax_profiles consultant_tax_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_tax_profiles
    ADD CONSTRAINT consultant_tax_profiles_pkey PRIMARY KEY (id);


--
-- Name: consultations consultations_no_overlap; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_no_overlap EXCLUDE USING gist (consultant_id WITH =, tstzrange(scheduled_start, scheduled_end) WITH &&) WHERE ((status = ANY (ARRAY['requested'::text, 'confirmed'::text])));


--
-- Name: consultations consultations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_pkey PRIMARY KEY (id);


--
-- Name: consumed_readback_tokens consumed_readback_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumed_readback_tokens
    ADD CONSTRAINT consumed_readback_tokens_pkey PRIMARY KEY (token_hash);


--
-- Name: conversation_participants conversation_participants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_pkey PRIMARY KEY (conversation_id, user_id);


--
-- Name: conversations conversations_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_application_id_key UNIQUE (application_id);


--
-- Name: conversations conversations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_pkey PRIMARY KEY (id);


--
-- Name: country_frameworks country_frameworks_country_code_visa_type_purpose_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_frameworks
    ADD CONSTRAINT country_frameworks_country_code_visa_type_purpose_key UNIQUE (country_code, visa_type, purpose);


--
-- Name: country_frameworks country_frameworks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.country_frameworks
    ADD CONSTRAINT country_frameworks_pkey PRIMARY KEY (id);


--
-- Name: coupons coupons_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_code_key UNIQUE (code);


--
-- Name: coupons coupons_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.coupons
    ADD CONSTRAINT coupons_pkey PRIMARY KEY (id);


--
-- Name: cross_verifications cross_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_verifications
    ADD CONSTRAINT cross_verifications_pkey PRIMARY KEY (id);


--
-- Name: cross_verifications cross_verifications_unique_pair_field; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_verifications
    ADD CONSTRAINT cross_verifications_unique_pair_field UNIQUE (application_id, doc_a_id, doc_b_id, field_compared);


--
-- Name: device_push_tokens device_push_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_pkey PRIMARY KEY (id);


--
-- Name: device_push_tokens device_push_tokens_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_token_key UNIQUE (token);


--
-- Name: discount_redemptions discount_redemptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_redemptions
    ADD CONSTRAINT discount_redemptions_pkey PRIMARY KEY (id);


--
-- Name: document_access_logs document_access_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_logs
    ADD CONSTRAINT document_access_logs_pkey PRIMARY KEY (id);


--
-- Name: document_holder_confirmations document_holder_confirmations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_holder_confirmations
    ADD CONSTRAINT document_holder_confirmations_pkey PRIMARY KEY (id);


--
-- Name: document_requests document_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_pkey PRIMARY KEY (id);


--
-- Name: document_templates document_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_templates
    ADD CONSTRAINT document_templates_pkey PRIMARY KEY (id);


--
-- Name: document_translations document_translations_document_id_target_lang_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_translations
    ADD CONSTRAINT document_translations_document_id_target_lang_key UNIQUE (document_id, target_lang);


--
-- Name: document_translations document_translations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_translations
    ADD CONSTRAINT document_translations_pkey PRIMARY KEY (id);


--
-- Name: document_verifications document_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verifications
    ADD CONSTRAINT document_verifications_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: escalation_history escalation_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_history
    ADD CONSTRAINT escalation_history_pkey PRIMARY KEY (id);


--
-- Name: escalation_thresholds escalation_thresholds_key_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_thresholds
    ADD CONSTRAINT escalation_thresholds_key_effective_from_key UNIQUE (key, effective_from);


--
-- Name: escalation_thresholds escalation_thresholds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_thresholds
    ADD CONSTRAINT escalation_thresholds_pkey PRIMARY KEY (id);


--
-- Name: evidence_packages evidence_packages_application_id_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_application_id_version_key UNIQUE (application_id, version);


--
-- Name: evidence_packages evidence_packages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_pkey PRIMARY KEY (id);


--
-- Name: feature_flag_audit feature_flag_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flag_audit
    ADD CONSTRAINT feature_flag_audit_pkey PRIMARY KEY (id);


--
-- Name: feature_flags feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_pkey PRIMARY KEY (key);


--
-- Name: field_provenance field_provenance_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_provenance
    ADD CONSTRAINT field_provenance_pkey PRIMARY KEY (id);


--
-- Name: field_verifications field_verifications_application_id_field_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_verifications
    ADD CONSTRAINT field_verifications_application_id_field_key_key UNIQUE (application_id, field_key);


--
-- Name: field_verifications field_verifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_verifications
    ADD CONSTRAINT field_verifications_pkey PRIMARY KEY (id);


--
-- Name: form_template_versions form_template_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_template_versions
    ADD CONSTRAINT form_template_versions_pkey PRIMARY KEY (id);


--
-- Name: form_template_versions form_template_versions_seq_uniq; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_template_versions
    ADD CONSTRAINT form_template_versions_seq_uniq UNIQUE (form_template_id, version_number);


--
-- Name: form_templates form_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_templates
    ADD CONSTRAINT form_templates_pkey PRIMARY KEY (id);


--
-- Name: generated_document_revisions generated_document_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_revisions
    ADD CONSTRAINT generated_document_revisions_pkey PRIMARY KEY (id);


--
-- Name: generated_documents generated_documents_application_doc_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_documents
    ADD CONSTRAINT generated_documents_application_doc_type_key UNIQUE (application_id, doc_type);


--
-- Name: generated_documents generated_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_documents
    ADD CONSTRAINT generated_documents_pkey PRIMARY KEY (id);


--
-- Name: intake_messages intake_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intake_messages
    ADD CONSTRAINT intake_messages_pkey PRIMARY KEY (id);


--
-- Name: kb_answer_citations kb_answer_citations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_answer_citations
    ADD CONSTRAINT kb_answer_citations_pkey PRIMARY KEY (id);


--
-- Name: kb_blobs kb_blobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_blobs
    ADD CONSTRAINT kb_blobs_pkey PRIMARY KEY (sha256);


--
-- Name: kb_chunk_scopes kb_chunk_scopes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunk_scopes
    ADD CONSTRAINT kb_chunk_scopes_pkey PRIMARY KEY (id);


--
-- Name: kb_chunk_texts kb_chunk_texts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunk_texts
    ADD CONSTRAINT kb_chunk_texts_pkey PRIMARY KEY (sha256);


--
-- Name: kb_chunks kb_chunks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_pkey PRIMARY KEY (id);


--
-- Name: kb_embeddings kb_embeddings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_embeddings
    ADD CONSTRAINT kb_embeddings_pkey PRIMARY KEY (text_sha256, model);


--
-- Name: kb_extractions kb_extractions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_extractions
    ADD CONSTRAINT kb_extractions_pkey PRIMARY KEY (id);


--
-- Name: kb_freshness_policies kb_freshness_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_freshness_policies
    ADD CONSTRAINT kb_freshness_policies_pkey PRIMARY KEY (id);


--
-- Name: kb_ingestion_jobs kb_ingestion_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_ingestion_jobs
    ADD CONSTRAINT kb_ingestion_jobs_pkey PRIMARY KEY (id);


--
-- Name: kb_quarantine kb_quarantine_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_quarantine
    ADD CONSTRAINT kb_quarantine_pkey PRIMARY KEY (id);


--
-- Name: kb_retrieval_logs kb_retrieval_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_retrieval_logs
    ADD CONSTRAINT kb_retrieval_logs_pkey PRIMARY KEY (id);


--
-- Name: kb_review_queue kb_review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_review_queue
    ADD CONSTRAINT kb_review_queue_pkey PRIMARY KEY (id);


--
-- Name: kb_sections kb_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_sections
    ADD CONSTRAINT kb_sections_pkey PRIMARY KEY (id);


--
-- Name: kpi_funnel_daily kpi_funnel_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_funnel_daily
    ADD CONSTRAINT kpi_funnel_daily_pkey PRIMARY KEY (day, funnel, step, dim_key, dim_val);


--
-- Name: kpi_metric_daily kpi_metric_daily_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_metric_daily
    ADD CONSTRAINT kpi_metric_daily_pkey PRIMARY KEY (day, metric, dim_key, dim_val);


--
-- Name: kpi_retention_cohort kpi_retention_cohort_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kpi_retention_cohort
    ADD CONSTRAINT kpi_retention_cohort_pkey PRIMARY KEY (cohort_month, period_index, dim_key, dim_val);


--
-- Name: login_history login_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_pkey PRIMARY KEY (id);


--
-- Name: marketing_attribution marketing_attribution_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution
    ADD CONSTRAINT marketing_attribution_pkey PRIMARY KEY (user_id);


--
-- Name: message_attachments message_attachments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_pkey PRIMARY KEY (id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);


--
-- Name: notification_broadcasts notification_broadcasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_broadcasts
    ADD CONSTRAINT notification_broadcasts_pkey PRIMARY KEY (id);


--
-- Name: notification_deliveries notification_deliveries_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: notification_deliveries notification_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_pkey PRIMARY KEY (id);


--
-- Name: notification_outbox notification_outbox_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_outbox
    ADD CONSTRAINT notification_outbox_pkey PRIMARY KEY (id);


--
-- Name: notification_preferences notification_preferences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_pkey PRIMARY KEY (user_id);


--
-- Name: notification_templates notification_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_pkey PRIMARY KEY (id);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: ocr_runs ocr_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_runs
    ADD CONSTRAINT ocr_runs_pkey PRIMARY KEY (id);


--
-- Name: ops_agent_runs ops_agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_agent_runs
    ADD CONSTRAINT ops_agent_runs_pkey PRIMARY KEY (id);


--
-- Name: ops_experiments ops_experiments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_experiments
    ADD CONSTRAINT ops_experiments_pkey PRIMARY KEY (id);


--
-- Name: ops_marketing_events ops_marketing_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_marketing_events
    ADD CONSTRAINT ops_marketing_events_pkey PRIMARY KEY (id);


--
-- Name: ops_products ops_products_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_products
    ADD CONSTRAINT ops_products_pkey PRIMARY KEY (id);


--
-- Name: ops_products ops_products_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_products
    ADD CONSTRAINT ops_products_slug_key UNIQUE (slug);


--
-- Name: ops_revenue ops_revenue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_revenue
    ADD CONSTRAINT ops_revenue_pkey PRIMARY KEY (id);


--
-- Name: organization_invitations organization_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_pkey PRIMARY KEY (id);


--
-- Name: organization_invitations organization_invitations_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_token_key UNIQUE (token);


--
-- Name: organization_members organization_members_organization_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_user_id_key UNIQUE (organization_id, user_id);


--
-- Name: organization_members organization_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_slug_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_slug_key UNIQUE (slug);


--
-- Name: partner_access_tokens partner_access_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_access_tokens
    ADD CONSTRAINT partner_access_tokens_pkey PRIMARY KEY (id);


--
-- Name: partner_access_tokens partner_access_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_access_tokens
    ADD CONSTRAINT partner_access_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: partner_api_keys partner_api_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_api_keys
    ADD CONSTRAINT partner_api_keys_pkey PRIMARY KEY (id);


--
-- Name: partner_api_keys partner_api_keys_prefix_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_api_keys
    ADD CONSTRAINT partner_api_keys_prefix_key UNIQUE (prefix);


--
-- Name: partner_api_requests partner_api_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_api_requests
    ADD CONSTRAINT partner_api_requests_pkey PRIMARY KEY (id);


--
-- Name: partner_applications partner_applications_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_applications
    ADD CONSTRAINT partner_applications_client_id_key UNIQUE (client_id);


--
-- Name: partner_applications partner_applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_applications
    ADD CONSTRAINT partner_applications_pkey PRIMARY KEY (id);


--
-- Name: partner_authorization_codes partner_authorization_codes_code_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_authorization_codes
    ADD CONSTRAINT partner_authorization_codes_code_hash_key UNIQUE (code_hash);


--
-- Name: partner_authorization_codes partner_authorization_codes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_authorization_codes
    ADD CONSTRAINT partner_authorization_codes_pkey PRIMARY KEY (id);


--
-- Name: partner_events partner_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_events
    ADD CONSTRAINT partner_events_pkey PRIMARY KEY (id);


--
-- Name: partner_idempotency_keys partner_idempotency_keys_application_id_idempotency_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_idempotency_keys
    ADD CONSTRAINT partner_idempotency_keys_application_id_idempotency_key_key UNIQUE (application_id, idempotency_key);


--
-- Name: partner_idempotency_keys partner_idempotency_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_idempotency_keys
    ADD CONSTRAINT partner_idempotency_keys_pkey PRIMARY KEY (id);


--
-- Name: partner_sandbox_resources partner_sandbox_resources_application_id_resource_type_reso_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_sandbox_resources
    ADD CONSTRAINT partner_sandbox_resources_application_id_resource_type_reso_key UNIQUE (application_id, resource_type, resource_key);


--
-- Name: partner_sandbox_resources partner_sandbox_resources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_sandbox_resources
    ADD CONSTRAINT partner_sandbox_resources_pkey PRIMARY KEY (id);


--
-- Name: partner_usage_counters partner_usage_counters_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_usage_counters
    ADD CONSTRAINT partner_usage_counters_pkey PRIMARY KEY (application_id, window_kind, window_start);


--
-- Name: partner_user_consents partner_user_consents_application_id_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_user_consents
    ADD CONSTRAINT partner_user_consents_application_id_user_id_key UNIQUE (application_id, user_id);


--
-- Name: partner_user_consents partner_user_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_user_consents
    ADD CONSTRAINT partner_user_consents_pkey PRIMARY KEY (id);


--
-- Name: partner_webhook_deliveries partner_webhook_deliveries_endpoint_id_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_deliveries
    ADD CONSTRAINT partner_webhook_deliveries_endpoint_id_event_id_key UNIQUE (endpoint_id, event_id);


--
-- Name: partner_webhook_deliveries partner_webhook_deliveries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_deliveries
    ADD CONSTRAINT partner_webhook_deliveries_pkey PRIMARY KEY (id);


--
-- Name: partner_webhook_endpoints partner_webhook_endpoints_application_id_url_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_endpoints
    ADD CONSTRAINT partner_webhook_endpoints_application_id_url_key UNIQUE (application_id, url);


--
-- Name: partner_webhook_endpoints partner_webhook_endpoints_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_endpoints
    ADD CONSTRAINT partner_webhook_endpoints_pkey PRIMARY KEY (id);


--
-- Name: partners partners_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_organization_id_key UNIQUE (organization_id);


--
-- Name: partners partners_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_pkey PRIMARY KEY (id);


--
-- Name: payment_disputes payment_disputes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_disputes
    ADD CONSTRAINT payment_disputes_pkey PRIMARY KEY (id);


--
-- Name: payment_disputes payment_disputes_stripe_dispute_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_disputes
    ADD CONSTRAINT payment_disputes_stripe_dispute_id_key UNIQUE (stripe_dispute_id);


--
-- Name: payment_dunning payment_dunning_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_dunning
    ADD CONSTRAINT payment_dunning_pkey PRIMARY KEY (id);


--
-- Name: payment_dunning payment_dunning_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_dunning
    ADD CONSTRAINT payment_dunning_subscription_id_key UNIQUE (subscription_id);


--
-- Name: payment_event_processing payment_event_processing_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_event_processing
    ADD CONSTRAINT payment_event_processing_pkey PRIMARY KEY (provider_event_id);


--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- Name: payment_events payment_events_provider_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_provider_event_id_key UNIQUE (provider_event_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: payments payments_stripe_payment_intent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);


--
-- Name: payout_tax_statements payout_tax_statements_consultant_id_tax_year_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_tax_statements
    ADD CONSTRAINT payout_tax_statements_consultant_id_tax_year_key UNIQUE (consultant_id, tax_year);


--
-- Name: payout_tax_statements payout_tax_statements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_tax_statements
    ADD CONSTRAINT payout_tax_statements_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_key_key UNIQUE (key);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: post_submission_events post_submission_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_submission_events
    ADD CONSTRAINT post_submission_events_pkey PRIMARY KEY (id);


--
-- Name: preflight_reviews preflight_reviews_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preflight_reviews
    ADD CONSTRAINT preflight_reviews_pkey PRIMARY KEY (id);


--
-- Name: pricing_constants pricing_constants_key_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_constants
    ADD CONSTRAINT pricing_constants_key_effective_from_key UNIQUE (key, effective_from);


--
-- Name: pricing_constants pricing_constants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_constants
    ADD CONSTRAINT pricing_constants_pkey PRIMARY KEY (id);


--
-- Name: pricing_country_factors pricing_country_factors_country_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_country_factors
    ADD CONSTRAINT pricing_country_factors_country_code_key UNIQUE (country_code);


--
-- Name: pricing_country_factors pricing_country_factors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_country_factors
    ADD CONSTRAINT pricing_country_factors_pkey PRIMARY KEY (id);


--
-- Name: pricing_quote_audit pricing_quote_audit_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quote_audit
    ADD CONSTRAINT pricing_quote_audit_pkey PRIMARY KEY (id);


--
-- Name: pricing_quotes pricing_quotes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quotes
    ADD CONSTRAINT pricing_quotes_pkey PRIMARY KEY (id);


--
-- Name: pricing_quotes pricing_quotes_visa_type_country_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quotes
    ADD CONSTRAINT pricing_quotes_visa_type_country_code_key UNIQUE (visa_type, country_code);


--
-- Name: pricing_visa_tiers pricing_visa_tiers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_visa_tiers
    ADD CONSTRAINT pricing_visa_tiers_pkey PRIMARY KEY (id);


--
-- Name: pricing_visa_tiers pricing_visa_tiers_visa_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_visa_tiers
    ADD CONSTRAINT pricing_visa_tiers_visa_type_key UNIQUE (visa_type);


--
-- Name: privacy_requests privacy_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_requests
    ADD CONSTRAINT privacy_requests_pkey PRIMARY KEY (id);


--
-- Name: promotions promotions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_pkey PRIMARY KEY (id);


--
-- Name: push_subscriptions push_subscriptions_endpoint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_endpoint_key UNIQUE (endpoint);


--
-- Name: push_subscriptions push_subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_exceptions reconciliation_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_exceptions
    ADD CONSTRAINT reconciliation_exceptions_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_runs reconciliation_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_runs
    ADD CONSTRAINT reconciliation_runs_pkey PRIMARY KEY (id);


--
-- Name: refunds refunds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);


--
-- Name: reminder_log reminder_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_pkey PRIMARY KEY (id);


--
-- Name: risk_weights risk_weights_dimension_effective_from_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_weights
    ADD CONSTRAINT risk_weights_dimension_effective_from_key UNIQUE (dimension, effective_from);


--
-- Name: risk_weights risk_weights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.risk_weights
    ADD CONSTRAINT risk_weights_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_key_key UNIQUE (key);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: submission_sessions submission_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_sessions
    ADD CONSTRAINT submission_sessions_pkey PRIMARY KEY (id);


--
-- Name: subscription_credits subscription_credits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_pkey PRIMARY KEY (id);


--
-- Name: subscription_credits subscription_credits_subscription_id_period_start_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_subscription_id_period_start_key UNIQUE (subscription_id, period_start);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: template_revisions template_revisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_revisions
    ADD CONSTRAINT template_revisions_pkey PRIMARY KEY (id);


--
-- Name: template_sweep_findings template_sweep_findings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.template_sweep_findings
    ADD CONSTRAINT template_sweep_findings_pkey PRIMARY KEY (id);


--
-- Name: user_profiles user_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_pkey PRIMARY KEY (user_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (id);


--
-- Name: user_roles user_roles_user_id_role_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_organization_id_key UNIQUE (user_id, role_id, organization_id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: visa_countries visa_countries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_countries
    ADD CONSTRAINT visa_countries_pkey PRIMARY KEY (id);


--
-- Name: visa_requirement_bootstrap_skips visa_requirement_bootstrap_skips_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_requirement_bootstrap_skips
    ADD CONSTRAINT visa_requirement_bootstrap_skips_pkey PRIMARY KEY (visa_type_id, requirement_code);


--
-- Name: visa_requirements visa_requirements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_requirements
    ADD CONSTRAINT visa_requirements_pkey PRIMARY KEY (id);


--
-- Name: visa_source_changes visa_source_changes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_changes
    ADD CONSTRAINT visa_source_changes_pkey PRIMARY KEY (id);


--
-- Name: visa_source_checks visa_source_checks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_checks
    ADD CONSTRAINT visa_source_checks_pkey PRIMARY KEY (id);


--
-- Name: visa_source_versions visa_source_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_versions
    ADD CONSTRAINT visa_source_versions_pkey PRIMARY KEY (id);


--
-- Name: visa_sources visa_sources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_sources
    ADD CONSTRAINT visa_sources_pkey PRIMARY KEY (id);


--
-- Name: visa_sync_runs visa_sync_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_sync_runs
    ADD CONSTRAINT visa_sync_runs_pkey PRIMARY KEY (id);


--
-- Name: visa_types visa_types_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_types
    ADD CONSTRAINT visa_types_pkey PRIMARY KEY (id);


--
-- Name: voice_consents voice_consents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_consents
    ADD CONSTRAINT voice_consents_pkey PRIMARY KEY (id);


--
-- Name: voice_consents voice_consents_user_id_kind_policy_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_consents
    ADD CONSTRAINT voice_consents_user_id_kind_policy_version_key UNIQUE (user_id, kind, policy_version);


--
-- Name: voice_messages voice_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_messages
    ADD CONSTRAINT voice_messages_pkey PRIMARY KEY (id);


--
-- Name: voice_sessions voice_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_pkey PRIMARY KEY (id);


--
-- Name: voice_transcript_turns voice_transcript_turns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_transcript_turns
    ADD CONSTRAINT voice_transcript_turns_pkey PRIMARY KEY (id);


--
-- Name: vri_recommendations vri_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vri_recommendations
    ADD CONSTRAINT vri_recommendations_pkey PRIMARY KEY (id);


--
-- Name: vri_scores vri_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vri_scores
    ADD CONSTRAINT vri_scores_pkey PRIMARY KEY (id);


--
-- Name: vri_visa_suggestions vri_visa_suggestions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vri_visa_suggestions
    ADD CONSTRAINT vri_visa_suggestions_pkey PRIMARY KEY (id);


--
-- Name: account_lockouts_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX account_lockouts_email_idx ON public.account_lockouts USING btree (email);


--
-- Name: addon_purchases_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX addon_purchases_app_idx ON public.addon_purchases USING btree (application_id, addon_sku, status);


--
-- Name: ai_cost_per_application_pk; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX ai_cost_per_application_pk ON public.ai_cost_per_application USING btree (application_id);


--
-- Name: ai_usage_events_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_events_app_idx ON public.ai_usage_events USING btree (application_id, created_at DESC);


--
-- Name: ai_usage_events_cache_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_events_cache_idx ON public.ai_usage_events USING btree (created_at DESC) WHERE ((cached_input_tokens > 0) OR (cache_write_tokens > 0));


--
-- Name: ai_usage_events_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_events_created_idx ON public.ai_usage_events USING btree (created_at DESC);


--
-- Name: ai_usage_events_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_events_user_idx ON public.ai_usage_events USING btree (user_id, created_at DESC);


--
-- Name: analytics_alert_rule_enabled_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_alert_rule_enabled_idx ON public.analytics_alert_rule USING btree (enabled);


--
-- Name: analytics_event_stream_app_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_app_time_idx ON ONLY public.analytics_event_stream USING btree (application_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202607_application_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202607_application_id_occurred_at_idx ON public.analytics_event_stream_202607 USING btree (application_id, occurred_at DESC);


--
-- Name: analytics_event_stream_name_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_name_time_idx ON ONLY public.analytics_event_stream USING btree (name, occurred_at DESC);


--
-- Name: analytics_event_stream_202607_name_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202607_name_occurred_at_idx ON public.analytics_event_stream_202607 USING btree (name, occurred_at DESC);


--
-- Name: analytics_event_stream_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_user_time_idx ON ONLY public.analytics_event_stream USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202607_user_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202607_user_id_occurred_at_idx ON public.analytics_event_stream_202607 USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202608_application_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202608_application_id_occurred_at_idx ON public.analytics_event_stream_202608 USING btree (application_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202608_name_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202608_name_occurred_at_idx ON public.analytics_event_stream_202608 USING btree (name, occurred_at DESC);


--
-- Name: analytics_event_stream_202608_user_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202608_user_id_occurred_at_idx ON public.analytics_event_stream_202608 USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202609_application_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202609_application_id_occurred_at_idx ON public.analytics_event_stream_202609 USING btree (application_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202609_name_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202609_name_occurred_at_idx ON public.analytics_event_stream_202609 USING btree (name, occurred_at DESC);


--
-- Name: analytics_event_stream_202609_user_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202609_user_id_occurred_at_idx ON public.analytics_event_stream_202609 USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202610_application_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202610_application_id_occurred_at_idx ON public.analytics_event_stream_202610 USING btree (application_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202610_name_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202610_name_occurred_at_idx ON public.analytics_event_stream_202610 USING btree (name, occurred_at DESC);


--
-- Name: analytics_event_stream_202610_user_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202610_user_id_occurred_at_idx ON public.analytics_event_stream_202610 USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202611_application_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202611_application_id_occurred_at_idx ON public.analytics_event_stream_202611 USING btree (application_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202611_name_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202611_name_occurred_at_idx ON public.analytics_event_stream_202611 USING btree (name, occurred_at DESC);


--
-- Name: analytics_event_stream_202611_user_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202611_user_id_occurred_at_idx ON public.analytics_event_stream_202611 USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202612_application_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202612_application_id_occurred_at_idx ON public.analytics_event_stream_202612 USING btree (application_id, occurred_at DESC);


--
-- Name: analytics_event_stream_202612_name_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202612_name_occurred_at_idx ON public.analytics_event_stream_202612 USING btree (name, occurred_at DESC);


--
-- Name: analytics_event_stream_202612_user_id_occurred_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_event_stream_202612_user_id_occurred_at_idx ON public.analytics_event_stream_202612 USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_events_anon_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_anon_idx ON public.analytics_events USING btree (anon_id) WHERE (anon_id IS NOT NULL);


--
-- Name: analytics_events_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_app_idx ON public.analytics_events USING btree (application_id);


--
-- Name: analytics_events_name_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_name_time_idx ON public.analytics_events USING btree (event_name, occurred_at DESC);


--
-- Name: analytics_events_user_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_events_user_time_idx ON public.analytics_events USING btree (user_id, occurred_at DESC);


--
-- Name: analytics_identity_map_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_identity_map_user_idx ON public.analytics_identity_map USING btree (user_id);


--
-- Name: analytics_scheduled_report_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX analytics_scheduled_report_due_idx ON public.analytics_scheduled_report USING btree (enabled, next_run_at);


--
-- Name: application_item_reviews_item_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX application_item_reviews_item_idx ON public.application_item_reviews USING btree (application_id, item_kind, item_id, created_at DESC);


--
-- Name: application_outcomes_outcome_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX application_outcomes_outcome_idx ON public.application_outcomes USING btree (outcome);


--
-- Name: applications_destination_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX applications_destination_country_idx ON public.applications USING btree (destination_country);


--
-- Name: applications_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX applications_user_idx ON public.applications USING btree (user_id);


--
-- Name: applications_visa_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX applications_visa_type_idx ON public.applications USING btree (visa_type_id) WHERE (visa_type_id IS NOT NULL);


--
-- Name: audit_events_app_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_app_seq_idx ON public.audit_events USING btree (application_id, seq);


--
-- Name: audit_events_field_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_field_idx ON public.audit_events USING btree (application_id, field_key);


--
-- Name: audit_events_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_occurred_idx ON public.audit_events USING btree (occurred_at);


--
-- Name: audit_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_session_idx ON public.audit_events USING btree (submission_session_id);


--
-- Name: audit_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_type_idx ON public.audit_events USING btree (application_id, event_type);


--
-- Name: auth_audit_log_event_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_audit_log_event_idx ON public.auth_audit_log USING btree (event_type, created_at DESC);


--
-- Name: auth_audit_log_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX auth_audit_log_user_idx ON public.auth_audit_log USING btree (user_id, created_at DESC);


--
-- Name: beta_cohort_members_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beta_cohort_members_active_idx ON public.beta_cohort_members USING btree (user_id) WHERE (exited_at IS NULL);


--
-- Name: beta_cohort_members_cohort_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beta_cohort_members_cohort_idx ON public.beta_cohort_members USING btree (cohort_id, exited_at);


--
-- Name: beta_feedback_kind_surface_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beta_feedback_kind_surface_idx ON public.beta_feedback USING btree (kind, surface, created_at DESC);


--
-- Name: beta_feedback_triage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beta_feedback_triage_idx ON public.beta_feedback USING btree (status, created_at DESC);


--
-- Name: beta_feedback_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX beta_feedback_user_idx ON public.beta_feedback USING btree (user_id, created_at DESC);


--
-- Name: checklist_items_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_application_idx ON public.checklist_items USING btree (application_id);


--
-- Name: checklist_items_meta_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_meta_kind_idx ON public.checklist_items USING btree (((meta ->> 'kind'::text)));


--
-- Name: checklist_items_meta_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checklist_items_meta_owner_idx ON public.checklist_items USING btree (((meta ->> 'owner'::text)));


--
-- Name: commission_rules_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX commission_rules_lookup_idx ON public.consultant_commission_rules USING btree (scope, country_code, visa_type, active);


--
-- Name: consultant_approvals_app_field_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_approvals_app_field_idx ON public.consultant_approvals USING btree (application_id, field_key);


--
-- Name: consultant_approvals_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_approvals_app_idx ON public.consultant_approvals USING btree (application_id, scope, decided_at DESC);


--
-- Name: consultant_approvals_consultant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_approvals_consultant_idx ON public.consultant_approvals USING btree (consultant_id, decided_at DESC);


--
-- Name: consultant_assignments_app_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_assignments_app_active_idx ON public.consultant_assignments USING btree (application_id, status);


--
-- Name: consultant_assignments_consultant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_assignments_consultant_idx ON public.consultant_assignments USING btree (consultant_id, status);


--
-- Name: consultant_assignments_due_sweep_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_assignments_due_sweep_idx ON public.consultant_assignments USING btree (due_at) WHERE ((status = 'active'::text) AND (completed_at IS NULL));


--
-- Name: consultant_assignments_one_active_primary_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consultant_assignments_one_active_primary_uidx ON public.consultant_assignments USING btree (application_id) WHERE ((status = 'active'::text) AND (role = 'primary'::text));


--
-- Name: consultant_countries_consultant_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_countries_consultant_active_idx ON public.consultant_countries USING btree (consultant_id, active);


--
-- Name: consultant_countries_country_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_countries_country_active_idx ON public.consultant_countries USING btree (country_code, active);


--
-- Name: consultant_notes_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_notes_conversation_idx ON public.consultant_notes USING btree (conversation_id, created_at);


--
-- Name: consultant_payout_items_transfer_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX consultant_payout_items_transfer_uidx ON public.consultant_payout_items USING btree (stripe_transfer_id) WHERE (stripe_transfer_id IS NOT NULL);


--
-- Name: consultant_payouts_consultant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_payouts_consultant_idx ON public.consultant_payouts USING btree (consultant_id, status);


--
-- Name: consultant_profiles_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_profiles_active_idx ON public.consultant_profiles USING btree (active_status);


--
-- Name: consultant_profiles_rating_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_profiles_rating_idx ON public.consultant_profiles USING btree (rating_avg DESC);


--
-- Name: consultant_reviews_consultant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_reviews_consultant_idx ON public.consultant_reviews USING btree (consultant_id, created_at DESC);


--
-- Name: consultant_skills_lang_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_skills_lang_gin ON public.consultant_skills USING gin (languages);


--
-- Name: consultant_skills_visa_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultant_skills_visa_gin ON public.consultant_skills USING gin (visa_types);


--
-- Name: consultations_consultant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultations_consultant_idx ON public.consultations USING btree (consultant_id, scheduled_start);


--
-- Name: consultations_consultant_window_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultations_consultant_window_idx ON public.consultations USING btree (consultant_id, scheduled_start, scheduled_end) WHERE (status = ANY (ARRAY['requested'::text, 'confirmed'::text]));


--
-- Name: consultations_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consultations_user_idx ON public.consultations USING btree (user_id, scheduled_start);


--
-- Name: consumed_readback_tokens_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX consumed_readback_tokens_app_idx ON public.consumed_readback_tokens USING btree (application_id);


--
-- Name: cross_verifications_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX cross_verifications_application_idx ON public.cross_verifications USING btree (application_id);


--
-- Name: device_push_tokens_last_seen_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_push_tokens_last_seen_idx ON public.device_push_tokens USING btree (last_seen_at);


--
-- Name: device_push_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_push_tokens_user_idx ON public.device_push_tokens USING btree (user_id);


--
-- Name: discount_redemptions_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX discount_redemptions_lookup_idx ON public.discount_redemptions USING btree (coupon_id, created_at DESC);


--
-- Name: document_access_logs_app_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_access_logs_app_time_idx ON public.document_access_logs USING btree (application_id, occurred_at DESC);


--
-- Name: document_holder_confirmations_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_holder_confirmations_app_idx ON public.document_holder_confirmations USING btree (application_id, document_id, created_at DESC);


--
-- Name: document_requests_app_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_requests_app_status_idx ON public.document_requests USING btree (application_id, status);


--
-- Name: document_requests_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_requests_conversation_idx ON public.document_requests USING btree (conversation_id);


--
-- Name: document_templates_checked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_templates_checked_idx ON public.document_templates USING btree (last_checked_at NULLS FIRST);


--
-- Name: document_templates_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX document_templates_identity_idx ON public.document_templates USING btree (country_code, program, template_code);


--
-- Name: document_translations_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX document_translations_app_idx ON public.document_translations USING btree (application_id);


--
-- Name: documents_app_contenthash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_app_contenthash_idx ON public.documents USING btree (application_id, raw_text_hash);


--
-- Name: documents_app_identityhash_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_app_identityhash_idx ON public.documents USING btree (application_id, identity_fphash);


--
-- Name: documents_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX documents_application_idx ON public.documents USING btree (application_id);


--
-- Name: escalation_history_app_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalation_history_app_status_idx ON public.escalation_history USING btree (application_id, status);


--
-- Name: escalation_history_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX escalation_history_conversation_idx ON public.escalation_history USING btree (conversation_id, created_at);


--
-- Name: evidence_packages_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evidence_packages_app_idx ON public.evidence_packages USING btree (application_id, version DESC);


--
-- Name: evidence_packages_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evidence_packages_session_idx ON public.evidence_packages USING btree (submission_session_id);


--
-- Name: feature_flag_audit_flag_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX feature_flag_audit_flag_idx ON public.feature_flag_audit USING btree (flag_key, created_at DESC);


--
-- Name: field_provenance_current_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX field_provenance_current_uidx ON public.field_provenance USING btree (application_id, field_key) WHERE (superseded_by IS NULL);


--
-- Name: field_provenance_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_provenance_document_idx ON public.field_provenance USING btree (source_document_id) WHERE (superseded_by IS NULL);


--
-- Name: field_provenance_lineage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_provenance_lineage_idx ON public.field_provenance USING btree (application_id, field_key, created_at);


--
-- Name: field_provenance_lowconf_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_provenance_lowconf_idx ON public.field_provenance USING btree (application_id, confidence_band) WHERE (superseded_by IS NULL);


--
-- Name: field_provenance_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_provenance_run_idx ON public.field_provenance USING btree (ocr_run_id);


--
-- Name: field_verifications_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_verifications_app_idx ON public.field_verifications USING btree (application_id);


--
-- Name: field_verifications_app_section_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_verifications_app_section_idx ON public.field_verifications USING btree (application_id, section);


--
-- Name: field_verifications_app_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX field_verifications_app_state_idx ON public.field_verifications USING btree (application_id, state);


--
-- Name: form_template_versions_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX form_template_versions_one_active_idx ON public.form_template_versions USING btree (form_template_id) WHERE is_active;


--
-- Name: form_template_versions_sha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_template_versions_sha_idx ON public.form_template_versions USING btree (sha256);


--
-- Name: form_templates_checked_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX form_templates_checked_idx ON public.form_templates USING btree (last_checked_at NULLS FIRST);


--
-- Name: form_templates_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX form_templates_identity_idx ON public.form_templates USING btree (country_code, program, form_code);


--
-- Name: generated_document_revisions_doc_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_document_revisions_doc_idx ON public.generated_document_revisions USING btree (generated_document_id, created_at DESC);


--
-- Name: generated_documents_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX generated_documents_application_idx ON public.generated_documents USING btree (application_id);


--
-- Name: idx_applications_monitor_token; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_monitor_token ON public.applications USING btree (monitor_token);


--
-- Name: intake_messages_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX intake_messages_app_idx ON public.intake_messages USING btree (application_id, created_at);


--
-- Name: kb_answer_citations_chunk_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_answer_citations_chunk_idx ON public.kb_answer_citations USING btree (chunk_id);


--
-- Name: kb_answer_citations_retrieval_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_answer_citations_retrieval_idx ON public.kb_answer_citations USING btree (retrieval_id, claim_index);


--
-- Name: kb_blobs_unreferenced_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_blobs_unreferenced_idx ON public.kb_blobs USING btree (last_seen_at) WHERE (ref_count = 0);


--
-- Name: kb_chunk_scopes_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_chunk_scopes_identity_idx ON public.kb_chunk_scopes USING btree (chunk_id, country_id, COALESCE(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: kb_chunk_scopes_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunk_scopes_lookup_idx ON public.kb_chunk_scopes USING btree (country_id, visa_type_id);


--
-- Name: kb_chunk_texts_trgm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunk_texts_trgm_idx ON public.kb_chunk_texts USING gin (text extensions.gin_trgm_ops);


--
-- Name: kb_chunk_texts_tsv_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunk_texts_tsv_idx ON public.kb_chunk_texts USING gin (tsv);


--
-- Name: kb_chunks_form_codes_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunks_form_codes_idx ON public.kb_chunks USING gin (form_codes);


--
-- Name: kb_chunks_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_chunks_identity_idx ON public.kb_chunks USING btree (extraction_id, ordinal);


--
-- Name: kb_chunks_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunks_scope_idx ON public.kb_chunks USING btree (country_id, visa_type_id, status) WHERE (status = 'current'::text);


--
-- Name: kb_chunks_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunks_source_idx ON public.kb_chunks USING btree (source_id, status);


--
-- Name: kb_chunks_text_sha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunks_text_sha_idx ON public.kb_chunks USING btree (text_sha256);


--
-- Name: kb_chunks_version_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_chunks_version_idx ON public.kb_chunks USING btree (source_version_id);


--
-- Name: kb_embeddings_hnsw_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_embeddings_hnsw_idx ON public.kb_embeddings USING hnsw (embedding extensions.vector_cosine_ops);


--
-- Name: kb_embeddings_model_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_embeddings_model_idx ON public.kb_embeddings USING btree (model);


--
-- Name: kb_extractions_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_extractions_identity_idx ON public.kb_extractions USING btree (source_version_id, extractor, extractor_version);


--
-- Name: kb_extractions_text_sha_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_extractions_text_sha_idx ON public.kb_extractions USING btree (text_sha256);


--
-- Name: kb_freshness_default_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_freshness_default_idx ON public.kb_freshness_policies USING btree ((true)) WHERE ((source_role IS NULL) AND (country_id IS NULL) AND (visa_type_id IS NULL) AND active);


--
-- Name: kb_freshness_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_freshness_lookup_idx ON public.kb_freshness_policies USING btree (country_id, visa_type_id, source_role) WHERE active;


--
-- Name: kb_freshness_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_freshness_scope_idx ON public.kb_freshness_policies USING btree (source_role, country_id, visa_type_id) NULLS NOT DISTINCT;


--
-- Name: kb_ingestion_jobs_idem_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_ingestion_jobs_idem_idx ON public.kb_ingestion_jobs USING btree (idempotency_key);


--
-- Name: kb_ingestion_jobs_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_ingestion_jobs_source_idx ON public.kb_ingestion_jobs USING btree (source_id, created_at DESC);


--
-- Name: kb_ingestion_jobs_state_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_ingestion_jobs_state_idx ON public.kb_ingestion_jobs USING btree (state, created_at) WHERE (state = ANY (ARRAY['queued'::text, 'running'::text, 'failed'::text]));


--
-- Name: kb_quarantine_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_quarantine_open_idx ON public.kb_quarantine USING btree (created_at DESC) WHERE (NOT resolved);


--
-- Name: kb_retrieval_logs_scope_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_retrieval_logs_scope_idx ON public.kb_retrieval_logs USING btree (country_id, visa_type_id, created_at DESC);


--
-- Name: kb_retrieval_logs_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_retrieval_logs_time_idx ON public.kb_retrieval_logs USING btree (created_at DESC);


--
-- Name: kb_retrieval_logs_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_retrieval_logs_user_idx ON public.kb_retrieval_logs USING btree (user_id, created_at DESC) WHERE (user_id IS NOT NULL);


--
-- Name: kb_review_queue_open_dedupe_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_review_queue_open_dedupe_idx ON public.kb_review_queue USING btree (dedupe_key) WHERE (state = ANY (ARRAY['open'::text, 'acknowledged'::text]));


--
-- Name: kb_review_queue_triage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_review_queue_triage_idx ON public.kb_review_queue USING btree (state, severity, last_seen_at DESC);


--
-- Name: kb_sections_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX kb_sections_kind_idx ON public.kb_sections USING btree (extraction_id, kind);


--
-- Name: kb_sections_order_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX kb_sections_order_idx ON public.kb_sections USING btree (extraction_id, ordinal);


--
-- Name: login_history_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX login_history_user_idx ON public.login_history USING btree (user_id, created_at DESC);


--
-- Name: message_attachments_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_attachments_conversation_idx ON public.message_attachments USING btree (conversation_id);


--
-- Name: message_attachments_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX message_attachments_message_idx ON public.message_attachments USING btree (message_id);


--
-- Name: messages_client_id_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX messages_client_id_unique ON public.messages USING btree (conversation_id, sender_id, client_id) WHERE (client_id IS NOT NULL);


--
-- Name: messages_conversation_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_conversation_idx ON public.messages USING btree (conversation_id, created_at);


--
-- Name: messages_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_parent_idx ON public.messages USING btree (parent_message_id);


--
-- Name: messages_search_gin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX messages_search_gin ON public.messages USING gin (search_tsv);


--
-- Name: notification_broadcasts_created_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_broadcasts_created_idx ON public.notification_broadcasts USING btree (created_at DESC);


--
-- Name: notification_deliveries_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_deliveries_status_idx ON public.notification_deliveries USING btree (status, created_at DESC);


--
-- Name: notification_outbox_unprocessed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_outbox_unprocessed_idx ON public.notification_outbox USING btree (created_at) WHERE (processed_at IS NULL);


--
-- Name: notification_templates_active_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX notification_templates_active_uidx ON public.notification_templates USING btree (event_type, locale) WHERE is_active;


--
-- Name: notification_templates_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notification_templates_lookup_idx ON public.notification_templates USING btree (event_type, locale, version DESC);


--
-- Name: notifications_user_unread_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX notifications_user_unread_idx ON public.notifications USING btree (user_id, read_at, created_at);


--
-- Name: ocr_runs_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ocr_runs_application_idx ON public.ocr_runs USING btree (application_id);


--
-- Name: ocr_runs_document_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ocr_runs_document_idx ON public.ocr_runs USING btree (document_id, completed_at DESC);


--
-- Name: ops_agent_runs_agent_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_agent_runs_agent_time_idx ON public.ops_agent_runs USING btree (agent, started_at DESC);


--
-- Name: ops_marketing_events_channel_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_marketing_events_channel_idx ON public.ops_marketing_events USING btree (channel);


--
-- Name: ops_marketing_events_product_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_marketing_events_product_time_idx ON public.ops_marketing_events USING btree (product_id, occurred_at DESC);


--
-- Name: ops_revenue_product_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ops_revenue_product_time_idx ON public.ops_revenue USING btree (product_id, occurred_at DESC);


--
-- Name: organization_invitations_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_invitations_email_idx ON public.organization_invitations USING btree (lower(email));


--
-- Name: organization_invitations_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_invitations_org_idx ON public.organization_invitations USING btree (organization_id, status);


--
-- Name: organization_members_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_members_org_idx ON public.organization_members USING btree (organization_id, status);


--
-- Name: organization_members_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organization_members_user_idx ON public.organization_members USING btree (user_id);


--
-- Name: organizations_owner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX organizations_owner_idx ON public.organizations USING btree (owner_user_id);


--
-- Name: partner_access_tokens_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_access_tokens_app_idx ON public.partner_access_tokens USING btree (application_id, expires_at DESC);


--
-- Name: partner_access_tokens_subject_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_access_tokens_subject_idx ON public.partner_access_tokens USING btree (subject_user_id) WHERE (subject_user_id IS NOT NULL);


--
-- Name: partner_api_keys_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_api_keys_app_idx ON public.partner_api_keys USING btree (application_id, status);


--
-- Name: partner_api_requests_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_api_requests_app_idx ON public.partner_api_requests USING btree (application_id, created_at DESC);


--
-- Name: partner_api_requests_request_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_api_requests_request_idx ON public.partner_api_requests USING btree (request_id);


--
-- Name: partner_applications_client_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_applications_client_idx ON public.partner_applications USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: partner_applications_partner_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_applications_partner_idx ON public.partner_applications USING btree (partner_id, environment);


--
-- Name: partner_events_org_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_events_org_idx ON public.partner_events USING btree (organization_id, created_at DESC);


--
-- Name: partner_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_events_type_idx ON public.partner_events USING btree (event_type, created_at DESC);


--
-- Name: partner_idempotency_expiry_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_idempotency_expiry_idx ON public.partner_idempotency_keys USING btree (expires_at);


--
-- Name: partner_sandbox_resources_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_sandbox_resources_app_idx ON public.partner_sandbox_resources USING btree (application_id, resource_type);


--
-- Name: partner_user_consents_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_user_consents_user_idx ON public.partner_user_consents USING btree (user_id) WHERE (revoked_at IS NULL);


--
-- Name: partner_webhook_deliveries_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_webhook_deliveries_due_idx ON public.partner_webhook_deliveries USING btree (status, next_attempt_at) WHERE (status = ANY (ARRAY['pending'::text, 'failed'::text]));


--
-- Name: partner_webhook_deliveries_endpoint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_webhook_deliveries_endpoint_idx ON public.partner_webhook_deliveries USING btree (endpoint_id, created_at DESC);


--
-- Name: partner_webhook_endpoints_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partner_webhook_endpoints_app_idx ON public.partner_webhook_endpoints USING btree (application_id, status);


--
-- Name: partners_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX partners_status_idx ON public.partners USING btree (status);


--
-- Name: payment_events_object_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_events_object_idx ON public.payment_events USING btree (provider_object_id);


--
-- Name: payment_events_occurred_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payment_events_occurred_idx ON public.payment_events USING btree (occurred_at);


--
-- Name: payments_application_feature_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_application_feature_status_idx ON public.payments USING btree (application_id, feature, status);


--
-- Name: payments_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_application_idx ON public.payments USING btree (application_id);


--
-- Name: payments_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX payments_user_idx ON public.payments USING btree (user_id);


--
-- Name: post_submission_events_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX post_submission_events_application_idx ON public.post_submission_events USING btree (application_id);


--
-- Name: preflight_reviews_app_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX preflight_reviews_app_idx ON public.preflight_reviews USING btree (application_id, started_at DESC);


--
-- Name: preflight_reviews_one_inreview_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX preflight_reviews_one_inreview_uidx ON public.preflight_reviews USING btree (application_id) WHERE (status = 'in_review'::public.preflight_status);


--
-- Name: preflight_reviews_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX preflight_reviews_session_idx ON public.preflight_reviews USING btree (submission_session_id);


--
-- Name: pricing_quote_audit_lookup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_quote_audit_lookup_idx ON public.pricing_quote_audit USING btree (visa_type, country_code, created_at DESC);


--
-- Name: pricing_quotes_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX pricing_quotes_country_idx ON public.pricing_quotes USING btree (country_code);


--
-- Name: privacy_requests_email_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX privacy_requests_email_idx ON public.privacy_requests USING btree (subject_email, requested_at DESC);


--
-- Name: privacy_requests_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX privacy_requests_user_idx ON public.privacy_requests USING btree (user_id, requested_at DESC);


--
-- Name: push_subscriptions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX push_subscriptions_user_idx ON public.push_subscriptions USING btree (user_id);


--
-- Name: reconciliation_exceptions_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX reconciliation_exceptions_run_idx ON public.reconciliation_exceptions USING btree (run_id);


--
-- Name: reminder_log_app_kind_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX reminder_log_app_kind_idx ON public.reminder_log USING btree (application_id, kind);


--
-- Name: service_orders_consultant_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_orders_consultant_idx ON public.consultant_service_orders USING btree (consultant_id, status);


--
-- Name: service_orders_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX service_orders_user_idx ON public.consultant_service_orders USING btree (user_id, created_at DESC);


--
-- Name: submission_sessions_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX submission_sessions_application_idx ON public.submission_sessions USING btree (application_id);


--
-- Name: subscription_credits_balance_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscription_credits_balance_idx ON public.subscription_credits USING btree (subscription_id, period_start);


--
-- Name: subscriptions_user_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX subscriptions_user_status_idx ON public.subscriptions USING btree (user_id, status);


--
-- Name: template_revisions_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_revisions_identity_idx ON public.template_revisions USING btree (source, country_code, program, code, created_at DESC);


--
-- Name: template_revisions_recent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_revisions_recent_idx ON public.template_revisions USING btree (created_at DESC);


--
-- Name: template_revisions_unreviewed_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_revisions_unreviewed_idx ON public.template_revisions USING btree (created_at DESC) WHERE (reviewed_at IS NULL);


--
-- Name: template_sweep_findings_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX template_sweep_findings_identity_idx ON public.template_sweep_findings USING btree (authority, code);


--
-- Name: template_sweep_findings_open_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX template_sweep_findings_open_idx ON public.template_sweep_findings USING btree (last_seen_at DESC) WHERE (status = ANY (ARRAY['new'::text, 'acknowledged'::text]));


--
-- Name: user_roles_role_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_role_idx ON public.user_roles USING btree (role_id);


--
-- Name: user_roles_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX user_roles_user_idx ON public.user_roles USING btree (user_id);


--
-- Name: users_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX users_status_idx ON public.users USING btree (status) WHERE (status <> 'active'::text);


--
-- Name: visa_countries_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_countries_code_idx ON public.visa_countries USING btree (code);


--
-- Name: visa_countries_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_countries_slug_idx ON public.visa_countries USING btree (slug);


--
-- Name: visa_countries_support_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_countries_support_idx ON public.visa_countries USING btree (support_state) WHERE (support_state = 'supported'::text);


--
-- Name: visa_requirements_identity_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_requirements_identity_idx ON public.visa_requirements USING btree (visa_type_id, requirement_code) WHERE (status <> 'retired'::text);


--
-- Name: visa_requirements_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_requirements_source_idx ON public.visa_requirements USING btree (source_version_id);


--
-- Name: visa_requirements_type_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_requirements_type_active_idx ON public.visa_requirements USING btree (visa_type_id, display_order) WHERE (status = 'active'::text);


--
-- Name: visa_source_changes_pending_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_source_changes_pending_idx ON public.visa_source_changes USING btree (created_at DESC) WHERE (state = ANY (ARRAY['detected'::text, 'parsed'::text, 'validated'::text, 'tested'::text]));


--
-- Name: visa_source_changes_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_source_changes_source_idx ON public.visa_source_changes USING btree (source_id, created_at DESC);


--
-- Name: visa_source_checks_run_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_source_checks_run_idx ON public.visa_source_checks USING btree (run_id);


--
-- Name: visa_source_checks_source_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_source_checks_source_idx ON public.visa_source_checks USING btree (source_id, checked_at DESC);


--
-- Name: visa_source_versions_blob_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_source_versions_blob_idx ON public.visa_source_versions USING btree (blob_sha256) WHERE (blob_sha256 IS NOT NULL);


--
-- Name: visa_source_versions_norm_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_source_versions_norm_idx ON public.visa_source_versions USING btree (source_id, normalized_sha256);


--
-- Name: visa_source_versions_one_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_source_versions_one_active_idx ON public.visa_source_versions USING btree (source_id) WHERE is_active;


--
-- Name: visa_source_versions_seq_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_source_versions_seq_idx ON public.visa_source_versions USING btree (source_id, version_number);


--
-- Name: visa_sources_country_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_sources_country_idx ON public.visa_sources USING btree (country_id);


--
-- Name: visa_sources_due_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_sources_due_idx ON public.visa_sources USING btree (last_checked_at NULLS FIRST) WHERE active;


--
-- Name: visa_sources_url_per_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_sources_url_per_type_idx ON public.visa_sources USING btree (source_url, COALESCE(visa_type_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: visa_sources_visa_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_sources_visa_type_idx ON public.visa_sources USING btree (visa_type_id) WHERE (visa_type_id IS NOT NULL);


--
-- Name: visa_sync_runs_started_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_sync_runs_started_idx ON public.visa_sync_runs USING btree (started_at DESC);


--
-- Name: visa_types_category_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_types_category_idx ON public.visa_types USING btree (category);


--
-- Name: visa_types_country_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX visa_types_country_active_idx ON public.visa_types USING btree (country_id) WHERE (lifecycle_state = 'active'::text);


--
-- Name: visa_types_country_slug_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_types_country_slug_idx ON public.visa_types USING btree (country_id, slug);


--
-- Name: visa_types_visaai_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX visa_types_visaai_id_idx ON public.visa_types USING btree (visaai_id);


--
-- Name: voice_consents_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_consents_user_idx ON public.voice_consents USING btree (user_id);


--
-- Name: voice_messages_message_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_messages_message_idx ON public.voice_messages USING btree (message_id);


--
-- Name: voice_sessions_active_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_sessions_active_idx ON public.voice_sessions USING btree (user_id) WHERE (status = ANY (ARRAY['active'::text, 'paused'::text]));


--
-- Name: voice_sessions_cost_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_sessions_cost_idx ON public.voice_sessions USING btree (user_id, started_at);


--
-- Name: voice_sessions_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_sessions_user_idx ON public.voice_sessions USING btree (user_id, started_at DESC);


--
-- Name: voice_turns_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX voice_turns_session_idx ON public.voice_transcript_turns USING btree (session_id, created_at);


--
-- Name: vri_scores_application_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vri_scores_application_idx ON public.vri_scores USING btree (application_id);


--
-- Name: vri_visa_suggestions_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX vri_visa_suggestions_score_idx ON public.vri_visa_suggestions USING btree (vri_score_id, rank);


--
-- Name: analytics_event_stream_202607_application_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_app_time_idx ATTACH PARTITION public.analytics_event_stream_202607_application_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202607_name_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_name_time_idx ATTACH PARTITION public.analytics_event_stream_202607_name_occurred_at_idx;


--
-- Name: analytics_event_stream_202607_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_pkey ATTACH PARTITION public.analytics_event_stream_202607_pkey;


--
-- Name: analytics_event_stream_202607_user_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_user_time_idx ATTACH PARTITION public.analytics_event_stream_202607_user_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202608_application_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_app_time_idx ATTACH PARTITION public.analytics_event_stream_202608_application_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202608_name_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_name_time_idx ATTACH PARTITION public.analytics_event_stream_202608_name_occurred_at_idx;


--
-- Name: analytics_event_stream_202608_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_pkey ATTACH PARTITION public.analytics_event_stream_202608_pkey;


--
-- Name: analytics_event_stream_202608_user_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_user_time_idx ATTACH PARTITION public.analytics_event_stream_202608_user_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202609_application_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_app_time_idx ATTACH PARTITION public.analytics_event_stream_202609_application_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202609_name_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_name_time_idx ATTACH PARTITION public.analytics_event_stream_202609_name_occurred_at_idx;


--
-- Name: analytics_event_stream_202609_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_pkey ATTACH PARTITION public.analytics_event_stream_202609_pkey;


--
-- Name: analytics_event_stream_202609_user_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_user_time_idx ATTACH PARTITION public.analytics_event_stream_202609_user_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202610_application_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_app_time_idx ATTACH PARTITION public.analytics_event_stream_202610_application_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202610_name_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_name_time_idx ATTACH PARTITION public.analytics_event_stream_202610_name_occurred_at_idx;


--
-- Name: analytics_event_stream_202610_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_pkey ATTACH PARTITION public.analytics_event_stream_202610_pkey;


--
-- Name: analytics_event_stream_202610_user_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_user_time_idx ATTACH PARTITION public.analytics_event_stream_202610_user_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202611_application_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_app_time_idx ATTACH PARTITION public.analytics_event_stream_202611_application_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202611_name_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_name_time_idx ATTACH PARTITION public.analytics_event_stream_202611_name_occurred_at_idx;


--
-- Name: analytics_event_stream_202611_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_pkey ATTACH PARTITION public.analytics_event_stream_202611_pkey;


--
-- Name: analytics_event_stream_202611_user_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_user_time_idx ATTACH PARTITION public.analytics_event_stream_202611_user_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202612_application_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_app_time_idx ATTACH PARTITION public.analytics_event_stream_202612_application_id_occurred_at_idx;


--
-- Name: analytics_event_stream_202612_name_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_name_time_idx ATTACH PARTITION public.analytics_event_stream_202612_name_occurred_at_idx;


--
-- Name: analytics_event_stream_202612_pkey; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_pkey ATTACH PARTITION public.analytics_event_stream_202612_pkey;


--
-- Name: analytics_event_stream_202612_user_id_occurred_at_idx; Type: INDEX ATTACH; Schema: public; Owner: -
--

ALTER INDEX public.analytics_event_stream_user_time_idx ATTACH PARTITION public.analytics_event_stream_202612_user_id_occurred_at_idx;


--
-- Name: audit_events audit_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_no_mutate();


--
-- Name: audit_events audit_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.audit_no_mutate();


--
-- Name: beta_cohorts beta_cohorts_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER beta_cohorts_touch BEFORE UPDATE ON public.beta_cohorts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: beta_feedback beta_feedback_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER beta_feedback_touch BEFORE UPDATE ON public.beta_feedback FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: consultant_reviews consultant_reviews_rollup; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER consultant_reviews_rollup AFTER INSERT OR DELETE OR UPDATE ON public.consultant_reviews FOR EACH ROW EXECUTE FUNCTION public.refresh_consultant_rating();


--
-- Name: evidence_packages evidence_packages_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evidence_packages_no_delete BEFORE DELETE ON public.evidence_packages FOR EACH ROW EXECUTE FUNCTION public.audit_no_mutate();


--
-- Name: evidence_packages evidence_packages_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evidence_packages_no_update BEFORE UPDATE ON public.evidence_packages FOR EACH ROW EXECUTE FUNCTION public.audit_no_mutate();


--
-- Name: feature_flags feature_flags_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER feature_flags_touch BEFORE UPDATE ON public.feature_flags FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


--
-- Name: field_provenance field_provenance_relink_chain; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER field_provenance_relink_chain AFTER DELETE ON public.field_provenance REFERENCING OLD TABLE AS removed FOR EACH STATEMENT EXECUTE FUNCTION public.field_provenance_relink_chain();


--
-- Name: field_verifications field_verifications_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER field_verifications_touch BEFORE UPDATE ON public.field_verifications FOR EACH ROW EXECUTE FUNCTION public.touch_field_verifications();


--
-- Name: payment_events payment_events_no_delete; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payment_events_no_delete BEFORE DELETE ON public.payment_events FOR EACH ROW EXECUTE FUNCTION public.audit_no_mutate();


--
-- Name: payment_events payment_events_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER payment_events_no_update BEFORE UPDATE ON public.payment_events FOR EACH ROW EXECUTE FUNCTION public.audit_no_mutate();


--
-- Name: reconciliation_exceptions reconciliation_exceptions_no_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER reconciliation_exceptions_no_update BEFORE UPDATE ON public.reconciliation_exceptions FOR EACH ROW EXECUTE FUNCTION public.audit_no_mutate();


--
-- Name: kb_freshness_policies set_kb_freshness_policies_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_kb_freshness_policies_updated_at BEFORE UPDATE ON public.kb_freshness_policies FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: kb_ingestion_jobs set_kb_ingestion_jobs_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_kb_ingestion_jobs_updated_at BEFORE UPDATE ON public.kb_ingestion_jobs FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: kb_review_queue set_kb_review_queue_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER set_kb_review_queue_updated_at BEFORE UPDATE ON public.kb_review_queue FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: applications trg_application_status_changed; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_application_status_changed AFTER UPDATE OF status ON public.applications FOR EACH ROW EXECUTE FUNCTION public.enqueue_application_status_changed();


--
-- Name: conversations trg_enforce_consultant_state; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_consultant_state BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.enforce_consultant_state_service_role();


--
-- Name: users trg_enforce_user_status; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_enforce_user_status BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION public.enforce_user_status_service_role();


--
-- Name: applications trg_sec_guard_applications; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sec_guard_applications BEFORE UPDATE ON public.applications FOR EACH ROW EXECUTE FUNCTION public.sec_guard_applications();


--
-- Name: consultant_profiles trg_sec_guard_consultant_profiles; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sec_guard_consultant_profiles BEFORE UPDATE ON public.consultant_profiles FOR EACH ROW EXECUTE FUNCTION public.sec_guard_consultant_profiles();


--
-- Name: consultations trg_sec_guard_consultations; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sec_guard_consultations BEFORE UPDATE ON public.consultations FOR EACH ROW EXECUTE FUNCTION public.sec_guard_consultations();


--
-- Name: visa_countries visa_countries_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER visa_countries_touch BEFORE UPDATE ON public.visa_countries FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: visa_requirements visa_requirements_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER visa_requirements_touch BEFORE UPDATE ON public.visa_requirements FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: visa_source_changes visa_source_changes_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER visa_source_changes_touch BEFORE UPDATE ON public.visa_source_changes FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: visa_sources visa_sources_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER visa_sources_touch BEFORE UPDATE ON public.visa_sources FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: visa_types visa_types_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER visa_types_touch BEFORE UPDATE ON public.visa_types FOR EACH ROW EXECUTE FUNCTION public.visa_registry_touch_updated_at();


--
-- Name: action_items action_items_post_submission_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.action_items
    ADD CONSTRAINT action_items_post_submission_event_id_fkey FOREIGN KEY (post_submission_event_id) REFERENCES public.post_submission_events(id) ON DELETE CASCADE;


--
-- Name: addon_purchases addon_purchases_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addon_purchases
    ADD CONSTRAINT addon_purchases_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: addon_purchases addon_purchases_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addon_purchases
    ADD CONSTRAINT addon_purchases_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: addon_purchases addon_purchases_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.addon_purchases
    ADD CONSTRAINT addon_purchases_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: ai_usage_events ai_usage_events_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_events
    ADD CONSTRAINT ai_usage_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: ai_usage_events ai_usage_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_events
    ADD CONSTRAINT ai_usage_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: analytics_alert_event analytics_alert_event_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_alert_event
    ADD CONSTRAINT analytics_alert_event_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES public.analytics_alert_rule(id) ON DELETE CASCADE;


--
-- Name: analytics_events analytics_events_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: analytics_events analytics_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_events
    ADD CONSTRAINT analytics_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: analytics_report_run analytics_report_run_saved_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_report_run
    ADD CONSTRAINT analytics_report_run_saved_report_id_fkey FOREIGN KEY (saved_report_id) REFERENCES public.analytics_saved_report(id) ON DELETE CASCADE;


--
-- Name: analytics_scheduled_report analytics_scheduled_report_saved_report_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.analytics_scheduled_report
    ADD CONSTRAINT analytics_scheduled_report_saved_report_id_fkey FOREIGN KEY (saved_report_id) REFERENCES public.analytics_saved_report(id) ON DELETE CASCADE;


--
-- Name: application_item_reviews application_item_reviews_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_item_reviews
    ADD CONSTRAINT application_item_reviews_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: application_item_reviews application_item_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_item_reviews
    ADD CONSTRAINT application_item_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: application_outcomes application_outcomes_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_outcomes
    ADD CONSTRAINT application_outcomes_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: application_outcomes application_outcomes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_outcomes
    ADD CONSTRAINT application_outcomes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: application_profiles application_profiles_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_profiles
    ADD CONSTRAINT application_profiles_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: applications applications_framework_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_framework_id_fkey FOREIGN KEY (framework_id) REFERENCES public.country_frameworks(id);


--
-- Name: applications applications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: applications applications_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE SET NULL;


--
-- Name: audit_chain_state audit_chain_state_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_state
    ADD CONSTRAINT audit_chain_state_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: audit_events audit_events_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: auth_audit_log auth_audit_log_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_log
    ADD CONSTRAINT auth_audit_log_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: auth_audit_log auth_audit_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auth_audit_log
    ADD CONSTRAINT auth_audit_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beta_cohort_members beta_cohort_members_cohort_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_cohort_members
    ADD CONSTRAINT beta_cohort_members_cohort_id_fkey FOREIGN KEY (cohort_id) REFERENCES public.beta_cohorts(id) ON DELETE CASCADE;


--
-- Name: beta_cohort_members beta_cohort_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_cohort_members
    ADD CONSTRAINT beta_cohort_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: beta_feedback beta_feedback_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: beta_feedback beta_feedback_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: beta_feedback beta_feedback_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.beta_feedback
    ADD CONSTRAINT beta_feedback_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: checklist_items checklist_items_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checklist_items
    ADD CONSTRAINT checklist_items_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: consultant_approvals consultant_approvals_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_approvals
    ADD CONSTRAINT consultant_approvals_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: consultant_approvals consultant_approvals_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_approvals
    ADD CONSTRAINT consultant_approvals_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consultant_assignments consultant_assignments_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_assignments
    ADD CONSTRAINT consultant_assignments_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: consultant_assignments consultant_assignments_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_assignments
    ADD CONSTRAINT consultant_assignments_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: consultant_assignments consultant_assignments_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_assignments
    ADD CONSTRAINT consultant_assignments_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consultant_availability consultant_availability_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_availability
    ADD CONSTRAINT consultant_availability_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE CASCADE;


--
-- Name: consultant_commission_rules consultant_commission_rules_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_commission_rules
    ADD CONSTRAINT consultant_commission_rules_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE CASCADE;


--
-- Name: consultant_countries consultant_countries_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_countries
    ADD CONSTRAINT consultant_countries_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consultant_notes consultant_notes_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_notes
    ADD CONSTRAINT consultant_notes_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: consultant_notes consultant_notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_notes
    ADD CONSTRAINT consultant_notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES auth.users(id);


--
-- Name: consultant_notes consultant_notes_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_notes
    ADD CONSTRAINT consultant_notes_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: consultant_payout_items consultant_payout_items_payout_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_payout_items
    ADD CONSTRAINT consultant_payout_items_payout_id_fkey FOREIGN KEY (payout_id) REFERENCES public.consultant_payouts(id) ON DELETE CASCADE;


--
-- Name: consultant_payout_items consultant_payout_items_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_payout_items
    ADD CONSTRAINT consultant_payout_items_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.consultant_service_orders(id) ON DELETE RESTRICT;


--
-- Name: consultant_payouts consultant_payouts_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_payouts
    ADD CONSTRAINT consultant_payouts_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE RESTRICT;


--
-- Name: consultant_profiles consultant_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_profiles
    ADD CONSTRAINT consultant_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consultant_reviews consultant_reviews_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_reviews
    ADD CONSTRAINT consultant_reviews_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: consultant_reviews consultant_reviews_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_reviews
    ADD CONSTRAINT consultant_reviews_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE CASCADE;


--
-- Name: consultant_reviews consultant_reviews_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_reviews
    ADD CONSTRAINT consultant_reviews_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consultant_service_orders consultant_service_orders_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_service_orders
    ADD CONSTRAINT consultant_service_orders_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: consultant_service_orders consultant_service_orders_commission_rule_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_service_orders
    ADD CONSTRAINT consultant_service_orders_commission_rule_id_fkey FOREIGN KEY (commission_rule_id) REFERENCES public.consultant_commission_rules(id);


--
-- Name: consultant_service_orders consultant_service_orders_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_service_orders
    ADD CONSTRAINT consultant_service_orders_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE RESTRICT;


--
-- Name: consultant_service_orders consultant_service_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_service_orders
    ADD CONSTRAINT consultant_service_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consultant_skills consultant_skills_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_skills
    ADD CONSTRAINT consultant_skills_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE CASCADE;


--
-- Name: consultant_tax_profiles consultant_tax_profiles_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultant_tax_profiles
    ADD CONSTRAINT consultant_tax_profiles_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE CASCADE;


--
-- Name: consultations consultations_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: consultations consultations_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE CASCADE;


--
-- Name: consultations consultations_service_order_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_service_order_id_fkey FOREIGN KEY (service_order_id) REFERENCES public.consultant_service_orders(id) ON DELETE SET NULL;


--
-- Name: consultations consultations_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consultations
    ADD CONSTRAINT consultations_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: consumed_readback_tokens consumed_readback_tokens_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.consumed_readback_tokens
    ADD CONSTRAINT consumed_readback_tokens_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: conversation_participants conversation_participants_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversation_participants
    ADD CONSTRAINT conversation_participants_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: conversations conversations_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.conversations
    ADD CONSTRAINT conversations_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: cross_verifications cross_verifications_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_verifications
    ADD CONSTRAINT cross_verifications_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: cross_verifications cross_verifications_doc_a_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_verifications
    ADD CONSTRAINT cross_verifications_doc_a_id_fkey FOREIGN KEY (doc_a_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: cross_verifications cross_verifications_doc_b_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_verifications
    ADD CONSTRAINT cross_verifications_doc_b_id_fkey FOREIGN KEY (doc_b_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: device_push_tokens device_push_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_push_tokens
    ADD CONSTRAINT device_push_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: discount_redemptions discount_redemptions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_redemptions
    ADD CONSTRAINT discount_redemptions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: discount_redemptions discount_redemptions_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_redemptions
    ADD CONSTRAINT discount_redemptions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE RESTRICT;


--
-- Name: discount_redemptions discount_redemptions_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_redemptions
    ADD CONSTRAINT discount_redemptions_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: discount_redemptions discount_redemptions_promotion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_redemptions
    ADD CONSTRAINT discount_redemptions_promotion_id_fkey FOREIGN KEY (promotion_id) REFERENCES public.promotions(id) ON DELETE SET NULL;


--
-- Name: discount_redemptions discount_redemptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discount_redemptions
    ADD CONSTRAINT discount_redemptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: document_access_logs document_access_logs_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_logs
    ADD CONSTRAINT document_access_logs_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: document_access_logs document_access_logs_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_logs
    ADD CONSTRAINT document_access_logs_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_access_logs document_access_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_access_logs
    ADD CONSTRAINT document_access_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: document_holder_confirmations document_holder_confirmations_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_holder_confirmations
    ADD CONSTRAINT document_holder_confirmations_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: document_holder_confirmations document_holder_confirmations_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_holder_confirmations
    ADD CONSTRAINT document_holder_confirmations_confirmed_by_fkey FOREIGN KEY (confirmed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: document_holder_confirmations document_holder_confirmations_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_holder_confirmations
    ADD CONSTRAINT document_holder_confirmations_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_requests document_requests_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: document_requests document_requests_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.checklist_items(id) ON DELETE SET NULL;


--
-- Name: document_requests document_requests_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: document_requests document_requests_fulfilled_attachment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_fulfilled_attachment_id_fkey FOREIGN KEY (fulfilled_attachment_id) REFERENCES public.message_attachments(id) ON DELETE SET NULL;


--
-- Name: document_requests document_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_requests
    ADD CONSTRAINT document_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id);


--
-- Name: document_translations document_translations_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_translations
    ADD CONSTRAINT document_translations_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: document_translations document_translations_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_translations
    ADD CONSTRAINT document_translations_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: document_verifications document_verifications_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.document_verifications
    ADD CONSTRAINT document_verifications_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: documents documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: documents documents_checklist_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_checklist_item_id_fkey FOREIGN KEY (checklist_item_id) REFERENCES public.checklist_items(id);


--
-- Name: documents documents_duplicate_of_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_duplicate_of_fkey FOREIGN KEY (duplicate_of) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: escalation_history escalation_history_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_history
    ADD CONSTRAINT escalation_history_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: escalation_history escalation_history_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_history
    ADD CONSTRAINT escalation_history_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: escalation_history escalation_history_escalated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_history
    ADD CONSTRAINT escalation_history_escalated_by_fkey FOREIGN KEY (escalated_by) REFERENCES auth.users(id);


--
-- Name: escalation_history escalation_history_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.escalation_history
    ADD CONSTRAINT escalation_history_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id);


--
-- Name: evidence_packages evidence_packages_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: evidence_packages evidence_packages_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: evidence_packages evidence_packages_submission_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_packages
    ADD CONSTRAINT evidence_packages_submission_session_id_fkey FOREIGN KEY (submission_session_id) REFERENCES public.submission_sessions(id) ON DELETE SET NULL;


--
-- Name: feature_flag_audit feature_flag_audit_actor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flag_audit
    ADD CONSTRAINT feature_flag_audit_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: feature_flags feature_flags_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.feature_flags
    ADD CONSTRAINT feature_flags_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: field_provenance field_provenance_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_provenance
    ADD CONSTRAINT field_provenance_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: field_provenance field_provenance_ocr_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_provenance
    ADD CONSTRAINT field_provenance_ocr_run_id_fkey FOREIGN KEY (ocr_run_id) REFERENCES public.ocr_runs(id) ON DELETE CASCADE;


--
-- Name: field_provenance field_provenance_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_provenance
    ADD CONSTRAINT field_provenance_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: field_provenance field_provenance_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_provenance
    ADD CONSTRAINT field_provenance_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.field_provenance(id) DEFERRABLE INITIALLY DEFERRED;


--
-- Name: field_verifications field_verifications_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_verifications
    ADD CONSTRAINT field_verifications_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: field_verifications field_verifications_consultant_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_verifications
    ADD CONSTRAINT field_verifications_consultant_approved_by_fkey FOREIGN KEY (consultant_approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: field_verifications field_verifications_consultant_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_verifications
    ADD CONSTRAINT field_verifications_consultant_reviewed_by_fkey FOREIGN KEY (consultant_reviewed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: field_verifications field_verifications_source_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_verifications
    ADD CONSTRAINT field_verifications_source_document_id_fkey FOREIGN KEY (source_document_id) REFERENCES public.documents(id) ON DELETE SET NULL;


--
-- Name: field_verifications field_verifications_user_confirmed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.field_verifications
    ADD CONSTRAINT field_verifications_user_confirmed_by_fkey FOREIGN KEY (user_confirmed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: form_template_versions form_template_versions_form_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_template_versions
    ADD CONSTRAINT form_template_versions_form_template_id_fkey FOREIGN KEY (form_template_id) REFERENCES public.form_templates(id) ON DELETE CASCADE;


--
-- Name: generated_document_revisions generated_document_revisions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_revisions
    ADD CONSTRAINT generated_document_revisions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: generated_document_revisions generated_document_revisions_edited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_revisions
    ADD CONSTRAINT generated_document_revisions_edited_by_fkey FOREIGN KEY (edited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: generated_document_revisions generated_document_revisions_generated_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_document_revisions
    ADD CONSTRAINT generated_document_revisions_generated_document_id_fkey FOREIGN KEY (generated_document_id) REFERENCES public.generated_documents(id) ON DELETE CASCADE;


--
-- Name: generated_documents generated_documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.generated_documents
    ADD CONSTRAINT generated_documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: intake_messages intake_messages_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intake_messages
    ADD CONSTRAINT intake_messages_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: kb_answer_citations kb_answer_citations_chunk_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_answer_citations
    ADD CONSTRAINT kb_answer_citations_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES public.kb_chunks(id) ON DELETE RESTRICT;


--
-- Name: kb_answer_citations kb_answer_citations_retrieval_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_answer_citations
    ADD CONSTRAINT kb_answer_citations_retrieval_id_fkey FOREIGN KEY (retrieval_id) REFERENCES public.kb_retrieval_logs(id) ON DELETE CASCADE;


--
-- Name: kb_answer_citations kb_answer_citations_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_answer_citations
    ADD CONSTRAINT kb_answer_citations_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.visa_source_versions(id) ON DELETE RESTRICT;


--
-- Name: kb_chunk_scopes kb_chunk_scopes_chunk_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunk_scopes
    ADD CONSTRAINT kb_chunk_scopes_chunk_id_fkey FOREIGN KEY (chunk_id) REFERENCES public.kb_chunks(id) ON DELETE CASCADE;


--
-- Name: kb_chunk_scopes kb_chunk_scopes_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunk_scopes
    ADD CONSTRAINT kb_chunk_scopes_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.visa_countries(id) ON DELETE CASCADE;


--
-- Name: kb_chunk_scopes kb_chunk_scopes_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunk_scopes
    ADD CONSTRAINT kb_chunk_scopes_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE CASCADE;


--
-- Name: kb_chunks kb_chunks_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.visa_countries(id) ON DELETE CASCADE;


--
-- Name: kb_chunks kb_chunks_extraction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_extraction_id_fkey FOREIGN KEY (extraction_id) REFERENCES public.kb_extractions(id) ON DELETE CASCADE;


--
-- Name: kb_chunks kb_chunks_section_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_section_id_fkey FOREIGN KEY (section_id) REFERENCES public.kb_sections(id) ON DELETE SET NULL;


--
-- Name: kb_chunks kb_chunks_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.visa_sources(id) ON DELETE CASCADE;


--
-- Name: kb_chunks kb_chunks_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.visa_source_versions(id) ON DELETE CASCADE;


--
-- Name: kb_chunks kb_chunks_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.kb_chunks(id) ON DELETE SET NULL;


--
-- Name: kb_chunks kb_chunks_text_sha256_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_text_sha256_fkey FOREIGN KEY (text_sha256) REFERENCES public.kb_chunk_texts(sha256) ON DELETE RESTRICT;


--
-- Name: kb_chunks kb_chunks_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_chunks
    ADD CONSTRAINT kb_chunks_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE CASCADE;


--
-- Name: kb_embeddings kb_embeddings_text_sha256_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_embeddings
    ADD CONSTRAINT kb_embeddings_text_sha256_fkey FOREIGN KEY (text_sha256) REFERENCES public.kb_chunk_texts(sha256) ON DELETE CASCADE;


--
-- Name: kb_extractions kb_extractions_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_extractions
    ADD CONSTRAINT kb_extractions_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.visa_source_versions(id) ON DELETE CASCADE;


--
-- Name: kb_freshness_policies kb_freshness_policies_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_freshness_policies
    ADD CONSTRAINT kb_freshness_policies_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.visa_countries(id) ON DELETE CASCADE;


--
-- Name: kb_freshness_policies kb_freshness_policies_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_freshness_policies
    ADD CONSTRAINT kb_freshness_policies_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE CASCADE;


--
-- Name: kb_ingestion_jobs kb_ingestion_jobs_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_ingestion_jobs
    ADD CONSTRAINT kb_ingestion_jobs_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.visa_sources(id) ON DELETE CASCADE;


--
-- Name: kb_ingestion_jobs kb_ingestion_jobs_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_ingestion_jobs
    ADD CONSTRAINT kb_ingestion_jobs_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.visa_source_versions(id) ON DELETE CASCADE;


--
-- Name: kb_quarantine kb_quarantine_blob_sha256_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_quarantine
    ADD CONSTRAINT kb_quarantine_blob_sha256_fkey FOREIGN KEY (blob_sha256) REFERENCES public.kb_blobs(sha256) ON DELETE SET NULL;


--
-- Name: kb_quarantine kb_quarantine_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_quarantine
    ADD CONSTRAINT kb_quarantine_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: kb_quarantine kb_quarantine_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_quarantine
    ADD CONSTRAINT kb_quarantine_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.visa_sources(id) ON DELETE CASCADE;


--
-- Name: kb_quarantine kb_quarantine_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_quarantine
    ADD CONSTRAINT kb_quarantine_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.visa_source_versions(id) ON DELETE CASCADE;


--
-- Name: kb_retrieval_logs kb_retrieval_logs_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_retrieval_logs
    ADD CONSTRAINT kb_retrieval_logs_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.visa_countries(id) ON DELETE SET NULL;


--
-- Name: kb_retrieval_logs kb_retrieval_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_retrieval_logs
    ADD CONSTRAINT kb_retrieval_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: kb_retrieval_logs kb_retrieval_logs_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_retrieval_logs
    ADD CONSTRAINT kb_retrieval_logs_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE SET NULL;


--
-- Name: kb_review_queue kb_review_queue_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_review_queue
    ADD CONSTRAINT kb_review_queue_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: kb_review_queue kb_review_queue_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_review_queue
    ADD CONSTRAINT kb_review_queue_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.visa_countries(id) ON DELETE CASCADE;


--
-- Name: kb_review_queue kb_review_queue_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_review_queue
    ADD CONSTRAINT kb_review_queue_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: kb_review_queue kb_review_queue_source_change_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_review_queue
    ADD CONSTRAINT kb_review_queue_source_change_id_fkey FOREIGN KEY (source_change_id) REFERENCES public.visa_source_changes(id) ON DELETE CASCADE;


--
-- Name: kb_review_queue kb_review_queue_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_review_queue
    ADD CONSTRAINT kb_review_queue_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.visa_sources(id) ON DELETE CASCADE;


--
-- Name: kb_review_queue kb_review_queue_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_review_queue
    ADD CONSTRAINT kb_review_queue_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE CASCADE;


--
-- Name: kb_sections kb_sections_extraction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_sections
    ADD CONSTRAINT kb_sections_extraction_id_fkey FOREIGN KEY (extraction_id) REFERENCES public.kb_extractions(id) ON DELETE CASCADE;


--
-- Name: login_history login_history_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.login_history
    ADD CONSTRAINT login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: marketing_attribution marketing_attribution_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketing_attribution
    ADD CONSTRAINT marketing_attribution_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: message_attachments message_attachments_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: message_attachments message_attachments_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.message_attachments
    ADD CONSTRAINT message_attachments_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: messages messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: messages messages_parent_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_parent_message_id_fkey FOREIGN KEY (parent_message_id) REFERENCES public.messages(id) ON DELETE SET NULL;


--
-- Name: messages messages_sender_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_sender_id_fkey FOREIGN KEY (sender_id) REFERENCES auth.users(id);


--
-- Name: notification_broadcasts notification_broadcasts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_broadcasts
    ADD CONSTRAINT notification_broadcasts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notification_deliveries notification_deliveries_notification_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_notification_id_fkey FOREIGN KEY (notification_id) REFERENCES public.notifications(id) ON DELETE CASCADE;


--
-- Name: notification_deliveries notification_deliveries_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_deliveries
    ADD CONSTRAINT notification_deliveries_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notification_preferences notification_preferences_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_preferences
    ADD CONSTRAINT notification_preferences_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: notification_templates notification_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notification_templates
    ADD CONSTRAINT notification_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: ocr_runs ocr_runs_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_runs
    ADD CONSTRAINT ocr_runs_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: ocr_runs ocr_runs_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ocr_runs
    ADD CONSTRAINT ocr_runs_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: ops_agent_runs ops_agent_runs_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_agent_runs
    ADD CONSTRAINT ops_agent_runs_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.ops_products(id) ON DELETE SET NULL;


--
-- Name: ops_experiments ops_experiments_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_experiments
    ADD CONSTRAINT ops_experiments_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.ops_products(id) ON DELETE CASCADE;


--
-- Name: ops_marketing_events ops_marketing_events_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_marketing_events
    ADD CONSTRAINT ops_marketing_events_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.ops_products(id) ON DELETE CASCADE;


--
-- Name: ops_revenue ops_revenue_product_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ops_revenue
    ADD CONSTRAINT ops_revenue_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.ops_products(id) ON DELETE CASCADE;


--
-- Name: organization_invitations organization_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: organization_invitations organization_invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_invitations
    ADD CONSTRAINT organization_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: organization_members organization_members_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization_members
    ADD CONSTRAINT organization_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: organizations organizations_owner_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: partner_access_tokens partner_access_tokens_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_access_tokens
    ADD CONSTRAINT partner_access_tokens_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_access_tokens partner_access_tokens_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_access_tokens
    ADD CONSTRAINT partner_access_tokens_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_api_keys partner_api_keys_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_api_keys
    ADD CONSTRAINT partner_api_keys_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_api_keys partner_api_keys_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_api_keys
    ADD CONSTRAINT partner_api_keys_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partner_api_keys partner_api_keys_rotated_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_api_keys
    ADD CONSTRAINT partner_api_keys_rotated_from_fkey FOREIGN KEY (rotated_from) REFERENCES public.partner_api_keys(id) ON DELETE SET NULL;


--
-- Name: partner_api_requests partner_api_requests_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_api_requests
    ADD CONSTRAINT partner_api_requests_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_applications partner_applications_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_applications
    ADD CONSTRAINT partner_applications_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partner_applications partner_applications_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_applications
    ADD CONSTRAINT partner_applications_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partner_applications partner_applications_partner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_applications
    ADD CONSTRAINT partner_applications_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE CASCADE;


--
-- Name: partner_authorization_codes partner_authorization_codes_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_authorization_codes
    ADD CONSTRAINT partner_authorization_codes_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_authorization_codes partner_authorization_codes_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_authorization_codes
    ADD CONSTRAINT partner_authorization_codes_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_events partner_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_events
    ADD CONSTRAINT partner_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: partner_events partner_events_subject_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_events
    ADD CONSTRAINT partner_events_subject_user_id_fkey FOREIGN KEY (subject_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_idempotency_keys partner_idempotency_keys_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_idempotency_keys
    ADD CONSTRAINT partner_idempotency_keys_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_sandbox_resources partner_sandbox_resources_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_sandbox_resources
    ADD CONSTRAINT partner_sandbox_resources_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_usage_counters partner_usage_counters_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_usage_counters
    ADD CONSTRAINT partner_usage_counters_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_user_consents partner_user_consents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_user_consents
    ADD CONSTRAINT partner_user_consents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partner_user_consents partner_user_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_user_consents
    ADD CONSTRAINT partner_user_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: partner_webhook_deliveries partner_webhook_deliveries_endpoint_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_deliveries
    ADD CONSTRAINT partner_webhook_deliveries_endpoint_id_fkey FOREIGN KEY (endpoint_id) REFERENCES public.partner_webhook_endpoints(id) ON DELETE CASCADE;


--
-- Name: partner_webhook_deliveries partner_webhook_deliveries_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_deliveries
    ADD CONSTRAINT partner_webhook_deliveries_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.partner_events(id) ON DELETE CASCADE;


--
-- Name: partner_webhook_deliveries partner_webhook_deliveries_replayed_from_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_deliveries
    ADD CONSTRAINT partner_webhook_deliveries_replayed_from_fkey FOREIGN KEY (replayed_from) REFERENCES public.partner_webhook_deliveries(id) ON DELETE SET NULL;


--
-- Name: partner_webhook_endpoints partner_webhook_endpoints_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partner_webhook_endpoints
    ADD CONSTRAINT partner_webhook_endpoints_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.partner_applications(id) ON DELETE CASCADE;


--
-- Name: partners partners_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: partners partners_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.partners
    ADD CONSTRAINT partners_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: payment_disputes payment_disputes_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_disputes
    ADD CONSTRAINT payment_disputes_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: payment_dunning payment_dunning_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_dunning
    ADD CONSTRAINT payment_dunning_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: payment_event_processing payment_event_processing_provider_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_event_processing
    ADD CONSTRAINT payment_event_processing_provider_event_id_fkey FOREIGN KEY (provider_event_id) REFERENCES public.payment_events(provider_event_id) ON DELETE RESTRICT;


--
-- Name: payment_events payment_events_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id);


--
-- Name: payments payments_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payout_tax_statements payout_tax_statements_consultant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payout_tax_statements
    ADD CONSTRAINT payout_tax_statements_consultant_id_fkey FOREIGN KEY (consultant_id) REFERENCES public.consultant_profiles(id) ON DELETE CASCADE;


--
-- Name: post_submission_events post_submission_events_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.post_submission_events
    ADD CONSTRAINT post_submission_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: preflight_reviews preflight_reviews_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preflight_reviews
    ADD CONSTRAINT preflight_reviews_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: preflight_reviews preflight_reviews_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preflight_reviews
    ADD CONSTRAINT preflight_reviews_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: preflight_reviews preflight_reviews_submission_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.preflight_reviews
    ADD CONSTRAINT preflight_reviews_submission_session_id_fkey FOREIGN KEY (submission_session_id) REFERENCES public.submission_sessions(id) ON DELETE SET NULL;


--
-- Name: pricing_quotes pricing_quotes_country_code_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quotes
    ADD CONSTRAINT pricing_quotes_country_code_fkey FOREIGN KEY (country_code) REFERENCES public.pricing_country_factors(country_code) ON DELETE CASCADE;


--
-- Name: pricing_quotes pricing_quotes_visa_type_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pricing_quotes
    ADD CONSTRAINT pricing_quotes_visa_type_fkey FOREIGN KEY (visa_type) REFERENCES public.pricing_visa_tiers(visa_type) ON DELETE CASCADE;


--
-- Name: privacy_requests privacy_requests_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.privacy_requests
    ADD CONSTRAINT privacy_requests_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: promotions promotions_coupon_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.promotions
    ADD CONSTRAINT promotions_coupon_id_fkey FOREIGN KEY (coupon_id) REFERENCES public.coupons(id) ON DELETE CASCADE;


--
-- Name: push_subscriptions push_subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.push_subscriptions
    ADD CONSTRAINT push_subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: reconciliation_exceptions reconciliation_exceptions_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reconciliation_exceptions
    ADD CONSTRAINT reconciliation_exceptions_run_id_fkey FOREIGN KEY (run_id) REFERENCES public.reconciliation_runs(id) ON DELETE SET NULL;


--
-- Name: refunds refunds_payment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refunds
    ADD CONSTRAINT refunds_payment_id_fkey FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE SET NULL;


--
-- Name: reminder_log reminder_log_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: reminder_log reminder_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reminder_log
    ADD CONSTRAINT reminder_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE CASCADE;


--
-- Name: submission_sessions submission_sessions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_sessions
    ADD CONSTRAINT submission_sessions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: subscription_credits subscription_credits_subscription_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES public.subscriptions(id) ON DELETE CASCADE;


--
-- Name: subscription_credits subscription_credits_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscription_credits
    ADD CONSTRAINT subscription_credits_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_profiles user_profiles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_profiles
    ADD CONSTRAINT user_profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_granted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: user_roles user_roles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE RESTRICT;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: users users_status_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_status_changed_by_fkey FOREIGN KEY (status_changed_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: visa_requirement_bootstrap_skips visa_requirement_bootstrap_skips_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_requirement_bootstrap_skips
    ADD CONSTRAINT visa_requirement_bootstrap_skips_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE CASCADE;


--
-- Name: visa_requirements visa_requirements_source_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_requirements
    ADD CONSTRAINT visa_requirements_source_version_id_fkey FOREIGN KEY (source_version_id) REFERENCES public.visa_source_versions(id) ON DELETE RESTRICT;


--
-- Name: visa_requirements visa_requirements_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_requirements
    ADD CONSTRAINT visa_requirements_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE CASCADE;


--
-- Name: visa_source_changes visa_source_changes_from_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_changes
    ADD CONSTRAINT visa_source_changes_from_version_id_fkey FOREIGN KEY (from_version_id) REFERENCES public.visa_source_versions(id) ON DELETE SET NULL;


--
-- Name: visa_source_changes visa_source_changes_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_changes
    ADD CONSTRAINT visa_source_changes_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;


--
-- Name: visa_source_changes visa_source_changes_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_changes
    ADD CONSTRAINT visa_source_changes_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.visa_sources(id) ON DELETE CASCADE;


--
-- Name: visa_source_changes visa_source_changes_to_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_changes
    ADD CONSTRAINT visa_source_changes_to_version_id_fkey FOREIGN KEY (to_version_id) REFERENCES public.visa_source_versions(id) ON DELETE CASCADE;


--
-- Name: visa_source_checks visa_source_checks_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_checks
    ADD CONSTRAINT visa_source_checks_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.visa_sources(id) ON DELETE CASCADE;


--
-- Name: visa_source_checks visa_source_checks_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_checks
    ADD CONSTRAINT visa_source_checks_version_id_fkey FOREIGN KEY (version_id) REFERENCES public.visa_source_versions(id) ON DELETE SET NULL;


--
-- Name: visa_source_versions visa_source_versions_blob_sha256_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_versions
    ADD CONSTRAINT visa_source_versions_blob_sha256_fkey FOREIGN KEY (blob_sha256) REFERENCES public.kb_blobs(sha256) ON DELETE SET NULL;


--
-- Name: visa_source_versions visa_source_versions_source_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_versions
    ADD CONSTRAINT visa_source_versions_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.visa_sources(id) ON DELETE CASCADE;


--
-- Name: visa_source_versions visa_source_versions_superseded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_source_versions
    ADD CONSTRAINT visa_source_versions_superseded_by_fkey FOREIGN KEY (superseded_by) REFERENCES public.visa_source_versions(id) ON DELETE SET NULL;


--
-- Name: visa_sources visa_sources_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_sources
    ADD CONSTRAINT visa_sources_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.visa_countries(id) ON DELETE CASCADE;


--
-- Name: visa_sources visa_sources_visa_type_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_sources
    ADD CONSTRAINT visa_sources_visa_type_id_fkey FOREIGN KEY (visa_type_id) REFERENCES public.visa_types(id) ON DELETE CASCADE;


--
-- Name: visa_types visa_types_country_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.visa_types
    ADD CONSTRAINT visa_types_country_id_fkey FOREIGN KEY (country_id) REFERENCES public.visa_countries(id) ON DELETE CASCADE;


--
-- Name: voice_consents voice_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_consents
    ADD CONSTRAINT voice_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: voice_messages voice_messages_conversation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_messages
    ADD CONSTRAINT voice_messages_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE;


--
-- Name: voice_messages voice_messages_message_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_messages
    ADD CONSTRAINT voice_messages_message_id_fkey FOREIGN KEY (message_id) REFERENCES public.messages(id) ON DELETE CASCADE;


--
-- Name: voice_sessions voice_sessions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: voice_sessions voice_sessions_escalated_to_consultation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_escalated_to_consultation_id_fkey FOREIGN KEY (escalated_to_consultation_id) REFERENCES public.consultations(id) ON DELETE SET NULL;


--
-- Name: voice_sessions voice_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_sessions
    ADD CONSTRAINT voice_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: voice_transcript_turns voice_transcript_turns_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_transcript_turns
    ADD CONSTRAINT voice_transcript_turns_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.voice_sessions(id) ON DELETE CASCADE;


--
-- Name: voice_transcript_turns voice_transcript_turns_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.voice_transcript_turns
    ADD CONSTRAINT voice_transcript_turns_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: vri_recommendations vri_recommendations_vri_score_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vri_recommendations
    ADD CONSTRAINT vri_recommendations_vri_score_id_fkey FOREIGN KEY (vri_score_id) REFERENCES public.vri_scores(id) ON DELETE CASCADE;


--
-- Name: vri_scores vri_scores_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vri_scores
    ADD CONSTRAINT vri_scores_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: vri_visa_suggestions vri_visa_suggestions_vri_score_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.vri_visa_suggestions
    ADD CONSTRAINT vri_visa_suggestions_vri_score_id_fkey FOREIGN KEY (vri_score_id) REFERENCES public.vri_scores(id) ON DELETE CASCADE;


--
-- Name: document_access_logs access_logs_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY access_logs_own_rows ON public.document_access_logs FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: account_lockouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.account_lockouts ENABLE ROW LEVEL SECURITY;

--
-- Name: action_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.action_items ENABLE ROW LEVEL SECURITY;

--
-- Name: action_items action_items_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY action_items_own_rows ON public.action_items USING ((( SELECT auth.uid() AS uid) = ( SELECT a.user_id
   FROM (public.post_submission_events e
     JOIN public.applications a ON ((a.id = e.application_id)))
  WHERE (e.id = action_items.post_submission_event_id))));


--
-- Name: addon_purchases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.addon_purchases ENABLE ROW LEVEL SECURITY;

--
-- Name: addon_purchases addon_purchases_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY addon_purchases_own_read ON public.addon_purchases FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: ai_usage_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ai_usage_events ai_usage_events_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_usage_events_admin_read ON public.ai_usage_events FOR SELECT USING (public.is_pricing_admin());


--
-- Name: ai_usage_events ai_usage_events_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ai_usage_events_owner_read ON public.ai_usage_events FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: analytics_alert_event; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_alert_event ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_alert_rule; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_alert_rule ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_daily_active; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_daily_active ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_daily_active analytics_daily_active_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_daily_active_admin_read ON public.analytics_daily_active FOR SELECT USING (public.is_analytics_admin());


--
-- Name: analytics_event_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_daily analytics_event_daily_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_event_daily_admin_read ON public.analytics_event_daily FOR SELECT USING (public.is_analytics_admin());


--
-- Name: analytics_event_stream; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_stream ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_stream_202607; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_stream_202607 ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_stream_202608; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_stream_202608 ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_stream_202609; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_stream_202609 ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_stream_202610; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_stream_202610 ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_stream_202611; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_stream_202611 ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_stream_202612; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_event_stream_202612 ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_event_stream analytics_event_stream_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_event_stream_admin_read ON public.analytics_event_stream FOR SELECT USING (public.is_analytics_admin());


--
-- Name: analytics_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_events analytics_events_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_events_insert_own ON public.analytics_events FOR INSERT WITH CHECK (((user_id IS NULL) OR (( SELECT auth.uid() AS uid) = user_id)));


--
-- Name: analytics_events analytics_events_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY analytics_events_select_own ON public.analytics_events FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: analytics_identity_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_identity_map ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_report_run; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_report_run ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_saved_report; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_saved_report ENABLE ROW LEVEL SECURITY;

--
-- Name: analytics_scheduled_report; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.analytics_scheduled_report ENABLE ROW LEVEL SECURITY;

--
-- Name: application_item_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.application_item_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: application_item_reviews application_item_reviews_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY application_item_reviews_select ON public.application_item_reviews FOR SELECT USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, auth.uid()) OR (auth.uid() = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = application_item_reviews.application_id)))));


--
-- Name: application_outcomes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.application_outcomes ENABLE ROW LEVEL SECURITY;

--
-- Name: application_outcomes application_outcomes_insert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY application_outcomes_insert_own ON public.application_outcomes FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: application_outcomes application_outcomes_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY application_outcomes_select_own ON public.application_outcomes FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: application_outcomes application_outcomes_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY application_outcomes_update_own ON public.application_outcomes FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: application_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.application_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

--
-- Name: applications applications_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY applications_own_rows ON public.applications USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: applications applications_owner_consultant_admin_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY applications_owner_consultant_admin_select ON public.applications FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(id, ( SELECT auth.uid() AS uid)) OR ((NOT public.app_has_active_consultant(id)) AND public.consultant_covers_country(( SELECT auth.uid() AS uid), destination_country))));


--
-- Name: applications applications_owner_consultant_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY applications_owner_consultant_admin_update ON public.applications FOR UPDATE USING (((( SELECT auth.uid() AS uid) = user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(id, ( SELECT auth.uid() AS uid))));


--
-- Name: audit_chain_state; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_chain_state ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_events audit_events_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_events_owner_read ON public.audit_events FOR SELECT USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = audit_events.application_id))));


--
-- Name: auth_audit_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auth_audit_log ENABLE ROW LEVEL SECURITY;

--
-- Name: beta_cohort_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beta_cohort_members ENABLE ROW LEVEL SECURITY;

--
-- Name: beta_cohort_members beta_cohort_members_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY beta_cohort_members_self_read ON public.beta_cohort_members FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: beta_cohorts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beta_cohorts ENABLE ROW LEVEL SECURITY;

--
-- Name: beta_feedback; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.beta_feedback ENABLE ROW LEVEL SECURITY;

--
-- Name: beta_feedback beta_feedback_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY beta_feedback_self_insert ON public.beta_feedback FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: beta_feedback beta_feedback_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY beta_feedback_self_read ON public.beta_feedback FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: checklist_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;

--
-- Name: checklist_items checklist_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY checklist_own_rows ON public.checklist_items USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = checklist_items.application_id))));


--
-- Name: consultant_commission_rules commission_rules_admin_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY commission_rules_admin_all ON public.consultant_commission_rules USING (public.is_marketplace_admin()) WITH CHECK (public.is_marketplace_admin());


--
-- Name: consultant_approvals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_approvals ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_approvals consultant_approvals_assigned_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_approvals_assigned_insert ON public.consultant_approvals FOR INSERT WITH CHECK (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR ((( SELECT auth.uid() AS uid) = consultant_id) AND (EXISTS ( SELECT 1
   FROM public.consultant_assignments a
  WHERE ((a.application_id = consultant_approvals.application_id) AND (a.consultant_id = ( SELECT auth.uid() AS uid)) AND (a.status = 'active'::text)))))));


--
-- Name: consultant_approvals consultant_approvals_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_approvals_owner_read ON public.consultant_approvals FOR SELECT USING (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = consultant_approvals.application_id))) OR (( SELECT auth.uid() AS uid) = consultant_id)));


--
-- Name: consultant_assignments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_assignments ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_assignments consultant_assignments_owner_admin_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_assignments_owner_admin_insert ON public.consultant_assignments FOR INSERT WITH CHECK (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = consultant_assignments.application_id)))));


--
-- Name: consultant_assignments consultant_assignments_owner_admin_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_assignments_owner_admin_update ON public.consultant_assignments FOR UPDATE USING (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = consultant_assignments.application_id)))));


--
-- Name: consultant_assignments consultant_assignments_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_assignments_owner_read ON public.consultant_assignments FOR SELECT USING (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = consultant_assignments.application_id))) OR (( SELECT auth.uid() AS uid) = consultant_id)));


--
-- Name: consultant_assignments consultant_assignments_self_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_assignments_self_insert ON public.consultant_assignments FOR INSERT WITH CHECK (((( SELECT auth.uid() AS uid) = consultant_id) AND (status = 'active'::text) AND (NOT public.app_has_active_consultant(application_id)) AND public.consultant_covers_country(( SELECT auth.uid() AS uid), public.app_destination_country(application_id))));


--
-- Name: consultant_availability; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_availability ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_availability consultant_availability_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_availability_owner_write ON public.consultant_availability USING ((EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultant_availability.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultant_availability.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: consultant_availability consultant_availability_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_availability_read ON public.consultant_availability FOR SELECT USING (true);


--
-- Name: consultant_commission_rules; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_commission_rules ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_countries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_countries ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_countries consultant_countries_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_countries_admin_write ON public.consultant_countries USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)) WITH CHECK ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: consultant_countries consultant_countries_self_or_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_countries_self_or_admin_read ON public.consultant_countries FOR SELECT USING (((( SELECT auth.uid() AS uid) = consultant_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));


--
-- Name: consultant_notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_notes ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_notes consultant_notes_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_notes_staff_insert ON public.consultant_notes FOR INSERT WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid)))));


--
-- Name: consultant_notes consultant_notes_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_notes_staff_select ON public.consultant_notes FOR SELECT USING (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: consultant_notes consultant_notes_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_notes_staff_update ON public.consultant_notes FOR UPDATE USING (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid)))) WITH CHECK (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: consultant_payout_items; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_payout_items ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_payout_items consultant_payout_items_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_payout_items_read ON public.consultant_payout_items FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.consultant_payouts p
     JOIN public.consultant_profiles cp ON ((cp.id = p.consultant_id)))
  WHERE ((p.id = consultant_payout_items.payout_id) AND ((cp.user_id = ( SELECT auth.uid() AS uid)) OR public.is_marketplace_admin())))));


--
-- Name: consultant_payouts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_payouts ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_payouts consultant_payouts_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_payouts_owner_read ON public.consultant_payouts FOR SELECT USING (((EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultant_payouts.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid))))) OR public.is_marketplace_admin()));


--
-- Name: consultant_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_profiles consultant_profiles_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_profiles_admin_write ON public.consultant_profiles USING (public.is_marketplace_admin()) WITH CHECK (public.is_marketplace_admin());


--
-- Name: consultant_profiles consultant_profiles_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_profiles_owner_write ON public.consultant_profiles USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: consultant_profiles consultant_profiles_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_profiles_public_read ON public.consultant_profiles FOR SELECT USING (((active_status = 'active'::text) OR (( SELECT auth.uid() AS uid) = user_id) OR public.is_marketplace_admin()));


--
-- Name: consultant_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_reviews consultant_reviews_author_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_reviews_author_update ON public.consultant_reviews FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: consultant_reviews consultant_reviews_author_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_reviews_author_write ON public.consultant_reviews FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: consultant_reviews consultant_reviews_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_reviews_read ON public.consultant_reviews FOR SELECT USING (true);


--
-- Name: consultant_service_orders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_service_orders ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_skills; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_skills ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_skills consultant_skills_owner_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_skills_owner_write ON public.consultant_skills USING ((EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultant_skills.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid)))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultant_skills.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: consultant_skills consultant_skills_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_skills_read ON public.consultant_skills FOR SELECT USING (true);


--
-- Name: consultant_tax_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultant_tax_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: consultant_tax_profiles consultant_tax_profiles_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultant_tax_profiles_owner_read ON public.consultant_tax_profiles FOR SELECT USING ((consultant_id IN ( SELECT consultant_profiles.id
   FROM public.consultant_profiles
  WHERE (consultant_profiles.user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: consultations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;

--
-- Name: consultations consultations_applicant_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultations_applicant_insert ON public.consultations FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: consultations consultations_participant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultations_participant_read ON public.consultations FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultations.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid))))) OR public.is_marketplace_admin()));


--
-- Name: consultations consultations_participant_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY consultations_participant_write ON public.consultations FOR UPDATE USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultations.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid))))))) WITH CHECK (true);


--
-- Name: consumed_readback_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.consumed_readback_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: conversation_participants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

--
-- Name: conversations conversations_access_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_access_insert ON public.conversations FOR INSERT WITH CHECK (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = conversations.application_id))) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: conversations conversations_access_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_access_select ON public.conversations FOR SELECT USING (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = conversations.application_id))) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: conversations conversations_access_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY conversations_access_update ON public.conversations FOR UPDATE USING (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = conversations.application_id))) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid)))) WITH CHECK (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = conversations.application_id))) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: pricing_country_factors country_factors_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY country_factors_admin_write ON public.pricing_country_factors USING (public.is_pricing_admin()) WITH CHECK (public.is_pricing_admin());


--
-- Name: pricing_country_factors country_factors_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY country_factors_read ON public.pricing_country_factors FOR SELECT USING (true);


--
-- Name: country_frameworks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.country_frameworks ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;

--
-- Name: coupons coupons_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_admin_write ON public.coupons USING (public.is_pricing_admin()) WITH CHECK (public.is_pricing_admin());


--
-- Name: coupons coupons_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY coupons_public_read ON public.coupons FOR SELECT USING ((active = true));


--
-- Name: cross_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cross_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: cross_verifications cross_verifications_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cross_verifications_own_rows ON public.cross_verifications USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = cross_verifications.application_id))));


--
-- Name: device_push_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.device_push_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: device_push_tokens device_push_tokens_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY device_push_tokens_owner_all ON public.device_push_tokens USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: discount_redemptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discount_redemptions ENABLE ROW LEVEL SECURITY;

--
-- Name: discount_redemptions discount_redemptions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discount_redemptions_admin_read ON public.discount_redemptions FOR SELECT USING (public.is_pricing_admin());


--
-- Name: document_verifications doc_verifications_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY doc_verifications_own_rows ON public.document_verifications USING ((( SELECT auth.uid() AS uid) = ( SELECT a.user_id
   FROM (public.documents d
     JOIN public.applications a ON ((a.id = d.application_id)))
  WHERE (d.id = document_verifications.document_id))));


--
-- Name: document_access_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_access_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: document_holder_confirmations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_holder_confirmations ENABLE ROW LEVEL SECURITY;

--
-- Name: document_holder_confirmations document_holder_confirmations_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_holder_confirmations_select ON public.document_holder_confirmations FOR SELECT USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, auth.uid()) OR (auth.uid() = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = document_holder_confirmations.application_id)))));


--
-- Name: document_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: document_requests document_requests_access_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_requests_access_select ON public.document_requests FOR SELECT USING (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = document_requests.application_id))) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: document_requests document_requests_consultant_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_requests_consultant_insert ON public.document_requests FOR INSERT WITH CHECK (((requested_by = ( SELECT auth.uid() AS uid)) AND ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid)))));


--
-- Name: document_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: document_templates document_templates_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_templates_authenticated_read ON public.document_templates FOR SELECT TO authenticated USING (true);


--
-- Name: document_translations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_translations ENABLE ROW LEVEL SECURITY;

--
-- Name: document_translations document_translations_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY document_translations_owner_read ON public.document_translations FOR SELECT USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = document_translations.application_id))));


--
-- Name: document_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.document_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: documents documents_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_own_rows ON public.documents USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = documents.application_id))));


--
-- Name: escalation_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escalation_history ENABLE ROW LEVEL SECURITY;

--
-- Name: escalation_history escalation_staff_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escalation_staff_insert ON public.escalation_history FOR INSERT WITH CHECK (((escalated_by = ( SELECT auth.uid() AS uid)) AND ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid)))));


--
-- Name: escalation_history escalation_staff_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escalation_staff_select ON public.escalation_history FOR SELECT USING (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: escalation_history escalation_staff_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escalation_staff_update ON public.escalation_history FOR UPDATE USING (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid)))) WITH CHECK (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, ( SELECT auth.uid() AS uid))));


--
-- Name: escalation_thresholds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.escalation_thresholds ENABLE ROW LEVEL SECURITY;

--
-- Name: escalation_thresholds escalation_thresholds_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escalation_thresholds_admin_read ON public.escalation_thresholds FOR SELECT USING (public.is_risk_admin());


--
-- Name: escalation_thresholds escalation_thresholds_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY escalation_thresholds_admin_write ON public.escalation_thresholds USING (public.is_risk_admin()) WITH CHECK (public.is_risk_admin());


--
-- Name: post_submission_events events_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY events_own_rows ON public.post_submission_events USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = post_submission_events.application_id))));


--
-- Name: evidence_packages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.evidence_packages ENABLE ROW LEVEL SECURITY;

--
-- Name: evidence_packages evidence_packages_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY evidence_packages_owner_read ON public.evidence_packages FOR SELECT USING (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = evidence_packages.application_id))) OR (( SELECT auth.uid() AS uid) = consultant_id)));


--
-- Name: feature_flag_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_flag_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: feature_flags; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

--
-- Name: field_provenance; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_provenance ENABLE ROW LEVEL SECURITY;

--
-- Name: field_provenance field_provenance_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_provenance_owner_read ON public.field_provenance FOR SELECT USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = field_provenance.application_id))));


--
-- Name: field_verifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.field_verifications ENABLE ROW LEVEL SECURITY;

--
-- Name: field_verifications field_verifications_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY field_verifications_owner_read ON public.field_verifications FOR SELECT USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = field_verifications.application_id))));


--
-- Name: form_template_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.form_template_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: form_template_versions form_template_versions_service_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY form_template_versions_service_all ON public.form_template_versions TO service_role USING (true) WITH CHECK (true);


--
-- Name: form_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: form_templates form_templates_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY form_templates_authenticated_read ON public.form_templates FOR SELECT TO authenticated USING (true);


--
-- Name: country_frameworks frameworks_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY frameworks_public_read ON public.country_frameworks FOR SELECT USING (true);


--
-- Name: generated_documents gen_docs_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY gen_docs_own_rows ON public.generated_documents USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = generated_documents.application_id))));


--
-- Name: generated_document_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_document_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: generated_document_revisions generated_document_revisions_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY generated_document_revisions_select ON public.generated_document_revisions FOR SELECT USING (((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(application_id, auth.uid()) OR (auth.uid() = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = generated_document_revisions.application_id)))));


--
-- Name: generated_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: intake_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intake_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: intake_messages intake_messages_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intake_messages_own_rows ON public.intake_messages USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = intake_messages.application_id))));


--
-- Name: kb_answer_citations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_answer_citations ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_answer_citations kb_answer_citations_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_answer_citations_own_read ON public.kb_answer_citations FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.kb_retrieval_logs l
  WHERE ((l.id = kb_answer_citations.retrieval_id) AND (l.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: kb_blobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_blobs ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_blobs kb_blobs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_blobs_read ON public.kb_blobs FOR SELECT TO authenticated USING (true);


--
-- Name: kb_chunk_scopes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_chunk_scopes ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_chunk_scopes kb_chunk_scopes_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_chunk_scopes_read ON public.kb_chunk_scopes FOR SELECT TO anon, authenticated USING (true);


--
-- Name: kb_chunk_texts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_chunk_texts ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_chunk_texts kb_chunk_texts_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_chunk_texts_read ON public.kb_chunk_texts FOR SELECT TO anon, authenticated USING (true);


--
-- Name: kb_chunks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_chunks ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_chunks kb_chunks_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_chunks_public_read ON public.kb_chunks FOR SELECT TO anon USING ((status = 'current'::text));


--
-- Name: kb_chunks kb_chunks_staff_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_chunks_staff_read ON public.kb_chunks FOR SELECT TO authenticated USING (true);


--
-- Name: kb_embeddings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_embeddings ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_extractions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_extractions ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_extractions kb_extractions_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_extractions_read ON public.kb_extractions FOR SELECT TO authenticated USING (true);


--
-- Name: kb_freshness_policies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_freshness_policies ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_freshness_policies kb_freshness_policies_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_freshness_policies_read ON public.kb_freshness_policies FOR SELECT TO authenticated USING (true);


--
-- Name: kb_ingestion_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_ingestion_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_ingestion_jobs kb_ingestion_jobs_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_ingestion_jobs_read ON public.kb_ingestion_jobs FOR SELECT TO authenticated USING (true);


--
-- Name: kb_quarantine; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_quarantine ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_quarantine kb_quarantine_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_quarantine_read ON public.kb_quarantine FOR SELECT TO authenticated USING (true);


--
-- Name: kb_retrieval_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_retrieval_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_retrieval_logs kb_retrieval_logs_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_retrieval_logs_own_read ON public.kb_retrieval_logs FOR SELECT TO authenticated USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: kb_review_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_review_queue kb_review_queue_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_review_queue_read ON public.kb_review_queue FOR SELECT TO authenticated USING (true);


--
-- Name: kb_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: kb_sections kb_sections_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY kb_sections_read ON public.kb_sections FOR SELECT TO authenticated USING (true);


--
-- Name: kpi_funnel_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_funnel_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_metric_daily; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_metric_daily ENABLE ROW LEVEL SECURITY;

--
-- Name: kpi_retention_cohort; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kpi_retention_cohort ENABLE ROW LEVEL SECURITY;

--
-- Name: login_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.login_history ENABLE ROW LEVEL SECURITY;

--
-- Name: login_history login_history_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY login_history_owner_read ON public.login_history FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));


--
-- Name: marketing_attribution; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketing_attribution ENABLE ROW LEVEL SECURITY;

--
-- Name: marketing_attribution marketing_attribution_select_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketing_attribution_select_own ON public.marketing_attribution FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: marketing_attribution marketing_attribution_update_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketing_attribution_update_own ON public.marketing_attribution FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: marketing_attribution marketing_attribution_upsert_own; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketing_attribution_upsert_own ON public.marketing_attribution FOR INSERT WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: message_attachments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

--
-- Name: message_attachments message_attachments_access_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_attachments_access_insert ON public.message_attachments FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = message_attachments.conversation_id) AND ((( SELECT auth.uid() AS uid) = app.user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(app.id, ( SELECT auth.uid() AS uid)))))));


--
-- Name: message_attachments message_attachments_access_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY message_attachments_access_select ON public.message_attachments FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = message_attachments.conversation_id) AND ((( SELECT auth.uid() AS uid) = app.user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(app.id, ( SELECT auth.uid() AS uid)))))));


--
-- Name: messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: messages messages_access_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_access_insert ON public.messages FOR INSERT WITH CHECK (((sender_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = messages.conversation_id) AND ((( SELECT auth.uid() AS uid) = app.user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(app.id, ( SELECT auth.uid() AS uid))))))));


--
-- Name: messages messages_access_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY messages_access_select ON public.messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = messages.conversation_id) AND ((( SELECT auth.uid() AS uid) = app.user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(app.id, ( SELECT auth.uid() AS uid)))))));


--
-- Name: notification_broadcasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_broadcasts ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_deliveries notification_deliveries_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_deliveries_own_select ON public.notification_deliveries FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: notification_outbox; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

--
-- Name: notification_preferences notification_preferences_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notification_preferences_owner_all ON public.notification_preferences USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: notification_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: notifications notifications_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_own_select ON public.notifications FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: notifications notifications_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notifications_own_update ON public.notifications FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: ocr_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ocr_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: ocr_runs ocr_runs_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY ocr_runs_owner_read ON public.ocr_runs FOR SELECT USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = ocr_runs.application_id))));


--
-- Name: ops_agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_experiments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_experiments ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_marketing_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_marketing_events ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_products; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_products ENABLE ROW LEVEL SECURITY;

--
-- Name: ops_revenue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ops_revenue ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_invitations organization_invitations_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_invitations_member_read ON public.organization_invitations FOR SELECT USING (((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = organization_invitations.organization_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text))))));


--
-- Name: organization_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

--
-- Name: organization_members organization_members_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organization_members_self_read ON public.organization_members FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_member_read ON public.organizations FOR SELECT USING (((( SELECT auth.uid() AS uid) = owner_user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR (EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = organizations.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text))))));


--
-- Name: conversation_participants participants_own_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_own_select ON public.conversation_participants FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: conversation_participants participants_own_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY participants_own_update ON public.conversation_participants FOR UPDATE USING ((( SELECT auth.uid() AS uid) = user_id)) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: partner_access_tokens; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_access_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_api_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_api_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_api_keys partner_api_keys_org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partner_api_keys_org_member_read ON public.partner_api_keys FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.partner_applications a
     JOIN public.partners p ON ((p.id = a.partner_id)))
     JOIN public.organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((a.id = partner_api_keys.application_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text)))));


--
-- Name: partner_api_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_api_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_api_requests partner_api_requests_org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partner_api_requests_org_member_read ON public.partner_api_requests FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.partner_applications a
     JOIN public.partners p ON ((p.id = a.partner_id)))
     JOIN public.organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((a.id = partner_api_requests.application_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text)))));


--
-- Name: partner_applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_applications partner_applications_org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partner_applications_org_member_read ON public.partner_applications FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.partners p
     JOIN public.organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((p.id = partner_applications.partner_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text)))));


--
-- Name: partner_authorization_codes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_authorization_codes ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_events ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_idempotency_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_idempotency_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_sandbox_resources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_sandbox_resources ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_usage_counters; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_usage_counters ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_user_consents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_user_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_user_consents partner_user_consents_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partner_user_consents_owner_read ON public.partner_user_consents FOR SELECT USING ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: partner_user_consents partner_user_consents_owner_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partner_user_consents_owner_update ON public.partner_user_consents FOR UPDATE USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: partner_webhook_deliveries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_webhook_deliveries ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_webhook_deliveries partner_webhook_deliveries_org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partner_webhook_deliveries_org_member_read ON public.partner_webhook_deliveries FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (((public.partner_webhook_endpoints e
     JOIN public.partner_applications a ON ((a.id = e.application_id)))
     JOIN public.partners p ON ((p.id = a.partner_id)))
     JOIN public.organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((e.id = partner_webhook_deliveries.endpoint_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text)))));


--
-- Name: partner_webhook_endpoints; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partner_webhook_endpoints ENABLE ROW LEVEL SECURITY;

--
-- Name: partner_webhook_endpoints partner_webhook_endpoints_org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partner_webhook_endpoints_org_member_read ON public.partner_webhook_endpoints FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.partner_applications a
     JOIN public.partners p ON ((p.id = a.partner_id)))
     JOIN public.organization_members m ON ((m.organization_id = p.organization_id)))
  WHERE ((a.id = partner_webhook_endpoints.application_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text)))));


--
-- Name: partners; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;

--
-- Name: partners partners_org_member_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY partners_org_member_read ON public.partners FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.organization_members m
  WHERE ((m.organization_id = partners.organization_id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.status = 'active'::text)))));


--
-- Name: payment_disputes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_disputes ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_disputes payment_disputes_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_disputes_admin_read ON public.payment_disputes FOR SELECT USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: payment_dunning; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_dunning ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_dunning payment_dunning_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_dunning_admin_read ON public.payment_dunning FOR SELECT USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: payment_event_processing; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_event_processing ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payment_events ENABLE ROW LEVEL SECURITY;

--
-- Name: payment_events payment_events_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payment_events_admin_read ON public.payment_events FOR SELECT USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: payments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

--
-- Name: payments payments_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_own_read ON public.payments FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: payments payments_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payments_own_rows ON public.payments USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: payout_tax_statements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.payout_tax_statements ENABLE ROW LEVEL SECURITY;

--
-- Name: payout_tax_statements payout_tax_statements_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payout_tax_statements_admin_read ON public.payout_tax_statements FOR SELECT USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: payout_tax_statements payout_tax_statements_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY payout_tax_statements_owner_read ON public.payout_tax_statements FOR SELECT USING ((consultant_id IN ( SELECT consultant_profiles.id
   FROM public.consultant_profiles
  WHERE (consultant_profiles.user_id = ( SELECT auth.uid() AS uid)))));


--
-- Name: permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: permissions permissions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY permissions_public_read ON public.permissions FOR SELECT USING (true);


--
-- Name: post_submission_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.post_submission_events ENABLE ROW LEVEL SECURITY;

--
-- Name: preflight_reviews; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.preflight_reviews ENABLE ROW LEVEL SECURITY;

--
-- Name: preflight_reviews preflight_reviews_owner_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY preflight_reviews_owner_read ON public.preflight_reviews FOR SELECT USING (((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = preflight_reviews.application_id))) OR (( SELECT auth.uid() AS uid) = reviewer_id)));


--
-- Name: pricing_constants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_constants ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_constants pricing_constants_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pricing_constants_admin_write ON public.pricing_constants USING (public.is_pricing_admin()) WITH CHECK (public.is_pricing_admin());


--
-- Name: pricing_constants pricing_constants_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pricing_constants_read ON public.pricing_constants FOR SELECT USING (true);


--
-- Name: pricing_country_factors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_country_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_quote_audit; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_quote_audit ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_quotes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_quotes ENABLE ROW LEVEL SECURITY;

--
-- Name: pricing_visa_tiers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pricing_visa_tiers ENABLE ROW LEVEL SECURITY;

--
-- Name: privacy_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.privacy_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: application_profiles profiles_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_own_rows ON public.application_profiles USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = application_profiles.application_id))));


--
-- Name: promotions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.promotions ENABLE ROW LEVEL SECURITY;

--
-- Name: promotions promotions_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promotions_admin_write ON public.promotions USING (public.is_pricing_admin()) WITH CHECK (public.is_pricing_admin());


--
-- Name: promotions promotions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY promotions_public_read ON public.promotions FOR SELECT USING ((active = true));


--
-- Name: push_subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: push_subscriptions push_subscriptions_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY push_subscriptions_owner_all ON public.push_subscriptions USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: pricing_quote_audit quote_audit_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quote_audit_admin_read ON public.pricing_quote_audit FOR SELECT USING (public.is_pricing_admin());


--
-- Name: pricing_quotes quotes_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY quotes_read ON public.pricing_quotes FOR SELECT TO authenticated USING (true);


--
-- Name: reconciliation_exceptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reconciliation_exceptions ENABLE ROW LEVEL SECURITY;

--
-- Name: reconciliation_exceptions reconciliation_exceptions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reconciliation_exceptions_admin_read ON public.reconciliation_exceptions FOR SELECT USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: reconciliation_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reconciliation_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: reconciliation_runs reconciliation_runs_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reconciliation_runs_admin_read ON public.reconciliation_runs FOR SELECT USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: refunds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

--
-- Name: refunds refunds_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY refunds_admin_read ON public.refunds FOR SELECT USING ((((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: reminder_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reminder_log ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_weights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.risk_weights ENABLE ROW LEVEL SECURITY;

--
-- Name: risk_weights risk_weights_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_weights_admin_read ON public.risk_weights FOR SELECT USING (public.is_risk_admin());


--
-- Name: risk_weights risk_weights_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY risk_weights_admin_write ON public.risk_weights USING (public.is_risk_admin()) WITH CHECK (public.is_risk_admin());


--
-- Name: role_permissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

--
-- Name: role_permissions role_permissions_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY role_permissions_public_read ON public.role_permissions FOR SELECT USING (true);


--
-- Name: roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

--
-- Name: roles roles_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roles_public_read ON public.roles FOR SELECT USING (true);


--
-- Name: consultant_service_orders service_orders_participant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_orders_participant_read ON public.consultant_service_orders FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR (EXISTS ( SELECT 1
   FROM public.consultant_profiles cp
  WHERE ((cp.id = consultant_service_orders.consultant_id) AND (cp.user_id = ( SELECT auth.uid() AS uid))))) OR public.is_marketplace_admin()));


--
-- Name: submission_sessions sessions_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sessions_own_rows ON public.submission_sessions USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = submission_sessions.application_id))));


--
-- Name: submission_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submission_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_credits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscription_credits ENABLE ROW LEVEL SECURITY;

--
-- Name: subscription_credits subscription_credits_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscription_credits_own_read ON public.subscription_credits FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_own_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_own_read ON public.subscriptions FOR SELECT USING ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: template_revisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.template_revisions ENABLE ROW LEVEL SECURITY;

--
-- Name: template_sweep_findings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.template_sweep_findings ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_profiles user_profiles_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_profiles_owner_all ON public.user_profiles USING (((( SELECT auth.uid() AS uid) = user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text))) WITH CHECK ((( SELECT auth.uid() AS uid) = user_id));


--
-- Name: user_roles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

--
-- Name: user_roles user_roles_self_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT USING (((( SELECT auth.uid() AS uid) = user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text)));


--
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- Name: users users_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY users_own_rows ON public.users USING ((( SELECT auth.uid() AS uid) = id));


--
-- Name: visa_countries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_countries ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_countries visa_countries_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_countries_public_read ON public.visa_countries FOR SELECT TO anon, authenticated USING (true);


--
-- Name: visa_requirement_bootstrap_skips; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_requirement_bootstrap_skips ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_requirements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_requirements ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_requirements visa_requirements_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_requirements_admin_read ON public.visa_requirements FOR SELECT TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: visa_requirements visa_requirements_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_requirements_public_read ON public.visa_requirements FOR SELECT TO anon, authenticated USING ((status = 'active'::text));


--
-- Name: visa_source_changes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_source_changes ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_source_changes visa_source_changes_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_source_changes_admin_read ON public.visa_source_changes FOR SELECT TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: visa_source_checks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_source_checks ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_source_checks visa_source_checks_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_source_checks_admin_read ON public.visa_source_checks FOR SELECT TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: visa_source_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_source_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_source_versions visa_source_versions_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_source_versions_admin_read ON public.visa_source_versions FOR SELECT TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: visa_sources; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_sources ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_sources visa_sources_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_sources_public_read ON public.visa_sources FOR SELECT TO anon, authenticated USING (active);


--
-- Name: visa_sync_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_sync_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_sync_runs visa_sync_runs_admin_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_sync_runs_admin_read ON public.visa_sync_runs FOR SELECT TO authenticated USING ((((auth.jwt() -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text));


--
-- Name: pricing_visa_tiers visa_tiers_admin_write; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_tiers_admin_write ON public.pricing_visa_tiers USING (public.is_pricing_admin()) WITH CHECK (public.is_pricing_admin());


--
-- Name: pricing_visa_tiers visa_tiers_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_tiers_read ON public.pricing_visa_tiers FOR SELECT USING (true);


--
-- Name: visa_types; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.visa_types ENABLE ROW LEVEL SECURITY;

--
-- Name: visa_types visa_types_public_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY visa_types_public_read ON public.visa_types FOR SELECT TO anon, authenticated USING (true);


--
-- Name: voice_consents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voice_consents ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_consents voice_consents_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_consents_owner_all ON public.voice_consents USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: voice_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voice_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_messages voice_messages_access_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_messages_access_insert ON public.voice_messages FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = voice_messages.conversation_id) AND ((( SELECT auth.uid() AS uid) = app.user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(app.id, ( SELECT auth.uid() AS uid)))))));


--
-- Name: voice_messages voice_messages_access_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_messages_access_select ON public.voice_messages FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.conversations c
     JOIN public.applications app ON ((app.id = c.application_id)))
  WHERE ((c.id = voice_messages.conversation_id) AND ((( SELECT auth.uid() AS uid) = app.user_id) OR (((( SELECT auth.jwt() AS jwt) -> 'app_metadata'::text) ->> 'role'::text) = 'admin'::text) OR public.is_active_assignee(app.id, ( SELECT auth.uid() AS uid)))))));


--
-- Name: voice_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voice_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_sessions voice_sessions_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_sessions_owner_all ON public.voice_sessions USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: voice_transcript_turns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.voice_transcript_turns ENABLE ROW LEVEL SECURITY;

--
-- Name: voice_transcript_turns voice_turns_owner_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_turns_owner_all ON public.voice_transcript_turns USING ((user_id = ( SELECT auth.uid() AS uid))) WITH CHECK ((user_id = ( SELECT auth.uid() AS uid)));


--
-- Name: voice_transcript_turns voice_turns_shared_consultant_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY voice_turns_shared_consultant_read ON public.voice_transcript_turns FOR SELECT USING ((EXISTS ( SELECT 1
   FROM ((public.voice_sessions vs
     JOIN public.consultations c ON ((c.id = vs.escalated_to_consultation_id)))
     JOIN public.consultant_profiles cp ON ((cp.id = c.consultant_id)))
  WHERE ((vs.id = voice_transcript_turns.session_id) AND (cp.user_id = ( SELECT auth.uid() AS uid))))));


--
-- Name: vri_recommendations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vri_recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: vri_recommendations vri_recs_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vri_recs_own_rows ON public.vri_recommendations USING ((( SELECT auth.uid() AS uid) = ( SELECT a.user_id
   FROM (public.vri_scores v
     JOIN public.applications a ON ((a.id = v.application_id)))
  WHERE (v.id = vri_recommendations.vri_score_id))));


--
-- Name: vri_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vri_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: vri_scores vri_scores_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vri_scores_own_rows ON public.vri_scores USING ((( SELECT auth.uid() AS uid) = ( SELECT applications.user_id
   FROM public.applications
  WHERE (applications.id = vri_scores.application_id))));


--
-- Name: vri_visa_suggestions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.vri_visa_suggestions ENABLE ROW LEVEL SECURITY;

--
-- Name: vri_visa_suggestions vri_visa_suggestions_own_rows; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY vri_visa_suggestions_own_rows ON public.vri_visa_suggestions USING ((( SELECT auth.uid() AS uid) = ( SELECT a.user_id
   FROM (public.vri_scores v
     JOIN public.applications a ON ((a.id = v.application_id)))
  WHERE (v.id = vri_visa_suggestions.vri_score_id))));


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: -
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- Name: FUNCTION app_destination_country(p_app uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_destination_country(p_app uuid) TO postgres;
GRANT ALL ON FUNCTION public.app_destination_country(p_app uuid) TO anon;
GRANT ALL ON FUNCTION public.app_destination_country(p_app uuid) TO authenticated;
GRANT ALL ON FUNCTION public.app_destination_country(p_app uuid) TO service_role;


--
-- Name: FUNCTION app_has_active_consultant(p_app uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.app_has_active_consultant(p_app uuid) TO postgres;
GRANT ALL ON FUNCTION public.app_has_active_consultant(p_app uuid) TO anon;
GRANT ALL ON FUNCTION public.app_has_active_consultant(p_app uuid) TO authenticated;
GRANT ALL ON FUNCTION public.app_has_active_consultant(p_app uuid) TO service_role;


--
-- Name: FUNCTION audit_no_mutate(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_no_mutate() FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_no_mutate() TO postgres;
GRANT ALL ON FUNCTION public.audit_no_mutate() TO service_role;


--
-- Name: FUNCTION audit_verify_chain(p_application_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.audit_verify_chain(p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.audit_verify_chain(p_application_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.audit_verify_chain(p_application_id uuid) TO service_role;


--
-- Name: FUNCTION bump_delivery_attempt(p_delivery_id uuid, p_status text, p_error text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.bump_delivery_attempt(p_delivery_id uuid, p_status text, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.bump_delivery_attempt(p_delivery_id uuid, p_status text, p_error text) TO postgres;
GRANT ALL ON FUNCTION public.bump_delivery_attempt(p_delivery_id uuid, p_status text, p_error text) TO service_role;


--
-- Name: TABLE notification_outbox; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_outbox TO postgres;
GRANT ALL ON TABLE public.notification_outbox TO anon;
GRANT ALL ON TABLE public.notification_outbox TO authenticated;
GRANT ALL ON TABLE public.notification_outbox TO service_role;


--
-- Name: FUNCTION claim_outbox_batch(p_limit integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_outbox_batch(p_limit integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_outbox_batch(p_limit integer) TO postgres;
GRANT ALL ON FUNCTION public.claim_outbox_batch(p_limit integer) TO service_role;


--
-- Name: FUNCTION claim_payment_webhook_event(p_provider text, p_event_type text, p_provider_event_id text, p_provider_object_id text, p_amount_minor bigint, p_currency text, p_direction text, p_user_id uuid, p_related_entity jsonb, p_occurred_at timestamp with time zone); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.claim_payment_webhook_event(p_provider text, p_event_type text, p_provider_event_id text, p_provider_object_id text, p_amount_minor bigint, p_currency text, p_direction text, p_user_id uuid, p_related_entity jsonb, p_occurred_at timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION public.claim_payment_webhook_event(p_provider text, p_event_type text, p_provider_event_id text, p_provider_object_id text, p_amount_minor bigint, p_currency text, p_direction text, p_user_id uuid, p_related_entity jsonb, p_occurred_at timestamp with time zone) TO postgres;
GRANT ALL ON FUNCTION public.claim_payment_webhook_event(p_provider text, p_event_type text, p_provider_event_id text, p_provider_object_id text, p_amount_minor bigint, p_currency text, p_direction text, p_user_id uuid, p_related_entity jsonb, p_occurred_at timestamp with time zone) TO service_role;


--
-- Name: FUNCTION cleanup_stale_anonymous_users(p_age interval); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.cleanup_stale_anonymous_users(p_age interval) TO postgres;
GRANT ALL ON FUNCTION public.cleanup_stale_anonymous_users(p_age interval) TO anon;
GRANT ALL ON FUNCTION public.cleanup_stale_anonymous_users(p_age interval) TO authenticated;
GRANT ALL ON FUNCTION public.cleanup_stale_anonymous_users(p_age interval) TO service_role;


--
-- Name: FUNCTION complete_payment_webhook_event(p_provider_event_id text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.complete_payment_webhook_event(p_provider_event_id text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.complete_payment_webhook_event(p_provider_event_id text) TO postgres;
GRANT ALL ON FUNCTION public.complete_payment_webhook_event(p_provider_event_id text) TO service_role;


--
-- Name: FUNCTION consultant_covers_country(p_uid uuid, p_country text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.consultant_covers_country(p_uid uuid, p_country text) TO postgres;
GRANT ALL ON FUNCTION public.consultant_covers_country(p_uid uuid, p_country text) TO anon;
GRANT ALL ON FUNCTION public.consultant_covers_country(p_uid uuid, p_country text) TO authenticated;
GRANT ALL ON FUNCTION public.consultant_covers_country(p_uid uuid, p_country text) TO service_role;


--
-- Name: FUNCTION consume_review_credit(p_user_id uuid, p_application_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.consume_review_credit(p_user_id uuid, p_application_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.consume_review_credit(p_user_id uuid, p_application_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.consume_review_credit(p_user_id uuid, p_application_id uuid) TO service_role;


--
-- Name: FUNCTION enforce_consultant_state_service_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_consultant_state_service_role() TO postgres;
GRANT ALL ON FUNCTION public.enforce_consultant_state_service_role() TO anon;
GRANT ALL ON FUNCTION public.enforce_consultant_state_service_role() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_consultant_state_service_role() TO service_role;


--
-- Name: FUNCTION enforce_user_status_service_role(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.enforce_user_status_service_role() TO postgres;
GRANT ALL ON FUNCTION public.enforce_user_status_service_role() TO anon;
GRANT ALL ON FUNCTION public.enforce_user_status_service_role() TO authenticated;
GRANT ALL ON FUNCTION public.enforce_user_status_service_role() TO service_role;


--
-- Name: FUNCTION enqueue_application_status_changed(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.enqueue_application_status_changed() FROM PUBLIC;
GRANT ALL ON FUNCTION public.enqueue_application_status_changed() TO postgres;
GRANT ALL ON FUNCTION public.enqueue_application_status_changed() TO service_role;


--
-- Name: FUNCTION ensure_month_partition(p_month date); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.ensure_month_partition(p_month date) TO postgres;
GRANT ALL ON FUNCTION public.ensure_month_partition(p_month date) TO anon;
GRANT ALL ON FUNCTION public.ensure_month_partition(p_month date) TO authenticated;
GRANT ALL ON FUNCTION public.ensure_month_partition(p_month date) TO service_role;


--
-- Name: FUNCTION fail_payment_webhook_event(p_provider_event_id text, p_error text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.fail_payment_webhook_event(p_provider_event_id text, p_error text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.fail_payment_webhook_event(p_provider_event_id text, p_error text) TO postgres;
GRANT ALL ON FUNCTION public.fail_payment_webhook_event(p_provider_event_id text, p_error text) TO service_role;


--
-- Name: TABLE field_provenance; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.field_provenance TO postgres;
GRANT ALL ON TABLE public.field_provenance TO anon;
GRANT ALL ON TABLE public.field_provenance TO authenticated;
GRANT ALL ON TABLE public.field_provenance TO service_role;


--
-- Name: FUNCTION field_provenance_create_version(p_application_id uuid, p_field_key text, p_origin text, p_value_snapshot text, p_value_hash text, p_source_document_id uuid, p_source_page integer, p_source_bbox jsonb, p_ocr_run_id uuid, p_confidence numeric, p_confidence_band text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.field_provenance_create_version(p_application_id uuid, p_field_key text, p_origin text, p_value_snapshot text, p_value_hash text, p_source_document_id uuid, p_source_page integer, p_source_bbox jsonb, p_ocr_run_id uuid, p_confidence numeric, p_confidence_band text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.field_provenance_create_version(p_application_id uuid, p_field_key text, p_origin text, p_value_snapshot text, p_value_hash text, p_source_document_id uuid, p_source_page integer, p_source_bbox jsonb, p_ocr_run_id uuid, p_confidence numeric, p_confidence_band text) TO postgres;
GRANT ALL ON FUNCTION public.field_provenance_create_version(p_application_id uuid, p_field_key text, p_origin text, p_value_snapshot text, p_value_hash text, p_source_document_id uuid, p_source_page integer, p_source_bbox jsonb, p_ocr_run_id uuid, p_confidence numeric, p_confidence_band text) TO service_role;


--
-- Name: FUNCTION field_provenance_lock(p_application_id uuid, p_field_key text); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.field_provenance_lock(p_application_id uuid, p_field_key text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.field_provenance_lock(p_application_id uuid, p_field_key text) TO postgres;
GRANT ALL ON FUNCTION public.field_provenance_lock(p_application_id uuid, p_field_key text) TO service_role;


--
-- Name: FUNCTION field_provenance_relink_chain(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.field_provenance_relink_chain() FROM PUBLIC;
GRANT ALL ON FUNCTION public.field_provenance_relink_chain() TO postgres;
GRANT ALL ON FUNCTION public.field_provenance_relink_chain() TO anon;
GRANT ALL ON FUNCTION public.field_provenance_relink_chain() TO authenticated;
GRANT ALL ON FUNCTION public.field_provenance_relink_chain() TO service_role;


--
-- Name: FUNCTION field_provenance_retire(p_application_id uuid, p_document_id uuid, p_keep text[]); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.field_provenance_retire(p_application_id uuid, p_document_id uuid, p_keep text[]) FROM PUBLIC;
GRANT ALL ON FUNCTION public.field_provenance_retire(p_application_id uuid, p_document_id uuid, p_keep text[]) TO postgres;
GRANT ALL ON FUNCTION public.field_provenance_retire(p_application_id uuid, p_document_id uuid, p_keep text[]) TO service_role;


--
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_new_user() TO postgres;
GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- Name: FUNCTION handle_user_identity_sync(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.handle_user_identity_sync() TO postgres;
GRANT ALL ON FUNCTION public.handle_user_identity_sync() TO anon;
GRANT ALL ON FUNCTION public.handle_user_identity_sync() TO authenticated;
GRANT ALL ON FUNCTION public.handle_user_identity_sync() TO service_role;


--
-- Name: FUNCTION increment_partner_usage(p_application_id uuid, p_window_kind text, p_window_start timestamp with time zone, p_delta bigint); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.increment_partner_usage(p_application_id uuid, p_window_kind text, p_window_start timestamp with time zone, p_delta bigint) TO postgres;
GRANT ALL ON FUNCTION public.increment_partner_usage(p_application_id uuid, p_window_kind text, p_window_start timestamp with time zone, p_delta bigint) TO anon;
GRANT ALL ON FUNCTION public.increment_partner_usage(p_application_id uuid, p_window_kind text, p_window_start timestamp with time zone, p_delta bigint) TO authenticated;
GRANT ALL ON FUNCTION public.increment_partner_usage(p_application_id uuid, p_window_kind text, p_window_start timestamp with time zone, p_delta bigint) TO service_role;


--
-- Name: FUNCTION is_active_assignee(p_app uuid, p_uid uuid); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_active_assignee(p_app uuid, p_uid uuid) TO postgres;
GRANT ALL ON FUNCTION public.is_active_assignee(p_app uuid, p_uid uuid) TO anon;
GRANT ALL ON FUNCTION public.is_active_assignee(p_app uuid, p_uid uuid) TO authenticated;
GRANT ALL ON FUNCTION public.is_active_assignee(p_app uuid, p_uid uuid) TO service_role;


--
-- Name: FUNCTION is_analytics_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_analytics_admin() TO postgres;
GRANT ALL ON FUNCTION public.is_analytics_admin() TO anon;
GRANT ALL ON FUNCTION public.is_analytics_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_analytics_admin() TO service_role;


--
-- Name: FUNCTION is_marketplace_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_marketplace_admin() TO postgres;
GRANT ALL ON FUNCTION public.is_marketplace_admin() TO anon;
GRANT ALL ON FUNCTION public.is_marketplace_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_marketplace_admin() TO service_role;


--
-- Name: FUNCTION is_pricing_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_pricing_admin() TO postgres;
GRANT ALL ON FUNCTION public.is_pricing_admin() TO anon;
GRANT ALL ON FUNCTION public.is_pricing_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_pricing_admin() TO service_role;


--
-- Name: FUNCTION is_risk_admin(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_risk_admin() TO postgres;
GRANT ALL ON FUNCTION public.is_risk_admin() TO anon;
GRANT ALL ON FUNCTION public.is_risk_admin() TO authenticated;
GRANT ALL ON FUNCTION public.is_risk_admin() TO service_role;


--
-- Name: FUNCTION is_schengen_member(p_code text); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.is_schengen_member(p_code text) TO postgres;
GRANT ALL ON FUNCTION public.is_schengen_member(p_code text) TO anon;
GRANT ALL ON FUNCTION public.is_schengen_member(p_code text) TO authenticated;
GRANT ALL ON FUNCTION public.is_schengen_member(p_code text) TO service_role;


--
-- Name: FUNCTION kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid, p_visa_type_id uuid, p_languages text[], p_form_codes text[], p_include_superseded boolean, p_as_of date, p_limit integer, p_candidate_limit integer, p_rrf_k integer); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid, p_visa_type_id uuid, p_languages text[], p_form_codes text[], p_include_superseded boolean, p_as_of date, p_limit integer, p_candidate_limit integer, p_rrf_k integer) FROM PUBLIC;
GRANT ALL ON FUNCTION public.kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid, p_visa_type_id uuid, p_languages text[], p_form_codes text[], p_include_superseded boolean, p_as_of date, p_limit integer, p_candidate_limit integer, p_rrf_k integer) TO postgres;
GRANT ALL ON FUNCTION public.kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid, p_visa_type_id uuid, p_languages text[], p_form_codes text[], p_include_superseded boolean, p_as_of date, p_limit integer, p_candidate_limit integer, p_rrf_k integer) TO authenticated;
GRANT ALL ON FUNCTION public.kb_search_hybrid(p_query_text text, p_query_embedding extensions.vector, p_embedding_model text, p_country_id uuid, p_visa_type_id uuid, p_languages text[], p_form_codes text[], p_include_superseded boolean, p_as_of date, p_limit integer, p_candidate_limit integer, p_rrf_k integer) TO service_role;


--
-- Name: FUNCTION redeem_coupon(p_coupon_id uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.redeem_coupon(p_coupon_id uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.redeem_coupon(p_coupon_id uuid) TO postgres;
GRANT ALL ON FUNCTION public.redeem_coupon(p_coupon_id uuid) TO service_role;


--
-- Name: FUNCTION refresh_consultant_rating(); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.refresh_consultant_rating() FROM PUBLIC;
GRANT ALL ON FUNCTION public.refresh_consultant_rating() TO postgres;
GRANT ALL ON FUNCTION public.refresh_consultant_rating() TO service_role;


--
-- Name: FUNCTION sec_application_owner(p_app uuid); Type: ACL; Schema: public; Owner: -
--

REVOKE ALL ON FUNCTION public.sec_application_owner(p_app uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION public.sec_application_owner(p_app uuid) TO postgres;
GRANT ALL ON FUNCTION public.sec_application_owner(p_app uuid) TO authenticated;
GRANT ALL ON FUNCTION public.sec_application_owner(p_app uuid) TO service_role;


--
-- Name: FUNCTION sec_guard_applications(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sec_guard_applications() TO postgres;
GRANT ALL ON FUNCTION public.sec_guard_applications() TO anon;
GRANT ALL ON FUNCTION public.sec_guard_applications() TO authenticated;
GRANT ALL ON FUNCTION public.sec_guard_applications() TO service_role;


--
-- Name: FUNCTION sec_guard_consultant_profiles(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sec_guard_consultant_profiles() TO postgres;
GRANT ALL ON FUNCTION public.sec_guard_consultant_profiles() TO anon;
GRANT ALL ON FUNCTION public.sec_guard_consultant_profiles() TO authenticated;
GRANT ALL ON FUNCTION public.sec_guard_consultant_profiles() TO service_role;


--
-- Name: FUNCTION sec_guard_consultations(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sec_guard_consultations() TO postgres;
GRANT ALL ON FUNCTION public.sec_guard_consultations() TO anon;
GRANT ALL ON FUNCTION public.sec_guard_consultations() TO authenticated;
GRANT ALL ON FUNCTION public.sec_guard_consultations() TO service_role;


--
-- Name: FUNCTION sec_is_privileged_writer(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.sec_is_privileged_writer() TO postgres;
GRANT ALL ON FUNCTION public.sec_is_privileged_writer() TO anon;
GRANT ALL ON FUNCTION public.sec_is_privileged_writer() TO authenticated;
GRANT ALL ON FUNCTION public.sec_is_privileged_writer() TO service_role;


--
-- Name: FUNCTION touch_field_verifications(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_field_verifications() TO postgres;
GRANT ALL ON FUNCTION public.touch_field_verifications() TO anon;
GRANT ALL ON FUNCTION public.touch_field_verifications() TO authenticated;
GRANT ALL ON FUNCTION public.touch_field_verifications() TO service_role;


--
-- Name: FUNCTION touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.touch_updated_at() TO postgres;
GRANT ALL ON FUNCTION public.touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.touch_updated_at() TO service_role;


--
-- Name: FUNCTION visa_registry_touch_updated_at(); Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON FUNCTION public.visa_registry_touch_updated_at() TO anon;
GRANT ALL ON FUNCTION public.visa_registry_touch_updated_at() TO authenticated;
GRANT ALL ON FUNCTION public.visa_registry_touch_updated_at() TO service_role;


--
-- Name: TABLE account_lockouts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.account_lockouts TO postgres;
GRANT ALL ON TABLE public.account_lockouts TO anon;
GRANT ALL ON TABLE public.account_lockouts TO authenticated;
GRANT ALL ON TABLE public.account_lockouts TO service_role;


--
-- Name: TABLE action_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.action_items TO postgres;
GRANT ALL ON TABLE public.action_items TO anon;
GRANT ALL ON TABLE public.action_items TO authenticated;
GRANT ALL ON TABLE public.action_items TO service_role;


--
-- Name: TABLE addon_purchases; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.addon_purchases TO postgres;
GRANT ALL ON TABLE public.addon_purchases TO anon;
GRANT ALL ON TABLE public.addon_purchases TO authenticated;
GRANT ALL ON TABLE public.addon_purchases TO service_role;


--
-- Name: TABLE ai_usage_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_usage_events TO postgres;
GRANT ALL ON TABLE public.ai_usage_events TO anon;
GRANT ALL ON TABLE public.ai_usage_events TO authenticated;
GRANT ALL ON TABLE public.ai_usage_events TO service_role;


--
-- Name: TABLE ai_cost_per_application; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_cost_per_application TO postgres;
GRANT ALL ON TABLE public.ai_cost_per_application TO anon;
GRANT ALL ON TABLE public.ai_cost_per_application TO authenticated;
GRANT ALL ON TABLE public.ai_cost_per_application TO service_role;


--
-- Name: TABLE applications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.applications TO postgres;
GRANT ALL ON TABLE public.applications TO anon;
GRANT ALL ON TABLE public.applications TO authenticated;
GRANT ALL ON TABLE public.applications TO service_role;


--
-- Name: TABLE country_frameworks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.country_frameworks TO postgres;
GRANT ALL ON TABLE public.country_frameworks TO anon;
GRANT ALL ON TABLE public.country_frameworks TO authenticated;
GRANT ALL ON TABLE public.country_frameworks TO service_role;


--
-- Name: TABLE pricing_quotes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pricing_quotes TO postgres;
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE public.pricing_quotes TO anon;
GRANT ALL ON TABLE public.pricing_quotes TO authenticated;
GRANT ALL ON TABLE public.pricing_quotes TO service_role;


--
-- Name: TABLE ai_cost_actual_vs_model; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ai_cost_actual_vs_model TO postgres;
GRANT ALL ON TABLE public.ai_cost_actual_vs_model TO anon;
GRANT ALL ON TABLE public.ai_cost_actual_vs_model TO authenticated;
GRANT ALL ON TABLE public.ai_cost_actual_vs_model TO service_role;


--
-- Name: TABLE analytics_alert_event; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_alert_event TO postgres;
GRANT ALL ON TABLE public.analytics_alert_event TO anon;
GRANT ALL ON TABLE public.analytics_alert_event TO authenticated;
GRANT ALL ON TABLE public.analytics_alert_event TO service_role;


--
-- Name: TABLE analytics_alert_rule; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_alert_rule TO postgres;
GRANT ALL ON TABLE public.analytics_alert_rule TO anon;
GRANT ALL ON TABLE public.analytics_alert_rule TO authenticated;
GRANT ALL ON TABLE public.analytics_alert_rule TO service_role;


--
-- Name: TABLE analytics_daily_active; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_daily_active TO postgres;
GRANT ALL ON TABLE public.analytics_daily_active TO anon;
GRANT ALL ON TABLE public.analytics_daily_active TO authenticated;
GRANT ALL ON TABLE public.analytics_daily_active TO service_role;


--
-- Name: TABLE analytics_event_daily; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_daily TO postgres;
GRANT ALL ON TABLE public.analytics_event_daily TO anon;
GRANT ALL ON TABLE public.analytics_event_daily TO authenticated;
GRANT ALL ON TABLE public.analytics_event_daily TO service_role;


--
-- Name: TABLE analytics_event_stream; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_stream TO postgres;
GRANT ALL ON TABLE public.analytics_event_stream TO anon;
GRANT ALL ON TABLE public.analytics_event_stream TO authenticated;
GRANT ALL ON TABLE public.analytics_event_stream TO service_role;


--
-- Name: TABLE analytics_event_stream_202607; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_stream_202607 TO postgres;
GRANT ALL ON TABLE public.analytics_event_stream_202607 TO anon;
GRANT ALL ON TABLE public.analytics_event_stream_202607 TO authenticated;
GRANT ALL ON TABLE public.analytics_event_stream_202607 TO service_role;


--
-- Name: TABLE analytics_event_stream_202608; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_stream_202608 TO postgres;
GRANT ALL ON TABLE public.analytics_event_stream_202608 TO anon;
GRANT ALL ON TABLE public.analytics_event_stream_202608 TO authenticated;
GRANT ALL ON TABLE public.analytics_event_stream_202608 TO service_role;


--
-- Name: TABLE analytics_event_stream_202609; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_stream_202609 TO postgres;
GRANT ALL ON TABLE public.analytics_event_stream_202609 TO anon;
GRANT ALL ON TABLE public.analytics_event_stream_202609 TO authenticated;
GRANT ALL ON TABLE public.analytics_event_stream_202609 TO service_role;


--
-- Name: TABLE analytics_event_stream_202610; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_stream_202610 TO postgres;
GRANT ALL ON TABLE public.analytics_event_stream_202610 TO anon;
GRANT ALL ON TABLE public.analytics_event_stream_202610 TO authenticated;
GRANT ALL ON TABLE public.analytics_event_stream_202610 TO service_role;


--
-- Name: TABLE analytics_event_stream_202611; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_stream_202611 TO postgres;
GRANT ALL ON TABLE public.analytics_event_stream_202611 TO anon;
GRANT ALL ON TABLE public.analytics_event_stream_202611 TO authenticated;
GRANT ALL ON TABLE public.analytics_event_stream_202611 TO service_role;


--
-- Name: TABLE analytics_event_stream_202612; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_event_stream_202612 TO postgres;
GRANT ALL ON TABLE public.analytics_event_stream_202612 TO anon;
GRANT ALL ON TABLE public.analytics_event_stream_202612 TO authenticated;
GRANT ALL ON TABLE public.analytics_event_stream_202612 TO service_role;


--
-- Name: TABLE analytics_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_events TO postgres;
GRANT ALL ON TABLE public.analytics_events TO anon;
GRANT ALL ON TABLE public.analytics_events TO authenticated;
GRANT ALL ON TABLE public.analytics_events TO service_role;


--
-- Name: TABLE analytics_identity_map; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_identity_map TO postgres;
GRANT ALL ON TABLE public.analytics_identity_map TO anon;
GRANT ALL ON TABLE public.analytics_identity_map TO authenticated;
GRANT ALL ON TABLE public.analytics_identity_map TO service_role;


--
-- Name: TABLE analytics_report_run; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_report_run TO postgres;
GRANT ALL ON TABLE public.analytics_report_run TO anon;
GRANT ALL ON TABLE public.analytics_report_run TO authenticated;
GRANT ALL ON TABLE public.analytics_report_run TO service_role;


--
-- Name: TABLE analytics_saved_report; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_saved_report TO postgres;
GRANT ALL ON TABLE public.analytics_saved_report TO anon;
GRANT ALL ON TABLE public.analytics_saved_report TO authenticated;
GRANT ALL ON TABLE public.analytics_saved_report TO service_role;


--
-- Name: TABLE analytics_scheduled_report; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.analytics_scheduled_report TO postgres;
GRANT ALL ON TABLE public.analytics_scheduled_report TO anon;
GRANT ALL ON TABLE public.analytics_scheduled_report TO authenticated;
GRANT ALL ON TABLE public.analytics_scheduled_report TO service_role;


--
-- Name: TABLE application_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.application_profiles TO postgres;
GRANT ALL ON TABLE public.application_profiles TO anon;
GRANT ALL ON TABLE public.application_profiles TO authenticated;
GRANT ALL ON TABLE public.application_profiles TO service_role;


--
-- Name: TABLE documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.documents TO postgres;
GRANT ALL ON TABLE public.documents TO anon;
GRANT ALL ON TABLE public.documents TO authenticated;
GRANT ALL ON TABLE public.documents TO service_role;


--
-- Name: TABLE generated_documents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.generated_documents TO postgres;
GRANT ALL ON TABLE public.generated_documents TO anon;
GRANT ALL ON TABLE public.generated_documents TO authenticated;
GRANT ALL ON TABLE public.generated_documents TO service_role;


--
-- Name: TABLE submission_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.submission_sessions TO postgres;
GRANT ALL ON TABLE public.submission_sessions TO anon;
GRANT ALL ON TABLE public.submission_sessions TO authenticated;
GRANT ALL ON TABLE public.submission_sessions TO service_role;


--
-- Name: TABLE vri_scores; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vri_scores TO postgres;
GRANT ALL ON TABLE public.vri_scores TO anon;
GRANT ALL ON TABLE public.vri_scores TO authenticated;
GRANT ALL ON TABLE public.vri_scores TO service_role;


--
-- Name: TABLE application_activity; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.application_activity TO postgres;
GRANT ALL ON TABLE public.application_activity TO anon;
GRANT ALL ON TABLE public.application_activity TO authenticated;
GRANT ALL ON TABLE public.application_activity TO service_role;


--
-- Name: TABLE application_item_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.application_item_reviews TO postgres;
GRANT ALL ON TABLE public.application_item_reviews TO anon;
GRANT ALL ON TABLE public.application_item_reviews TO authenticated;
GRANT ALL ON TABLE public.application_item_reviews TO service_role;


--
-- Name: TABLE application_outcomes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.application_outcomes TO postgres;
GRANT ALL ON TABLE public.application_outcomes TO anon;
GRANT ALL ON TABLE public.application_outcomes TO authenticated;
GRANT ALL ON TABLE public.application_outcomes TO service_role;


--
-- Name: TABLE audit_chain_state; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_chain_state TO postgres;
GRANT ALL ON TABLE public.audit_chain_state TO anon;
GRANT ALL ON TABLE public.audit_chain_state TO authenticated;
GRANT ALL ON TABLE public.audit_chain_state TO service_role;


--
-- Name: TABLE audit_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.audit_events TO postgres;
GRANT ALL ON TABLE public.audit_events TO anon;
GRANT ALL ON TABLE public.audit_events TO authenticated;
GRANT ALL ON TABLE public.audit_events TO service_role;


--
-- Name: TABLE auth_audit_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.auth_audit_log TO postgres;
GRANT ALL ON TABLE public.auth_audit_log TO anon;
GRANT ALL ON TABLE public.auth_audit_log TO authenticated;
GRANT ALL ON TABLE public.auth_audit_log TO service_role;


--
-- Name: TABLE beta_cohort_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.beta_cohort_members TO postgres;
GRANT ALL ON TABLE public.beta_cohort_members TO anon;
GRANT ALL ON TABLE public.beta_cohort_members TO authenticated;
GRANT ALL ON TABLE public.beta_cohort_members TO service_role;


--
-- Name: TABLE beta_cohorts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.beta_cohorts TO postgres;
GRANT ALL ON TABLE public.beta_cohorts TO anon;
GRANT ALL ON TABLE public.beta_cohorts TO authenticated;
GRANT ALL ON TABLE public.beta_cohorts TO service_role;


--
-- Name: TABLE beta_feedback; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.beta_feedback TO postgres;
GRANT ALL ON TABLE public.beta_feedback TO anon;
GRANT ALL ON TABLE public.beta_feedback TO authenticated;
GRANT ALL ON TABLE public.beta_feedback TO service_role;


--
-- Name: TABLE checklist_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.checklist_items TO postgres;
GRANT ALL ON TABLE public.checklist_items TO anon;
GRANT ALL ON TABLE public.checklist_items TO authenticated;
GRANT ALL ON TABLE public.checklist_items TO service_role;


--
-- Name: TABLE consultant_approvals; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_approvals TO postgres;
GRANT ALL ON TABLE public.consultant_approvals TO anon;
GRANT ALL ON TABLE public.consultant_approvals TO authenticated;
GRANT ALL ON TABLE public.consultant_approvals TO service_role;


--
-- Name: TABLE consultant_assignments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_assignments TO postgres;
GRANT ALL ON TABLE public.consultant_assignments TO anon;
GRANT ALL ON TABLE public.consultant_assignments TO authenticated;
GRANT ALL ON TABLE public.consultant_assignments TO service_role;


--
-- Name: TABLE consultant_availability; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_availability TO postgres;
GRANT ALL ON TABLE public.consultant_availability TO anon;
GRANT ALL ON TABLE public.consultant_availability TO authenticated;
GRANT ALL ON TABLE public.consultant_availability TO service_role;


--
-- Name: TABLE consultant_commission_rules; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_commission_rules TO postgres;
GRANT ALL ON TABLE public.consultant_commission_rules TO anon;
GRANT ALL ON TABLE public.consultant_commission_rules TO authenticated;
GRANT ALL ON TABLE public.consultant_commission_rules TO service_role;


--
-- Name: TABLE consultant_countries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_countries TO postgres;
GRANT ALL ON TABLE public.consultant_countries TO anon;
GRANT ALL ON TABLE public.consultant_countries TO authenticated;
GRANT ALL ON TABLE public.consultant_countries TO service_role;


--
-- Name: TABLE consultant_notes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_notes TO postgres;
GRANT ALL ON TABLE public.consultant_notes TO anon;
GRANT ALL ON TABLE public.consultant_notes TO authenticated;
GRANT ALL ON TABLE public.consultant_notes TO service_role;


--
-- Name: TABLE consultant_payout_items; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_payout_items TO postgres;
GRANT ALL ON TABLE public.consultant_payout_items TO anon;
GRANT ALL ON TABLE public.consultant_payout_items TO authenticated;
GRANT ALL ON TABLE public.consultant_payout_items TO service_role;


--
-- Name: TABLE consultant_payouts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_payouts TO postgres;
GRANT ALL ON TABLE public.consultant_payouts TO anon;
GRANT ALL ON TABLE public.consultant_payouts TO authenticated;
GRANT ALL ON TABLE public.consultant_payouts TO service_role;


--
-- Name: TABLE consultant_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_profiles TO postgres;
GRANT ALL ON TABLE public.consultant_profiles TO anon;
GRANT ALL ON TABLE public.consultant_profiles TO authenticated;
GRANT ALL ON TABLE public.consultant_profiles TO service_role;


--
-- Name: TABLE consultant_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_reviews TO postgres;
GRANT ALL ON TABLE public.consultant_reviews TO anon;
GRANT ALL ON TABLE public.consultant_reviews TO authenticated;
GRANT ALL ON TABLE public.consultant_reviews TO service_role;


--
-- Name: TABLE consultant_service_orders; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_service_orders TO postgres;
GRANT ALL ON TABLE public.consultant_service_orders TO anon;
GRANT ALL ON TABLE public.consultant_service_orders TO authenticated;
GRANT ALL ON TABLE public.consultant_service_orders TO service_role;


--
-- Name: TABLE consultant_skills; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_skills TO postgres;
GRANT ALL ON TABLE public.consultant_skills TO anon;
GRANT ALL ON TABLE public.consultant_skills TO authenticated;
GRANT ALL ON TABLE public.consultant_skills TO service_role;


--
-- Name: TABLE consultant_tax_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultant_tax_profiles TO postgres;
GRANT ALL ON TABLE public.consultant_tax_profiles TO anon;
GRANT ALL ON TABLE public.consultant_tax_profiles TO authenticated;
GRANT ALL ON TABLE public.consultant_tax_profiles TO service_role;


--
-- Name: TABLE consultations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consultations TO postgres;
GRANT ALL ON TABLE public.consultations TO anon;
GRANT ALL ON TABLE public.consultations TO authenticated;
GRANT ALL ON TABLE public.consultations TO service_role;


--
-- Name: TABLE consumed_readback_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.consumed_readback_tokens TO postgres;
GRANT ALL ON TABLE public.consumed_readback_tokens TO anon;
GRANT ALL ON TABLE public.consumed_readback_tokens TO authenticated;
GRANT ALL ON TABLE public.consumed_readback_tokens TO service_role;


--
-- Name: TABLE conversation_participants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversation_participants TO postgres;
GRANT ALL ON TABLE public.conversation_participants TO anon;
GRANT ALL ON TABLE public.conversation_participants TO authenticated;
GRANT ALL ON TABLE public.conversation_participants TO service_role;


--
-- Name: TABLE conversations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.conversations TO postgres;
GRANT ALL ON TABLE public.conversations TO anon;
GRANT ALL ON TABLE public.conversations TO authenticated;
GRANT ALL ON TABLE public.conversations TO service_role;


--
-- Name: TABLE coupons; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.coupons TO postgres;
GRANT ALL ON TABLE public.coupons TO anon;
GRANT ALL ON TABLE public.coupons TO authenticated;
GRANT ALL ON TABLE public.coupons TO service_role;


--
-- Name: TABLE cross_verifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.cross_verifications TO postgres;
GRANT ALL ON TABLE public.cross_verifications TO anon;
GRANT ALL ON TABLE public.cross_verifications TO authenticated;
GRANT ALL ON TABLE public.cross_verifications TO service_role;


--
-- Name: TABLE device_push_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.device_push_tokens TO postgres;
GRANT ALL ON TABLE public.device_push_tokens TO anon;
GRANT ALL ON TABLE public.device_push_tokens TO authenticated;
GRANT ALL ON TABLE public.device_push_tokens TO service_role;


--
-- Name: TABLE discount_redemptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.discount_redemptions TO postgres;
GRANT ALL ON TABLE public.discount_redemptions TO anon;
GRANT ALL ON TABLE public.discount_redemptions TO authenticated;
GRANT ALL ON TABLE public.discount_redemptions TO service_role;


--
-- Name: TABLE document_access_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_access_logs TO postgres;
GRANT ALL ON TABLE public.document_access_logs TO anon;
GRANT ALL ON TABLE public.document_access_logs TO authenticated;
GRANT ALL ON TABLE public.document_access_logs TO service_role;


--
-- Name: TABLE document_holder_confirmations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_holder_confirmations TO postgres;
GRANT ALL ON TABLE public.document_holder_confirmations TO anon;
GRANT ALL ON TABLE public.document_holder_confirmations TO authenticated;
GRANT ALL ON TABLE public.document_holder_confirmations TO service_role;


--
-- Name: TABLE document_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_requests TO postgres;
GRANT ALL ON TABLE public.document_requests TO anon;
GRANT ALL ON TABLE public.document_requests TO authenticated;
GRANT ALL ON TABLE public.document_requests TO service_role;


--
-- Name: TABLE document_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.document_templates TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.document_templates TO authenticated;
GRANT ALL ON TABLE public.document_templates TO service_role;


--
-- Name: TABLE document_translations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_translations TO postgres;
GRANT ALL ON TABLE public.document_translations TO anon;
GRANT ALL ON TABLE public.document_translations TO authenticated;
GRANT ALL ON TABLE public.document_translations TO service_role;


--
-- Name: TABLE document_verifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.document_verifications TO postgres;
GRANT ALL ON TABLE public.document_verifications TO anon;
GRANT ALL ON TABLE public.document_verifications TO authenticated;
GRANT ALL ON TABLE public.document_verifications TO service_role;


--
-- Name: TABLE escalation_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.escalation_history TO postgres;
GRANT ALL ON TABLE public.escalation_history TO anon;
GRANT ALL ON TABLE public.escalation_history TO authenticated;
GRANT ALL ON TABLE public.escalation_history TO service_role;


--
-- Name: TABLE escalation_thresholds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.escalation_thresholds TO postgres;
GRANT ALL ON TABLE public.escalation_thresholds TO anon;
GRANT ALL ON TABLE public.escalation_thresholds TO authenticated;
GRANT ALL ON TABLE public.escalation_thresholds TO service_role;


--
-- Name: TABLE evidence_packages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.evidence_packages TO postgres;
GRANT ALL ON TABLE public.evidence_packages TO anon;
GRANT ALL ON TABLE public.evidence_packages TO authenticated;
GRANT ALL ON TABLE public.evidence_packages TO service_role;


--
-- Name: TABLE feature_flag_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feature_flag_audit TO postgres;
GRANT ALL ON TABLE public.feature_flag_audit TO anon;
GRANT ALL ON TABLE public.feature_flag_audit TO authenticated;
GRANT ALL ON TABLE public.feature_flag_audit TO service_role;


--
-- Name: TABLE feature_flags; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.feature_flags TO postgres;
GRANT ALL ON TABLE public.feature_flags TO anon;
GRANT ALL ON TABLE public.feature_flags TO authenticated;
GRANT ALL ON TABLE public.feature_flags TO service_role;


--
-- Name: TABLE field_verifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.field_verifications TO postgres;
GRANT ALL ON TABLE public.field_verifications TO anon;
GRANT ALL ON TABLE public.field_verifications TO authenticated;
GRANT ALL ON TABLE public.field_verifications TO service_role;


--
-- Name: TABLE form_template_versions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.form_template_versions TO postgres;
GRANT ALL ON TABLE public.form_template_versions TO anon;
GRANT ALL ON TABLE public.form_template_versions TO authenticated;
GRANT ALL ON TABLE public.form_template_versions TO service_role;


--
-- Name: TABLE form_templates; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.form_templates TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.form_templates TO authenticated;
GRANT ALL ON TABLE public.form_templates TO service_role;


--
-- Name: TABLE generated_document_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.generated_document_revisions TO postgres;
GRANT ALL ON TABLE public.generated_document_revisions TO anon;
GRANT ALL ON TABLE public.generated_document_revisions TO authenticated;
GRANT ALL ON TABLE public.generated_document_revisions TO service_role;


--
-- Name: TABLE intake_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.intake_messages TO postgres;
GRANT ALL ON TABLE public.intake_messages TO anon;
GRANT ALL ON TABLE public.intake_messages TO authenticated;
GRANT ALL ON TABLE public.intake_messages TO service_role;


--
-- Name: TABLE kb_answer_citations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_answer_citations TO postgres;
GRANT ALL ON TABLE public.kb_answer_citations TO anon;
GRANT ALL ON TABLE public.kb_answer_citations TO authenticated;
GRANT ALL ON TABLE public.kb_answer_citations TO service_role;


--
-- Name: TABLE kb_blobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_blobs TO postgres;
GRANT ALL ON TABLE public.kb_blobs TO anon;
GRANT ALL ON TABLE public.kb_blobs TO authenticated;
GRANT ALL ON TABLE public.kb_blobs TO service_role;


--
-- Name: TABLE kb_chunk_scopes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_chunk_scopes TO postgres;
GRANT ALL ON TABLE public.kb_chunk_scopes TO anon;
GRANT ALL ON TABLE public.kb_chunk_scopes TO authenticated;
GRANT ALL ON TABLE public.kb_chunk_scopes TO service_role;


--
-- Name: TABLE kb_chunk_texts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_chunk_texts TO postgres;
GRANT ALL ON TABLE public.kb_chunk_texts TO anon;
GRANT ALL ON TABLE public.kb_chunk_texts TO authenticated;
GRANT ALL ON TABLE public.kb_chunk_texts TO service_role;


--
-- Name: TABLE kb_chunks; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_chunks TO postgres;
GRANT ALL ON TABLE public.kb_chunks TO anon;
GRANT ALL ON TABLE public.kb_chunks TO authenticated;
GRANT ALL ON TABLE public.kb_chunks TO service_role;


--
-- Name: TABLE kb_embeddings; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_embeddings TO postgres;
GRANT ALL ON TABLE public.kb_embeddings TO anon;
GRANT ALL ON TABLE public.kb_embeddings TO authenticated;
GRANT ALL ON TABLE public.kb_embeddings TO service_role;


--
-- Name: TABLE kb_extractions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_extractions TO postgres;
GRANT ALL ON TABLE public.kb_extractions TO anon;
GRANT ALL ON TABLE public.kb_extractions TO authenticated;
GRANT ALL ON TABLE public.kb_extractions TO service_role;


--
-- Name: TABLE kb_freshness_policies; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_freshness_policies TO postgres;
GRANT ALL ON TABLE public.kb_freshness_policies TO anon;
GRANT ALL ON TABLE public.kb_freshness_policies TO authenticated;
GRANT ALL ON TABLE public.kb_freshness_policies TO service_role;


--
-- Name: TABLE kb_ingestion_jobs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_ingestion_jobs TO postgres;
GRANT ALL ON TABLE public.kb_ingestion_jobs TO anon;
GRANT ALL ON TABLE public.kb_ingestion_jobs TO authenticated;
GRANT ALL ON TABLE public.kb_ingestion_jobs TO service_role;


--
-- Name: TABLE kb_quarantine; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_quarantine TO postgres;
GRANT ALL ON TABLE public.kb_quarantine TO anon;
GRANT ALL ON TABLE public.kb_quarantine TO authenticated;
GRANT ALL ON TABLE public.kb_quarantine TO service_role;


--
-- Name: TABLE kb_retrieval_logs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_retrieval_logs TO postgres;
GRANT ALL ON TABLE public.kb_retrieval_logs TO anon;
GRANT ALL ON TABLE public.kb_retrieval_logs TO authenticated;
GRANT ALL ON TABLE public.kb_retrieval_logs TO service_role;


--
-- Name: TABLE kb_review_queue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_review_queue TO postgres;
GRANT ALL ON TABLE public.kb_review_queue TO anon;
GRANT ALL ON TABLE public.kb_review_queue TO authenticated;
GRANT ALL ON TABLE public.kb_review_queue TO service_role;


--
-- Name: TABLE kb_sections; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_sections TO postgres;
GRANT ALL ON TABLE public.kb_sections TO anon;
GRANT ALL ON TABLE public.kb_sections TO authenticated;
GRANT ALL ON TABLE public.kb_sections TO service_role;


--
-- Name: TABLE kb_storage_stats; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kb_storage_stats TO postgres;
GRANT ALL ON TABLE public.kb_storage_stats TO anon;
GRANT ALL ON TABLE public.kb_storage_stats TO authenticated;
GRANT ALL ON TABLE public.kb_storage_stats TO service_role;


--
-- Name: TABLE kpi_funnel_daily; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kpi_funnel_daily TO postgres;
GRANT ALL ON TABLE public.kpi_funnel_daily TO anon;
GRANT ALL ON TABLE public.kpi_funnel_daily TO authenticated;
GRANT ALL ON TABLE public.kpi_funnel_daily TO service_role;


--
-- Name: TABLE kpi_metric_daily; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kpi_metric_daily TO postgres;
GRANT ALL ON TABLE public.kpi_metric_daily TO anon;
GRANT ALL ON TABLE public.kpi_metric_daily TO authenticated;
GRANT ALL ON TABLE public.kpi_metric_daily TO service_role;


--
-- Name: TABLE kpi_retention_cohort; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.kpi_retention_cohort TO postgres;
GRANT ALL ON TABLE public.kpi_retention_cohort TO anon;
GRANT ALL ON TABLE public.kpi_retention_cohort TO authenticated;
GRANT ALL ON TABLE public.kpi_retention_cohort TO service_role;


--
-- Name: TABLE login_history; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.login_history TO postgres;
GRANT ALL ON TABLE public.login_history TO anon;
GRANT ALL ON TABLE public.login_history TO authenticated;
GRANT ALL ON TABLE public.login_history TO service_role;


--
-- Name: TABLE marketing_attribution; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.marketing_attribution TO postgres;
GRANT ALL ON TABLE public.marketing_attribution TO anon;
GRANT ALL ON TABLE public.marketing_attribution TO authenticated;
GRANT ALL ON TABLE public.marketing_attribution TO service_role;


--
-- Name: TABLE message_attachments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.message_attachments TO postgres;
GRANT ALL ON TABLE public.message_attachments TO anon;
GRANT ALL ON TABLE public.message_attachments TO authenticated;
GRANT ALL ON TABLE public.message_attachments TO service_role;


--
-- Name: TABLE messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.messages TO postgres;
GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;


--
-- Name: TABLE notification_broadcasts; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_broadcasts TO postgres;
GRANT ALL ON TABLE public.notification_broadcasts TO anon;
GRANT ALL ON TABLE public.notification_broadcasts TO authenticated;
GRANT ALL ON TABLE public.notification_broadcasts TO service_role;


--
-- Name: TABLE notification_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_deliveries TO postgres;
GRANT ALL ON TABLE public.notification_deliveries TO anon;
GRANT ALL ON TABLE public.notification_deliveries TO authenticated;
GRANT ALL ON TABLE public.notification_deliveries TO service_role;


--
-- Name: TABLE notification_preferences; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_preferences TO postgres;
GRANT ALL ON TABLE public.notification_preferences TO anon;
GRANT ALL ON TABLE public.notification_preferences TO authenticated;
GRANT ALL ON TABLE public.notification_preferences TO service_role;


--
-- Name: TABLE notification_templates; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notification_templates TO postgres;
GRANT ALL ON TABLE public.notification_templates TO anon;
GRANT ALL ON TABLE public.notification_templates TO authenticated;
GRANT ALL ON TABLE public.notification_templates TO service_role;


--
-- Name: TABLE notifications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.notifications TO postgres;
GRANT ALL ON TABLE public.notifications TO anon;
GRANT ALL ON TABLE public.notifications TO authenticated;
GRANT ALL ON TABLE public.notifications TO service_role;


--
-- Name: TABLE ocr_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ocr_runs TO postgres;
GRANT ALL ON TABLE public.ocr_runs TO anon;
GRANT ALL ON TABLE public.ocr_runs TO authenticated;
GRANT ALL ON TABLE public.ocr_runs TO service_role;


--
-- Name: TABLE ops_agent_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_agent_runs TO postgres;
GRANT ALL ON TABLE public.ops_agent_runs TO anon;
GRANT ALL ON TABLE public.ops_agent_runs TO authenticated;
GRANT ALL ON TABLE public.ops_agent_runs TO service_role;


--
-- Name: TABLE ops_experiments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_experiments TO postgres;
GRANT ALL ON TABLE public.ops_experiments TO anon;
GRANT ALL ON TABLE public.ops_experiments TO authenticated;
GRANT ALL ON TABLE public.ops_experiments TO service_role;


--
-- Name: TABLE ops_marketing_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_marketing_events TO postgres;
GRANT ALL ON TABLE public.ops_marketing_events TO anon;
GRANT ALL ON TABLE public.ops_marketing_events TO authenticated;
GRANT ALL ON TABLE public.ops_marketing_events TO service_role;


--
-- Name: TABLE ops_products; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_products TO postgres;
GRANT ALL ON TABLE public.ops_products TO anon;
GRANT ALL ON TABLE public.ops_products TO authenticated;
GRANT ALL ON TABLE public.ops_products TO service_role;


--
-- Name: TABLE ops_revenue; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.ops_revenue TO postgres;
GRANT ALL ON TABLE public.ops_revenue TO anon;
GRANT ALL ON TABLE public.ops_revenue TO authenticated;
GRANT ALL ON TABLE public.ops_revenue TO service_role;


--
-- Name: TABLE organization_invitations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organization_invitations TO postgres;
GRANT ALL ON TABLE public.organization_invitations TO anon;
GRANT ALL ON TABLE public.organization_invitations TO authenticated;
GRANT ALL ON TABLE public.organization_invitations TO service_role;


--
-- Name: TABLE organization_members; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organization_members TO postgres;
GRANT ALL ON TABLE public.organization_members TO anon;
GRANT ALL ON TABLE public.organization_members TO authenticated;
GRANT ALL ON TABLE public.organization_members TO service_role;


--
-- Name: TABLE organizations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.organizations TO postgres;
GRANT ALL ON TABLE public.organizations TO anon;
GRANT ALL ON TABLE public.organizations TO authenticated;
GRANT ALL ON TABLE public.organizations TO service_role;


--
-- Name: TABLE partner_access_tokens; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_access_tokens TO postgres;
GRANT ALL ON TABLE public.partner_access_tokens TO anon;
GRANT ALL ON TABLE public.partner_access_tokens TO authenticated;
GRANT ALL ON TABLE public.partner_access_tokens TO service_role;


--
-- Name: TABLE partner_api_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_api_keys TO postgres;
GRANT ALL ON TABLE public.partner_api_keys TO anon;
GRANT ALL ON TABLE public.partner_api_keys TO authenticated;
GRANT ALL ON TABLE public.partner_api_keys TO service_role;


--
-- Name: TABLE partner_api_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_api_requests TO postgres;
GRANT ALL ON TABLE public.partner_api_requests TO anon;
GRANT ALL ON TABLE public.partner_api_requests TO authenticated;
GRANT ALL ON TABLE public.partner_api_requests TO service_role;


--
-- Name: TABLE partner_applications; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_applications TO postgres;
GRANT ALL ON TABLE public.partner_applications TO anon;
GRANT ALL ON TABLE public.partner_applications TO authenticated;
GRANT ALL ON TABLE public.partner_applications TO service_role;


--
-- Name: TABLE partner_authorization_codes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_authorization_codes TO postgres;
GRANT ALL ON TABLE public.partner_authorization_codes TO anon;
GRANT ALL ON TABLE public.partner_authorization_codes TO authenticated;
GRANT ALL ON TABLE public.partner_authorization_codes TO service_role;


--
-- Name: TABLE partner_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_events TO postgres;
GRANT ALL ON TABLE public.partner_events TO anon;
GRANT ALL ON TABLE public.partner_events TO authenticated;
GRANT ALL ON TABLE public.partner_events TO service_role;


--
-- Name: SEQUENCE partner_events_sequence_seq; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON SEQUENCE public.partner_events_sequence_seq TO postgres;
GRANT ALL ON SEQUENCE public.partner_events_sequence_seq TO anon;
GRANT ALL ON SEQUENCE public.partner_events_sequence_seq TO authenticated;
GRANT ALL ON SEQUENCE public.partner_events_sequence_seq TO service_role;


--
-- Name: TABLE partner_idempotency_keys; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_idempotency_keys TO postgres;
GRANT ALL ON TABLE public.partner_idempotency_keys TO anon;
GRANT ALL ON TABLE public.partner_idempotency_keys TO authenticated;
GRANT ALL ON TABLE public.partner_idempotency_keys TO service_role;


--
-- Name: TABLE partner_sandbox_resources; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_sandbox_resources TO postgres;
GRANT ALL ON TABLE public.partner_sandbox_resources TO anon;
GRANT ALL ON TABLE public.partner_sandbox_resources TO authenticated;
GRANT ALL ON TABLE public.partner_sandbox_resources TO service_role;


--
-- Name: TABLE partner_usage_counters; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_usage_counters TO postgres;
GRANT ALL ON TABLE public.partner_usage_counters TO anon;
GRANT ALL ON TABLE public.partner_usage_counters TO authenticated;
GRANT ALL ON TABLE public.partner_usage_counters TO service_role;


--
-- Name: TABLE partner_user_consents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_user_consents TO postgres;
GRANT ALL ON TABLE public.partner_user_consents TO anon;
GRANT ALL ON TABLE public.partner_user_consents TO authenticated;
GRANT ALL ON TABLE public.partner_user_consents TO service_role;


--
-- Name: TABLE partner_webhook_deliveries; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_webhook_deliveries TO postgres;
GRANT ALL ON TABLE public.partner_webhook_deliveries TO anon;
GRANT ALL ON TABLE public.partner_webhook_deliveries TO authenticated;
GRANT ALL ON TABLE public.partner_webhook_deliveries TO service_role;


--
-- Name: TABLE partner_webhook_endpoints; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partner_webhook_endpoints TO postgres;
GRANT ALL ON TABLE public.partner_webhook_endpoints TO anon;
GRANT ALL ON TABLE public.partner_webhook_endpoints TO authenticated;
GRANT ALL ON TABLE public.partner_webhook_endpoints TO service_role;


--
-- Name: TABLE partners; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.partners TO postgres;
GRANT ALL ON TABLE public.partners TO anon;
GRANT ALL ON TABLE public.partners TO authenticated;
GRANT ALL ON TABLE public.partners TO service_role;


--
-- Name: TABLE payment_disputes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_disputes TO postgres;
GRANT ALL ON TABLE public.payment_disputes TO anon;
GRANT ALL ON TABLE public.payment_disputes TO authenticated;
GRANT ALL ON TABLE public.payment_disputes TO service_role;


--
-- Name: TABLE payment_dunning; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_dunning TO postgres;
GRANT ALL ON TABLE public.payment_dunning TO anon;
GRANT ALL ON TABLE public.payment_dunning TO authenticated;
GRANT ALL ON TABLE public.payment_dunning TO service_role;


--
-- Name: TABLE payment_event_processing; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_event_processing TO postgres;
GRANT ALL ON TABLE public.payment_event_processing TO anon;
GRANT ALL ON TABLE public.payment_event_processing TO authenticated;
GRANT ALL ON TABLE public.payment_event_processing TO service_role;


--
-- Name: TABLE payment_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payment_events TO postgres;
GRANT ALL ON TABLE public.payment_events TO anon;
GRANT ALL ON TABLE public.payment_events TO authenticated;
GRANT ALL ON TABLE public.payment_events TO service_role;


--
-- Name: TABLE payments; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payments TO postgres;
GRANT ALL ON TABLE public.payments TO anon;
GRANT ALL ON TABLE public.payments TO authenticated;
GRANT ALL ON TABLE public.payments TO service_role;


--
-- Name: TABLE payout_tax_statements; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.payout_tax_statements TO postgres;
GRANT ALL ON TABLE public.payout_tax_statements TO anon;
GRANT ALL ON TABLE public.payout_tax_statements TO authenticated;
GRANT ALL ON TABLE public.payout_tax_statements TO service_role;


--
-- Name: TABLE permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.permissions TO postgres;
GRANT ALL ON TABLE public.permissions TO anon;
GRANT ALL ON TABLE public.permissions TO authenticated;
GRANT ALL ON TABLE public.permissions TO service_role;


--
-- Name: TABLE post_submission_events; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.post_submission_events TO postgres;
GRANT ALL ON TABLE public.post_submission_events TO anon;
GRANT ALL ON TABLE public.post_submission_events TO authenticated;
GRANT ALL ON TABLE public.post_submission_events TO service_role;


--
-- Name: TABLE preflight_reviews; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.preflight_reviews TO postgres;
GRANT ALL ON TABLE public.preflight_reviews TO anon;
GRANT ALL ON TABLE public.preflight_reviews TO authenticated;
GRANT ALL ON TABLE public.preflight_reviews TO service_role;


--
-- Name: TABLE pricing_constants; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pricing_constants TO postgres;
GRANT ALL ON TABLE public.pricing_constants TO anon;
GRANT ALL ON TABLE public.pricing_constants TO authenticated;
GRANT ALL ON TABLE public.pricing_constants TO service_role;


--
-- Name: TABLE pricing_country_factors; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pricing_country_factors TO postgres;
GRANT ALL ON TABLE public.pricing_country_factors TO anon;
GRANT ALL ON TABLE public.pricing_country_factors TO authenticated;
GRANT ALL ON TABLE public.pricing_country_factors TO service_role;


--
-- Name: TABLE pricing_quote_audit; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pricing_quote_audit TO postgres;
GRANT ALL ON TABLE public.pricing_quote_audit TO anon;
GRANT ALL ON TABLE public.pricing_quote_audit TO authenticated;
GRANT ALL ON TABLE public.pricing_quote_audit TO service_role;


--
-- Name: TABLE pricing_visa_tiers; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.pricing_visa_tiers TO postgres;
GRANT ALL ON TABLE public.pricing_visa_tiers TO anon;
GRANT ALL ON TABLE public.pricing_visa_tiers TO authenticated;
GRANT ALL ON TABLE public.pricing_visa_tiers TO service_role;


--
-- Name: TABLE privacy_requests; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.privacy_requests TO postgres;
GRANT ALL ON TABLE public.privacy_requests TO anon;
GRANT ALL ON TABLE public.privacy_requests TO authenticated;
GRANT ALL ON TABLE public.privacy_requests TO service_role;


--
-- Name: TABLE promotions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.promotions TO postgres;
GRANT ALL ON TABLE public.promotions TO anon;
GRANT ALL ON TABLE public.promotions TO authenticated;
GRANT ALL ON TABLE public.promotions TO service_role;


--
-- Name: TABLE push_subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.push_subscriptions TO postgres;
GRANT ALL ON TABLE public.push_subscriptions TO anon;
GRANT ALL ON TABLE public.push_subscriptions TO authenticated;
GRANT ALL ON TABLE public.push_subscriptions TO service_role;


--
-- Name: TABLE reconciliation_exceptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reconciliation_exceptions TO postgres;
GRANT ALL ON TABLE public.reconciliation_exceptions TO anon;
GRANT ALL ON TABLE public.reconciliation_exceptions TO authenticated;
GRANT ALL ON TABLE public.reconciliation_exceptions TO service_role;


--
-- Name: TABLE reconciliation_runs; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reconciliation_runs TO postgres;
GRANT ALL ON TABLE public.reconciliation_runs TO anon;
GRANT ALL ON TABLE public.reconciliation_runs TO authenticated;
GRANT ALL ON TABLE public.reconciliation_runs TO service_role;


--
-- Name: TABLE refunds; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.refunds TO postgres;
GRANT ALL ON TABLE public.refunds TO anon;
GRANT ALL ON TABLE public.refunds TO authenticated;
GRANT ALL ON TABLE public.refunds TO service_role;


--
-- Name: TABLE reminder_log; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.reminder_log TO postgres;
GRANT ALL ON TABLE public.reminder_log TO anon;
GRANT ALL ON TABLE public.reminder_log TO authenticated;
GRANT ALL ON TABLE public.reminder_log TO service_role;


--
-- Name: TABLE risk_weights; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.risk_weights TO postgres;
GRANT ALL ON TABLE public.risk_weights TO anon;
GRANT ALL ON TABLE public.risk_weights TO authenticated;
GRANT ALL ON TABLE public.risk_weights TO service_role;


--
-- Name: TABLE role_permissions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.role_permissions TO postgres;
GRANT ALL ON TABLE public.role_permissions TO anon;
GRANT ALL ON TABLE public.role_permissions TO authenticated;
GRANT ALL ON TABLE public.role_permissions TO service_role;


--
-- Name: TABLE roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.roles TO postgres;
GRANT ALL ON TABLE public.roles TO anon;
GRANT ALL ON TABLE public.roles TO authenticated;
GRANT ALL ON TABLE public.roles TO service_role;


--
-- Name: TABLE section_verification; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.section_verification TO postgres;
GRANT ALL ON TABLE public.section_verification TO anon;
GRANT ALL ON TABLE public.section_verification TO authenticated;
GRANT ALL ON TABLE public.section_verification TO service_role;


--
-- Name: TABLE subscription_credits; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subscription_credits TO postgres;
GRANT ALL ON TABLE public.subscription_credits TO anon;
GRANT ALL ON TABLE public.subscription_credits TO authenticated;
GRANT ALL ON TABLE public.subscription_credits TO service_role;


--
-- Name: TABLE subscriptions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.subscriptions TO postgres;
GRANT ALL ON TABLE public.subscriptions TO anon;
GRANT ALL ON TABLE public.subscriptions TO authenticated;
GRANT ALL ON TABLE public.subscriptions TO service_role;


--
-- Name: TABLE template_revisions; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.template_revisions TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.template_revisions TO authenticated;
GRANT ALL ON TABLE public.template_revisions TO service_role;


--
-- Name: TABLE template_sweep_findings; Type: ACL; Schema: public; Owner: -
--

GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.template_sweep_findings TO anon;
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.template_sweep_findings TO authenticated;
GRANT ALL ON TABLE public.template_sweep_findings TO service_role;


--
-- Name: TABLE user_profiles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_profiles TO postgres;
GRANT ALL ON TABLE public.user_profiles TO anon;
GRANT ALL ON TABLE public.user_profiles TO authenticated;
GRANT ALL ON TABLE public.user_profiles TO service_role;


--
-- Name: TABLE user_roles; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.user_roles TO postgres;
GRANT ALL ON TABLE public.user_roles TO anon;
GRANT ALL ON TABLE public.user_roles TO authenticated;
GRANT ALL ON TABLE public.user_roles TO service_role;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.users TO postgres;
GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- Name: TABLE v_application_funnel; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_application_funnel TO postgres;
GRANT ALL ON TABLE public.v_application_funnel TO anon;
GRANT ALL ON TABLE public.v_application_funnel TO authenticated;
GRANT ALL ON TABLE public.v_application_funnel TO service_role;


--
-- Name: TABLE v_client_dml_grants_without_policy; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_client_dml_grants_without_policy TO postgres;
GRANT ALL ON TABLE public.v_client_dml_grants_without_policy TO service_role;


--
-- Name: TABLE v_public_indexes; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.v_public_indexes TO postgres;
GRANT ALL ON TABLE public.v_public_indexes TO service_role;


--
-- Name: TABLE visa_countries; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_countries TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_countries TO authenticated;
GRANT ALL ON TABLE public.visa_countries TO service_role;


--
-- Name: TABLE visa_requirements; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_requirements TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_requirements TO authenticated;
GRANT ALL ON TABLE public.visa_requirements TO service_role;


--
-- Name: TABLE visa_sources; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_sources TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_sources TO authenticated;
GRANT ALL ON TABLE public.visa_sources TO service_role;


--
-- Name: TABLE visa_types; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_types TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_types TO authenticated;
GRANT ALL ON TABLE public.visa_types TO service_role;


--
-- Name: TABLE visa_publishable_pages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.visa_publishable_pages TO anon;
GRANT ALL ON TABLE public.visa_publishable_pages TO authenticated;
GRANT ALL ON TABLE public.visa_publishable_pages TO service_role;


--
-- Name: TABLE visa_requirement_bootstrap_skips; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.visa_requirement_bootstrap_skips TO postgres;
GRANT ALL ON TABLE public.visa_requirement_bootstrap_skips TO anon;
GRANT ALL ON TABLE public.visa_requirement_bootstrap_skips TO authenticated;
GRANT ALL ON TABLE public.visa_requirement_bootstrap_skips TO service_role;


--
-- Name: TABLE visa_source_changes; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_source_changes TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_source_changes TO authenticated;
GRANT ALL ON TABLE public.visa_source_changes TO service_role;


--
-- Name: TABLE visa_source_checks; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_source_checks TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_source_checks TO authenticated;
GRANT ALL ON TABLE public.visa_source_checks TO service_role;


--
-- Name: TABLE visa_source_versions; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_source_versions TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_source_versions TO authenticated;
GRANT ALL ON TABLE public.visa_source_versions TO service_role;


--
-- Name: TABLE visa_sync_runs; Type: ACL; Schema: public; Owner: -
--

GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_sync_runs TO anon;
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE public.visa_sync_runs TO authenticated;
GRANT ALL ON TABLE public.visa_sync_runs TO service_role;


--
-- Name: TABLE voice_consents; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.voice_consents TO postgres;
GRANT ALL ON TABLE public.voice_consents TO anon;
GRANT ALL ON TABLE public.voice_consents TO authenticated;
GRANT ALL ON TABLE public.voice_consents TO service_role;


--
-- Name: TABLE voice_messages; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.voice_messages TO postgres;
GRANT ALL ON TABLE public.voice_messages TO anon;
GRANT ALL ON TABLE public.voice_messages TO authenticated;
GRANT ALL ON TABLE public.voice_messages TO service_role;


--
-- Name: TABLE voice_sessions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.voice_sessions TO postgres;
GRANT ALL ON TABLE public.voice_sessions TO anon;
GRANT ALL ON TABLE public.voice_sessions TO authenticated;
GRANT ALL ON TABLE public.voice_sessions TO service_role;


--
-- Name: TABLE voice_transcript_turns; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.voice_transcript_turns TO postgres;
GRANT ALL ON TABLE public.voice_transcript_turns TO anon;
GRANT ALL ON TABLE public.voice_transcript_turns TO authenticated;
GRANT ALL ON TABLE public.voice_transcript_turns TO service_role;


--
-- Name: TABLE vri_recommendations; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vri_recommendations TO postgres;
GRANT ALL ON TABLE public.vri_recommendations TO anon;
GRANT ALL ON TABLE public.vri_recommendations TO authenticated;
GRANT ALL ON TABLE public.vri_recommendations TO service_role;


--
-- Name: TABLE vri_visa_suggestions; Type: ACL; Schema: public; Owner: -
--

GRANT ALL ON TABLE public.vri_visa_suggestions TO postgres;
GRANT ALL ON TABLE public.vri_visa_suggestions TO anon;
GRANT ALL ON TABLE public.vri_visa_suggestions TO authenticated;
GRANT ALL ON TABLE public.vri_visa_suggestions TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: -
--



--
-- PostgreSQL database dump complete
--



-- auth hooks
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
CREATE TRIGGER on_auth_user_identity_updated AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_user_identity_sync();
-- storage buckets (all private)
insert into storage.buckets (id, name, public) values
 ('documents','documents',false),('form-templates','form-templates',false),
 ('document-templates','document-templates',false),('feedback','feedback',false),
 ('visa-knowledge','visa-knowledge',false)
on conflict (id) do nothing;
CREATE POLICY documents_owner_delete ON storage.objects FOR DELETE TO public USING (bucket_id = 'documents' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY documents_owner_insert ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'documents' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY documents_owner_select ON storage.objects FOR SELECT TO public USING (bucket_id = 'documents' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY documents_owner_update ON storage.objects FOR UPDATE TO public USING (bucket_id = 'documents' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY feedback_owner_select ON storage.objects FOR SELECT TO public USING (bucket_id = 'feedback' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY feedback_owner_insert ON storage.objects FOR INSERT TO public WITH CHECK (bucket_id = 'feedback' AND (auth.uid())::text = (storage.foldername(name))[1]);
CREATE POLICY feedback_owner_delete ON storage.objects FOR DELETE TO public USING (bucket_id = 'feedback' AND (auth.uid())::text = (storage.foldername(name))[1]);
