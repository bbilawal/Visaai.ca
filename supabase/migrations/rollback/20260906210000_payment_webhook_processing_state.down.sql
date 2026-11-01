-- Rollback PAY-009: remove the webhook processing state machine.
--
-- ONLY roll this back together with the API code. LedgerService (543b7f12 and
-- later) calls these three functions on every payment webhook and has no
-- fallback, so dropping them under a build that includes it makes every Stripe
-- webhook fail (REVIEW_HANDOFF §27.6). The immutable payment_events ledger is
-- untouched; only the processing status rows are discarded.
drop function if exists public.fail_payment_webhook_event(text, text);
drop function if exists public.complete_payment_webhook_event(text);
drop function if exists public.claim_payment_webhook_event(text, text, text, text, bigint, text, text, uuid, jsonb, timestamptz);
drop table if exists public.payment_event_processing;
