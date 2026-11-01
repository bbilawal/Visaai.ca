-- =====================================================================
-- Drop five redundant indexes (PERF-007).
-- Author: Audit (Phase 9)   Date: 2026-08-09
--
-- Every index below is fully covered by another index on the same table, so it
-- can serve no query the survivor cannot. Each one still costs a write on every
-- INSERT and UPDATE of its table, plus storage and vacuum work.
--
-- TWO KINDS OF REDUNDANCY HERE, and only one of them is obvious.
--
-- 1. Identical column list, where a UNIQUE constraint index already exists.
--    A unique btree serves every read a plain btree on the same columns would.
--      idx_applications_monitor_token   <- applications_monitor_token_key
--      audit_events_app_seq_idx         <- audit_events_application_id_seq_key
--      subscription_credits_balance_idx <- subscription_credits_subscription_id_period_start_key
--
-- 2. Same columns, opposite sort direction. Less obvious, and the reason this
--    is easy to get wrong in review: a btree can be walked in either direction,
--    so a DESC index answers an ASC-ordered query and vice versa.
--      voice_sessions_cost_idx    (user_id, started_at)      <- voice_sessions_user_idx (user_id, started_at DESC)
--      evidence_packages_app_idx  (application_id, version DESC) <- evidence_packages_application_id_version_key (application_id, version)
--
--    VERIFIED, not assumed. On the seeded stack (56,251 messages) with only a
--    DESC index present, an ASC-ordered query planned as:
--        Limit -> Index Scan Backward using tmp_msg_desc on messages
--    The first attempt at this proof was run against EMPTY tables and returned
--    Seq Scan, which proves nothing — exactly the trap PERF-001 describes.
--
-- NOT DROPPED, though they looked like duplicates by column list:
--   checklist_items_meta_kind_idx / _meta_owner_idx — different expressions
--     ((meta->>'kind') vs (meta->>'owner')), not duplicates at all.
--   partner_applications_client_idx — PARTIAL (WHERE revoked_at IS NULL). It is
--     smaller than the unique index and serves the common active-only lookup.
--
-- SAFE: no table, column, policy or row is touched, and no query loses an
-- access path. Reversible — the rollback recreates all five.
-- =====================================================================

drop index if exists public.idx_applications_monitor_token;
drop index if exists public.audit_events_app_seq_idx;
drop index if exists public.subscription_credits_balance_idx;
drop index if exists public.voice_sessions_cost_idx;
drop index if exists public.evidence_packages_app_idx;

-- =====================================================================
-- ROLLBACK:
--   create index idx_applications_monitor_token on public.applications (monitor_token);
--   create index audit_events_app_seq_idx on public.audit_events (application_id, seq);
--   create index subscription_credits_balance_idx on public.subscription_credits (subscription_id, period_start);
--   create index voice_sessions_cost_idx on public.voice_sessions (user_id, started_at);
--   create index evidence_packages_app_idx on public.evidence_packages (application_id, version desc);
-- =====================================================================
