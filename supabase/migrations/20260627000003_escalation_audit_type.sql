-- Adds the system-initiated consultant escalation audit event type.
-- Emitted by AssignmentService.flagForConsultantEscalation (called from
-- VriService auto-escalate-on-low-score). audit_events.event_type is the
-- `audit_event_type` enum, so the value must be registered before inserts use it.
-- `add value if not exists` is idempotent; run OUTSIDE a transaction block.

alter type public.audit_event_type add value if not exists 'CONSULTANT_ESCALATION_FLAGGED';
