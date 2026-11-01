-- Task 15 — feature flags + beta cohorts.
--
-- WHY THIS EXISTS
--
-- The Task 14 go/no-go checklist recorded row 13 ("Feature flags work") as a
-- PASS with the evidence "Flag system present, `flags:sync` in web". That was a
-- name collision, not a flag system: `apps/web/scripts/sync-flags.mjs` copies
-- **country-flag SVGs** out of the `flag-icons` package into
-- `public/flags/4x3/`. Nothing in this repository could turn a feature on or
-- off. Task 15 §3/§10 and its completion gate all depend on a real one, and
-- Task 16 §8 requires pricing experiments to run through flags rather than
-- code edits, so it is built here.
--
-- DESIGN
--
-- The *set of flags that exist* is declared in code
-- (`apps/api/src/modules/feature-flags/flag-registry.ts`), not in this table.
-- The table only carries **state** for a known key. That split is deliberate:
--
--   * a typo'd key can never silently create a live flag,
--   * every flag has a compile-time `defaultValue` to fall back to when the
--     database is unreachable, so evaluation never has to guess,
--   * deleting a flag is a code change that goes through review.
--
-- Rows for unknown keys are ignored by the evaluator rather than rejected here,
-- so a rollback of application code cannot be blocked by a leftover row.
--
-- KILL SWITCH SEMANTICS
--
-- `enabled = false` is an unconditional OFF: it beats percentage rollout,
-- cohorts, roles and the explicit allow-list. That ordering is what makes this
-- usable as an incident control — an operator flipping one boolean must not
-- have to reason about whether some other column still lets traffic through.
--
-- RLS
--
-- `feature_flags` and `feature_flag_audit` have RLS enabled with NO permissive
-- policy, so they are reachable only by the service-role client (the API's
-- system path). Clients never read the table; they read *evaluated* booleans
-- from `GET /feature-flags`, which returns only flags marked `client_exposed`
-- in the code registry. This keeps targeting rules (cohort names, allow-listed
-- user ids) off the wire.
--
-- Task 14 found a live cross-tenant leak caused by a view that ran as its owner
-- (SEC-22). No views are created here. Every function below pins
-- `search_path = public, extensions, pg_temp` — `extensions` is required
-- because Supabase installs pgcrypto/uuid-ossp there, and omitting it is what
-- broke `field_provenance_create_version` during the Task 14 hardening pass.

-- ---------------------------------------------------------------------------
-- Beta cohorts
-- ---------------------------------------------------------------------------
-- Cohorts exist as a table rather than a doc because feature-flag targeting
-- dereferences them. A cohort named in `feature_flags.allowed_cohorts` that has
-- no row here simply matches nobody — targeting fails closed.

create table if not exists public.beta_cohorts (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique
                 check (slug ~ '^[a-z][a-z0-9-]{1,48}[a-z0-9]$'),
  name         text not null,
  description  text not null default '',
  -- Hard cap from the beta plan. Enforced in the service on join, not by a
  -- constraint, because the limit is a policy decision that operators change.
  max_members  integer not null default 0 check (max_members >= 0),
  -- Platform restriction for the cohort ('web', 'ios', 'android'). Empty = all.
  platforms    text[] not null default '{}',
  status       text not null default 'planned'
                 check (status in ('planned', 'open', 'closed')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.beta_cohorts is
  'Closed-beta cohorts (Task 15 §2). Referenced by feature_flags.allowed_cohorts.';

create table if not exists public.beta_cohort_members (
  id           uuid primary key default gen_random_uuid(),
  cohort_id    uuid not null references public.beta_cohorts on delete cascade,
  user_id      uuid not null references public.users on delete cascade,
  -- Lifecycle. `invited_at` is set when the operator adds the tester;
  -- `accepted_at` when they first authenticate as a member; `exited_at` when
  -- they leave or are removed (Task 15 §2 "Exit rules").
  invited_at   timestamptz not null default now(),
  accepted_at  timestamptz,
  exited_at    timestamptz,
  exit_reason  text,
  created_at   timestamptz not null default now(),
  unique (cohort_id, user_id)
);

-- Partial index: membership lookup during flag evaluation only ever asks for
-- *active* memberships, and this runs on every evaluation cache miss.
create index if not exists beta_cohort_members_active_idx
  on public.beta_cohort_members (user_id)
  where exited_at is null;

create index if not exists beta_cohort_members_cohort_idx
  on public.beta_cohort_members (cohort_id, exited_at);

alter table public.beta_cohorts enable row level security;
alter table public.beta_cohort_members enable row level security;

-- Cohort definitions are operator data → service-role only (no policy).
-- Membership is readable by the member: a tester is entitled to know which beta
-- they are in, and the beta UI shows it. Writes stay service-role only.
create policy beta_cohort_members_self_read
  on public.beta_cohort_members
  for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Feature flags
-- ---------------------------------------------------------------------------

create table if not exists public.feature_flags (
  key                text primary key
                       check (key ~ '^[a-z][a-z0-9_.]{1,62}[a-z0-9]$'),
  description        text not null default '',

  -- Master kill switch. false = OFF for everyone, unconditionally.
  enabled            boolean not null default false,

  -- Deterministic percentage rollout, applied only when `enabled` is true and
  -- no higher-precedence allow rule already matched. 0 = nobody, 100 = all.
  rollout_percentage smallint not null default 0
                       check (rollout_percentage between 0 and 100),

  -- Allow rules. Any match short-circuits to ON (still subject to `enabled`).
  allowed_roles      text[] not null default '{}',   -- 'admin' | 'consultant' | 'user'
  allowed_cohorts    text[] not null default '{}',   -- beta_cohorts.slug
  allowed_user_ids   uuid[] not null default '{}',

  -- Environment restriction ('development' | 'staging' | 'production').
  -- Empty = every environment. A flag whose list excludes the running
  -- environment evaluates to its registry default, not to ON.
  environments       text[] not null default '{}',

  updated_by         uuid references public.users on delete set null,
  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

comment on table public.feature_flags is
  'Runtime state for flags DECLARED IN CODE (feature-flags/flag-registry.ts). '
  'A row for an unregistered key is ignored by the evaluator.';

-- Every state change is recorded. Task 16 §4 requires a launch decision log,
-- and "who turned payments off at 02:14" is exactly the question an incident
-- review asks. Retained independently of the flag row so deleting a flag does
-- not erase its history.
create table if not exists public.feature_flag_audit (
  id          uuid primary key default gen_random_uuid(),
  flag_key    text not null,
  action      text not null check (action in ('created', 'updated', 'deleted')),
  -- Full before/after state. jsonb rather than per-column deltas so the shape
  -- survives future columns without another migration.
  before      jsonb,
  after       jsonb,
  actor_id    uuid references public.users on delete set null,
  actor_email text,
  reason      text,
  created_at  timestamptz not null default now()
);

create index if not exists feature_flag_audit_flag_idx
  on public.feature_flag_audit (flag_key, created_at desc);

alter table public.feature_flags enable row level security;
alter table public.feature_flag_audit enable row level security;
-- No policy on either, on purpose → service-role only. Clients receive
-- evaluated booleans from the API, never the targeting rules.

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
-- `extensions` is required: Supabase installs pgcrypto/uuid-ossp there, and a
-- pin of just `public, pg_temp` breaks any function reaching them (Task 14).
set search_path = public, extensions, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists beta_cohorts_touch on public.beta_cohorts;
create trigger beta_cohorts_touch
  before update on public.beta_cohorts
  for each row execute function public.touch_updated_at();

drop trigger if exists feature_flags_touch on public.feature_flags;
create trigger feature_flags_touch
  before update on public.feature_flags
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: kill switches the beta checklist names
-- ---------------------------------------------------------------------------
-- Seeded OFF-by-default only where OFF is the safe state. The three kill
-- switches guard subsystems that are ALREADY live and must stay live until an
-- operator decides otherwise, so they seed `enabled = true, rollout = 100`:
-- shipping this migration must not turn off AI, payments or the marketplace.
--
-- `portal_autofill` seeds OFF: it is the highest-risk surface in the product
-- (it drives a browser against a government portal) and the beta environment
-- checklist already calls for it to default off.

insert into public.feature_flags
  (key, description, enabled, rollout_percentage)
values
  ('ai_generation_enabled',
   'Kill switch for AI document generation and case processing.',
   true, 100),
  ('payments_enabled',
   'Kill switch for checkout, subscriptions and any charge path.',
   true, 100),
  ('consultant_marketplace_enabled',
   'Kill switch for consultant discovery, booking and messaging.',
   true, 100),
  ('portal_autofill_enabled',
   'Government-portal auto-fill via the extension/sidecar. Highest-risk surface.',
   false, 0),
  ('voice_assistant_enabled',
   'AI voice assistant sessions. Off until a device run is evidenced.',
   false, 0),
  ('beta_banner_enabled',
   'Shows the "closed beta — do not use for a real filing" banner.',
   false, 0),
  ('beta_feedback_widget_enabled',
   'In-app feedback widget (Task 15 §6).',
   false, 0)
on conflict (key) do nothing;
