-- =====================================================================
-- Gate 2 — audit_events  CHAIN RECONCILE
-- Author: Backend Architect   Date: 2026-06-27
-- Depends on: 20260606000004_audit_events.sql (audit_events, audit_chain_state,
--             audit_append, audit_verify_chain, pgcrypto digest()).
--
-- WHY THIS MIGRATION EXISTS
-- -------------------------
-- Two divergent hash-chain implementations shipped:
--   * The APPLICATION (apps/api/src/modules/audit/audit.service.ts) is the only
--     thing that ever writes rows. It computes `row_hash` in TypeScript over a
--     rich, pipe-delimited field set:
--
--       sha256(
--         prev_hash | seq | event_type | actor_id(or 'system') | actor_role |
--         field_key(or '') | document_id(or '') | value_hash(or '') |
--         payload_hash | occurred_at
--       )
--
--     where occurred_at is `new Date().toISOString()`  ->  YYYY-MM-DDTHH:MM:SS.sssZ
--     (always millisecond precision, always UTC 'Z'), and the join delimiter is '|'.
--
--   * The SQL `audit_verify_chain()` / `audit_append()` from the original
--     migration used a DIFFERENT, undelimited formula:
--
--       sha256(
--         prev_hash || event_type || field_key || document_id ||
--         payload_hash || occurred_at::text || actor_id(or 'system')
--       )
--
--     — no seq, no actor_role, no value_hash, different order, no delimiter, and
--     occurred_at rendered via ::text ("2026-... 12:34:56.789+00", space + "+00",
--     trailing zeros trimmed) instead of ISO-8601 'Z'. The API never calls these
--     SQL functions (it inserts directly via the service-role client), so the
--     drift was latent: running audit_verify_chain() in the DB would flag EVERY
--     app-written row as `row_hash mismatch (tampered)`.
--
-- AUTHORITY DECISION
-- ------------------
-- The application TS `row_hash` is the WRITE AUTHORITY (it is what is actually
-- persisted and carries the richer field set). This migration makes the DB
-- verifier AGREE with it, byte-for-byte, instead of changing the app. The app's
-- write/hash formula is NOT touched.
--
-- WHAT CHANGES
-- ------------
--   1. `audit_append(...)` is DROPPED. It can never be made parity-consistent
--      with the TS authority: it derives payload_hash as
--      `digest(payload::text,'sha256')` (Postgres jsonb text serialization),
--      whereas the app derives it from a canonical JSON.stringify with
--      RECURSIVELY SORTED keys. A SQL-appended row would therefore carry a
--      payload_hash the TS verifier rejects. A second, divergent writer is a
--      liability, and the app path is already the sole writer (module
--      encapsulation + RLS + append-only triggers). So it is removed, not
--      "fixed".
--
--   2. `audit_verify_chain(uuid)` is REDEFINED so its row_hash formula EXACTLY
--      matches the app: same fields, same order, same '|' delimiter, same
--      'system'/'' coalesce defaults, and occurred_at rendered as the app's
--      ISO-8601 millisecond 'Z' string via to_char(... 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"').
--      It now also checks seq monotonicity (matching the TS verifier's "seq gap"
--      classification). Genesis link is sha256(application_id::text), matching
--      the TS genesisHash(applicationId).
--
-- CAVEAT (documented, not a bug)
-- ------------------------------
--   * PAYLOAD-CONTENT tamper detection stays in the TS verifier. The TS
--     `verifyTrail` re-derives payload_hash from the payload via canonical
--     JSON.stringify(sorted keys); SQL cannot faithfully reproduce that
--     serialization (number formatting, unicode escaping, whitespace, deep key
--     sorting). So this SQL verifier treats `payload_hash` as an OPAQUE stored
--     value inside the row_hash recompute (exactly as the TS computeRowHash
--     does). Net effect: editing `payload_hash` (or any chained field) breaks
--     row_hash and IS caught here; editing only the raw `payload` jsonb while
--     leaving `payload_hash` untouched is caught by the TS verifier. This was
--     also true of the original SQL verifier (it likewise used the stored
--     payload_hash), so it is not a regression — it is the boundary of what SQL
--     can attest.
--
--   * occurred_at parity assumes millisecond precision (the app always writes
--     Date.toISOString()). A row inserted out-of-band with sub-millisecond
--     precision would render differently under '.MS' and be flagged — correct
--     behavior for a verifier whose authority is the app writer.
-- =====================================================================

-- ---- 1. remove the divergent, unused SQL writer -------------------------
drop function if exists public.audit_append(
  uuid, audit_event_type, uuid, audit_actor_role, jsonb, text,
  uuid, uuid, text, uuid, text, text, text, text
);

-- ---- 2. reconcile the verifier to the TS row_hash authority --------------
-- Returns one row locating the FIRST break; returns NO rows when intact.
create or replace function public.audit_verify_chain(p_application_id uuid)
returns table(broken_at_seq bigint, reason text) as $$
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
$$ language plpgsql stable;

comment on function public.audit_verify_chain(uuid) is
  'Gate 2 reconcile (20260627000002): row_hash formula aligned byte-for-byte to '
  'the application TS authority (apps/api .../audit.service.ts computeRowHash). '
  'Checks seq monotonicity, prev_hash linkage, and row_hash. payload_hash is '
  'treated as an opaque stored value (TS canonical-JSON payload-content tamper '
  'detection stays in AuditService.verifyTrail). audit_append() was dropped: the '
  'app service-role insert is the sole authoritative writer.';

-- =====================================================================
-- ROLLBACK (restores the original, DIVERGENT behavior — for reference only;
-- do not apply unless intentionally reverting the reconcile):
--   -- re-create original audit_append from 20260606000004_audit_events.sql, and
--   -- restore the original audit_verify_chain body from that migration.
-- =====================================================================
