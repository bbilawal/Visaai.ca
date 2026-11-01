-- Append-only must forbid rewriting history — not forbid severing a link to a
-- deleted parent.
--
-- Second half of the fix started in 20260813140000. That migration pointed the
-- FKs on the append-only tables at ON DELETE SET NULL so a cascade would stop
-- trying to DELETE audit rows. Postgres then does the next thing:
--
--   UPDATE ONLY public.audit_events SET application_id = NULL WHERE …
--   ERROR: audit_events is append-only: UPDATE not permitted
--
-- `audit_no_mutate` refuses every UPDATE and every DELETE unconditionally, so
-- SET NULL is refused exactly like CASCADE was. GDPR Art. 17 erasure
-- (privacy.service.ts) is still impossible, and so is deleting any application
-- that has ever been audited. Note this was ALREADY true for `actor_id`, which
-- has been ON DELETE SET NULL since it was created: deleting a `public.users`
-- row hit the same wall.
--
-- WHAT CHANGES, AND WHAT DOES NOT
--
-- The trigger now permits exactly one kind of UPDATE: one that changes NOTHING
-- except setting a foreign-key LINK column to NULL. Every other update, and
-- every delete, is refused as before.
--
--   allowed:  application_id  <uuid> -> NULL          (parent erased)
--   refused:  payload, event_type, actor_role, value_hash, from_state,
--             to_state, seq, created_at … any change at all
--   refused:  application_id <uuid-A> -> <uuid-B>     (re-pointing a record)
--   refused:  DELETE, always
--
-- So the CONTENT of an audit record — what happened, when, in what state, with
-- what payload hash — remains immutable and undeletable. Only the pointer to a
-- row that no longer exists can be cleared, which is the same anonymisation the
-- privacy service already documents as the intended outcome: "Rows referenced
-- with ON DELETE SET NULL … are anonymised rather than removed — the correct
-- GDPR outcome for records that must survive for financial/audit integrity."
--
-- WHY AN EXPLICIT COLUMN ALLOWLIST
--
-- The obvious generic rule — "allow any update whose changed columns all became
-- NULL" — would also permit nulling nullable CONTENT columns (`value_hash`,
-- `field_key`, `from_state`, `to_state`). Blanking the hash that binds an audit
-- row to the value it describes is exactly the tampering this table exists to
-- prevent, and it would pass that rule. The allowlist below is every FK column
-- on the four append-only tables and nothing else, so the exception cannot be
-- widened by accident.
--
-- WHY A TRIGGER CANNOT SIMPLY "ALLOW CASCADES"
--
-- There is no reliable way inside a trigger to tell a referential action from a
-- hand-written UPDATE. Trusting the operation's origin would hand anyone who can
-- delete an application a way to rewrite the audit trail that records what they
-- did. Constraining the SHAPE of the write instead — content identical, link
-- nulled — is checkable and does not depend on who asked.

create or replace function public.audit_no_mutate()
returns trigger
language plpgsql
as $$
declare
  -- Every FK column on the append-only tables (audit_events,
  -- evidence_packages, payment_events, reconciliation_exceptions). Kept
  -- explicit: a column added here is a deliberate decision to let a cascade
  -- clear it.
  link_columns constant text[] := array[
    'application_id',
    'actor_id',
    'document_id',
    'ocr_run_id',
    'submission_session_id',
    'consultant_id',
    'run_id',
    'user_id'
  ];
  old_json jsonb;
  new_json jsonb;
  col text;
begin
  if tg_op = 'UPDATE' then
    old_json := to_jsonb(old);
    new_json := to_jsonb(new);

    -- Strip the link columns that this statement is CLEARING (non-null -> null)
    -- from both sides. Anything else that differs will survive the strip and be
    -- caught by the equality check below.
    foreach col in array link_columns loop
      if old_json ? col
         and old_json -> col <> 'null'::jsonb
         and new_json -> col = 'null'::jsonb
      then
        old_json := old_json - col;
        new_json := new_json - col;
      end if;
    end loop;

    if old_json = new_json then
      -- Content untouched; only a link to a deleted parent was cleared.
      return new;
    end if;
  end if;

  raise exception '% is append-only: % not permitted', tg_table_name, tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

comment on function public.audit_no_mutate() is
  'Append-only guard for audit_events, evidence_packages, payment_events and '
  'reconciliation_exceptions. Refuses every DELETE and every UPDATE except one '
  'that changes nothing but setting a foreign-key link column to NULL, which is '
  'what ON DELETE SET NULL does when a parent is erased. See migration '
  '20260813150000 for the reasoning.';
