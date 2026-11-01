-- Risk / eligibility config (config-driven scoring, no-deploy tuning).
-- Backs docs/eligibility-engine/CONFIG-RULES-PROPOSAL.md (Phase 1: weights +
-- escalation thresholds). Mirrors the pricing engine config pattern
-- (20260616000000_pricing_engine.sql): uuid PKs, RLS on every table,
-- admin-write via app_metadata.role, key/value + active/effective_from versioning.
--
-- DELIBERATE DEVIATION FROM PRICING: these tables are ADMIN-READ-ONLY + ADMIN-WRITE
-- (NOT public-read). Prices are shown pre-auth, but scoring internals must never be
-- visible to applicants — exposing weights/thresholds invites gaming the scorer.
-- The pipeline loads this config via the service-role client (a system path),
-- which bypasses RLS, so admin-only RLS does not block scoring.
--
-- Seeds reproduce the CURRENT hardcoded values so behavior is unchanged on day one:
--   risk_weights           = aggregate-score.ts  WEIGHTS
--   escalation_thresholds  = generate-recommendations.ts WEAK_THRESHOLD (+ new knobs)

-- Helper: is the caller an admin? (role lives in JWT app_metadata, same as elsewhere)
-- Mirrors public.is_pricing_admin().
create or replace function public.is_risk_admin()
returns boolean language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$$;

-- ── risk_weights ──────────────────────────────────────────────────────
-- VRI dimension -> weight. Replaces the WEIGHTS const in aggregate-score.ts.
-- Active weights are expected to sum to ~1.0 (the engine reads them directly;
-- a validator/normalizer can be layered later — see CONFIG-RULES-PROPOSAL §5).
create table public.risk_weights (
  id          uuid primary key default uuid_generate_v4(),
  dimension   text not null check (dimension in
               ('documentation','financial','travel_history',
                'home_ties','employment','consistency')),
  weight      numeric not null check (weight >= 0 and weight <= 1),
  note        text,
  effective_from timestamptz not null default now(),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (dimension, effective_from)
);

-- ── escalation_thresholds ─────────────────────────────────────────────
-- key/value so new thresholds need no migration (mirrors pricing_constants).
-- weak_threshold  -> generate-recommendations.ts weak-factor cutoff (was 70)
-- escalate_below  -> auto-escalate-to-consultant cutoff (NEW HITL feature)
-- max_revisions   -> reserved (narrative self-review cap; ROADMAP M1)
create table public.escalation_thresholds (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null,
  value       numeric not null,
  note        text,
  effective_from timestamptz not null default now(),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (key, effective_from)
);

-- ── escalation flags (persisted output of the auto-escalate feature) ───
-- Per-run record on vri_scores + a denormalized actionable flag on applications
-- (mirrors the existing applications.vri_score denormalization in save-vri.ts).
-- The reason is a non-numeric code so it does not leak the exact cutoff.
alter table public.vri_scores
  add column if not exists escalated boolean not null default false,
  add column if not exists escalation_reason text;

alter table public.applications
  add column if not exists needs_consultant_escalation boolean not null default false,
  add column if not exists escalation_reason text;

-- ── RLS — ADMIN READ + ADMIN WRITE only (no public-read) ──────────────
alter table public.risk_weights          enable row level security;
alter table public.escalation_thresholds enable row level security;

create policy risk_weights_admin_read on public.risk_weights
  for select using (public.is_risk_admin());
create policy risk_weights_admin_write on public.risk_weights
  for all using (public.is_risk_admin()) with check (public.is_risk_admin());

create policy escalation_thresholds_admin_read on public.escalation_thresholds
  for select using (public.is_risk_admin());
create policy escalation_thresholds_admin_write on public.escalation_thresholds
  for all using (public.is_risk_admin()) with check (public.is_risk_admin());

-- ── Seed: weights (day-one parity with aggregate-score.ts WEIGHTS) ────
insert into public.risk_weights (dimension, weight, note) values
  ('documentation',  0.25, 'aggregate-score.ts WEIGHTS (day-one parity)'),
  ('financial',      0.20, 'aggregate-score.ts WEIGHTS (day-one parity)'),
  ('home_ties',      0.20, 'aggregate-score.ts WEIGHTS (day-one parity)'),
  ('consistency',    0.15, 'aggregate-score.ts WEIGHTS (day-one parity)'),
  ('employment',     0.12, 'aggregate-score.ts WEIGHTS (day-one parity)'),
  ('travel_history', 0.08, 'aggregate-score.ts WEIGHTS (day-one parity)');

-- ── Seed: escalation thresholds ───────────────────────────────────────
insert into public.escalation_thresholds (key, value, note) values
  ('weak_threshold', 70, 'generate-recommendations.ts WEAK_THRESHOLD (day-one parity)'),
  ('escalate_below', 50, 'auto-escalate-to-consultant cutoff (new HITL feature)'),
  ('max_revisions',  5,  'narrative self-review cap (reserved; ROADMAP M1)');
