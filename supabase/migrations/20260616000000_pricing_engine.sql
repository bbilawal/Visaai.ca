-- Pricing engine schema (config-driven dynamic pricing).
-- Backs docs/pricing 07 (engine) + 08 (profitability). Apply with `supabase db push`.
-- Conventions mirror existing migrations: uuid PKs, RLS on every table,
-- admin-write via app_metadata.role, public-read on price-facing tables.

-- Helper: is the caller an admin? (role lives in JWT app_metadata, same as elsewhere)
create or replace function public.is_pricing_admin()
returns boolean language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$$;

-- ── pricing_constants ─────────────────────────────────────────────────
-- Global tunables (07 §1). key/value so new constants need no migration.
create table public.pricing_constants (
  id          uuid primary key default uuid_generate_v4(),
  key         text not null,
  value       numeric not null,
  note        text,
  effective_from timestamptz not null default now(),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (key, effective_from)
);

-- ── pricing_visa_tiers ────────────────────────────────────────────────
create table public.pricing_visa_tiers (
  id          uuid primary key default uuid_generate_v4(),
  visa_type   text not null unique,
  complexity_tier text not null check (complexity_tier in ('low','med','med_high','high')),
  compressed_review_hours numeric not null check (compressed_review_hours >= 0),
  lawyer_flag boolean not null default false,
  priceable   boolean not null default true,   -- false = excluded (e.g. refugee/humanitarian)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── pricing_country_factors ───────────────────────────────────────────
create table public.pricing_country_factors (
  id          uuid primary key default uuid_generate_v4(),
  country_code text not null unique,            -- ISO-2, matches strategy registry
  labor_band  text not null check (labor_band in ('low','mid','high','origin')),
  labor_multiplier numeric not null check (labor_multiplier > 0),    -- vs Canada (05 §5)
  ai_complexity_multiplier numeric not null default 1.0 check (ai_complexity_multiplier > 0),
  ppp_factor  numeric not null default 1.0 check (ppp_factor > 0),
  reviewer_rate_usd numeric not null check (reviewer_rate_usd > 0),  -- blended (05 §2)
  price_band_min numeric not null check (price_band_min >= 0),
  price_band_max numeric not null check (price_band_max >= price_band_min),
  priceable   boolean not null default true,    -- false/AI-only for origin markets
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ── pricing_quotes (materialized engine output) ───────────────────────
create table public.pricing_quotes (
  id          uuid primary key default uuid_generate_v4(),
  visa_type   text not null references public.pricing_visa_tiers(visa_type) on delete cascade,
  country_code text not null references public.pricing_country_factors(country_code) on delete cascade,
  recommended_price numeric not null check (recommended_price >= 0),
  floor_price numeric not null check (floor_price >= 0),
  ceiling_price numeric,
  gross_margin numeric not null check (gross_margin >= -1 and gross_margin <= 1),
  total_cogs  numeric not null check (total_cogs >= 0),
  breakdown   jsonb not null default '{}'::jsonb,   -- ai_cost, payout, pay_fee, anchor, ppp, demand
  flags       text[] not null default '{}',         -- margin_at_risk | lawyer_flag | excluded
  config_snapshot_id uuid,
  computed_at timestamptz not null default now(),
  unique (visa_type, country_code)
);
create index pricing_quotes_country_idx on public.pricing_quotes (country_code);

-- ── pricing_quote_audit (immutable log) ───────────────────────────────
create table public.pricing_quote_audit (
  id          uuid primary key default uuid_generate_v4(),
  visa_type   text not null,
  country_code text not null,
  recommended_price numeric not null,
  gross_margin numeric not null,
  breakdown   jsonb not null default '{}'::jsonb,
  config_snapshot_id uuid,
  shown_to_user uuid,                              -- nullable: set when a price is displayed
  event       text not null default 'recompute',   -- recompute | shown | override
  created_at  timestamptz not null default now()
);
create index pricing_quote_audit_lookup_idx on public.pricing_quote_audit (visa_type, country_code, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.pricing_constants        enable row level security;
alter table public.pricing_visa_tiers        enable row level security;
alter table public.pricing_country_factors   enable row level security;
alter table public.pricing_quotes            enable row level security;
alter table public.pricing_quote_audit        enable row level security;

-- Price-facing config + quotes: PUBLIC READ (prices shown pre-auth), ADMIN WRITE.
create policy pricing_constants_read on public.pricing_constants
  for select using (true);
create policy pricing_constants_admin_write on public.pricing_constants
  for all using (public.is_pricing_admin()) with check (public.is_pricing_admin());

create policy visa_tiers_read on public.pricing_visa_tiers
  for select using (true);
create policy visa_tiers_admin_write on public.pricing_visa_tiers
  for all using (public.is_pricing_admin()) with check (public.is_pricing_admin());

create policy country_factors_read on public.pricing_country_factors
  for select using (true);
create policy country_factors_admin_write on public.pricing_country_factors
  for all using (public.is_pricing_admin()) with check (public.is_pricing_admin());

create policy quotes_read on public.pricing_quotes
  for select using (true);
-- pricing_quotes written by the service-role recompute job (bypasses RLS); no anon write policy.

-- Audit: ADMIN READ only; writes are service-role (bypass RLS). No anon policy.
create policy quote_audit_admin_read on public.pricing_quote_audit
  for select using (public.is_pricing_admin());

-- ── Seed: constants (07 §1) ───────────────────────────────────────────
insert into public.pricing_constants (key, value, note) values
  ('min_margin', 0.55, 'checkout floor (06 checkpoint)'),
  ('target_margin', 0.65, 'planning target'),
  ('premium_margin', 0.75, 'premium SKUs / high-PPP'),
  ('max_capture', 0.15, 'price <= 15% of human fee (02)'),
  ('rework_load', 1.35, 'escalation + revision loading (05 §4.3)'),
  ('take_rate', 0.20, 'marketplace cut of consultant payout (06)'),
  ('k_ai_low', 0.17, 'AI compression: 1.5h -> 0.25h'),
  ('k_ai_med', 0.17, 'AI compression: 4.5h -> 0.75h'),
  ('k_ai_high', 0.29, 'AI compression: 14h -> 4.0h (lawyer-flagged)');

-- ── Seed: visa tiers (05 §3 + 07 §3) ──────────────────────────────────
insert into public.pricing_visa_tiers (visa_type, complexity_tier, compressed_review_hours, lawyer_flag, priceable) values
  ('visitor',            'low',      0.25, false, true),
  ('tourist',            'low',      0.25, false, true),
  ('digital_nomad',      'low',      0.25, false, true),
  ('open_work_permit',   'low',      0.30, false, true),
  ('student',            'med',      0.75, false, true),
  ('work_permit',        'med',      0.75, false, true),
  ('citizenship',        'med',      0.67, false, true),
  ('family_sponsorship', 'med_high', 1.50, false, true),
  ('permanent_residency','med_high', 1.50, false, true),
  ('express_entry',      'med_high', 1.50, false, true),
  ('business',           'high',     4.00, true,  true),
  ('startup',            'high',     4.00, true,  true),
  ('investor',           'high',     4.00, true,  true),
  ('refugee_humanitarian','high',    4.00, true,  false);  -- excluded from commercial engine (08 §2)

-- ── Seed: country factors (02 + 05 §5) ────────────────────────────────
-- reviewer_rate_usd = blended (05 §2); price band = 02; ppp normalized to Canada=1.0.
insert into public.pricing_country_factors
  (country_code, labor_band, labor_multiplier, ai_complexity_multiplier, ppp_factor, reviewer_rate_usd, price_band_min, price_band_max, priceable) values
  ('CA','mid',   1.00, 1.15, 1.00, 125, 150, 600, true),
  ('US','high',  1.58, 1.30, 1.30, 197, 200, 800, true),
  ('GB','high',  1.58, 1.10, 1.05, 198, 150, 650, true),
  ('AU','high',  1.78, 0.95, 1.05, 223, 150, 650, true),
  ('NZ','mid',   1.39, 0.95, 1.00, 174, 150, 550, true),
  ('DE','high',  1.66, 0.85, 1.05, 208, 150, 550, true),
  ('FR','high',  1.54, 0.85, 1.00, 192, 150, 550, true),
  ('NL','high',  1.62, 0.85, 1.05, 203, 150, 650, true),
  ('IE','high',  1.74, 0.85, 1.05, 218, 180, 600, true),
  ('AE','mid',   1.19, 1.00, 1.10, 149, 150, 500, true),
  ('SA','mid',   1.06, 1.00, 1.05, 132, 120, 450, true),
  ('SG','high',  1.49, 1.00, 1.30, 186, 200, 800, true),
  ('JP','low',   0.85, 0.95, 0.90, 106, 120, 450, true),
  ('KR','low',   0.74, 0.95, 0.95,  93, 120, 450, true),
  ('IN','origin',0.80, 1.00, 0.50, 100,  50, 200, false),  -- AI-only at origin (08 §3)
  ('NG','origin',0.80, 1.00, 0.45, 100,  50, 200, false),
  ('PH','origin',0.80, 1.00, 0.50, 100,  50, 200, false),
  ('CN','origin',0.80, 1.00, 0.55, 100,  80, 200, false);
