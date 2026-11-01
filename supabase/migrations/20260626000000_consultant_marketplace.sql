-- Consultant Marketplace schema (public marketplace layer on top of the
-- existing internal assignment/approval system).
-- Backs docs/consultant-marketplace (architecture + schema) and
-- docs/case-assignment-engine (matching). Apply with `supabase db push`.
--
-- Conventions mirror existing migrations: uuid PKs, RLS on every table,
-- admin-write via app_metadata.role, public-read on marketplace-facing tables,
-- service-role for system/webhook writes.
--
-- RELATION TO EXISTING TABLES (do not duplicate):
--   * Identity        : consultant = a public.users row (role in app_metadata).
--                       consultant_profiles is the 1:1 marketplace profile.
--   * Case assignment : public.consultant_assignments already models "assigned
--                       cases" (spec Phase 2 `assigned_cases`). Reused as-is.
--   * Country coverage : public.consultant_countries is the source of truth for
--                       countries_supported. consultant_skills mirrors visa
--                       types + languages only.
--   * Field decisions : public.consultant_approvals (approve/reject/review) is
--                       reused for case-review actions.

-- Helper: is the caller a marketplace admin? (role lives in JWT app_metadata)
create or replace function public.is_marketplace_admin()
returns boolean language sql stable as $$
  select coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin',
    false
  )
$$;

-- ── consultant_profiles (1:1 with users) ──────────────────────────────
-- The public marketplace identity. full_name/email come from users; this row
-- holds the discoverable + payout-relevant profile fields.
create table public.consultant_profiles (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null unique references public.users on delete cascade,
  headline        text,
  bio             text,
  specialization  text[] not null default '{}',     -- e.g. {express_entry,study}
  years_experience integer check (years_experience >= 0),
  license_number  text,
  license_authority text,                            -- e.g. ICCRC/CICC, OISC, MARA
  license_country text,                              -- ISO-2 of issuing authority
  license_verified boolean not null default false,
  hourly_rate_usd numeric(10,2) check (hourly_rate_usd >= 0),
  rating_avg      numeric(3,2) not null default 0 check (rating_avg between 0 and 5),
  rating_count    integer not null default 0 check (rating_count >= 0),
  max_active_cases integer not null default 10 check (max_active_cases >= 0),
  active_status   text not null default 'draft'
                    check (active_status in ('draft','pending_review','active','suspended')),
  kyc_status      text not null default 'none'
                    check (kyc_status in ('none','pending','verified','rejected')),
  stripe_connect_account_id text unique,             -- Stripe Connect (Express) acct
  payouts_enabled boolean not null default false,    -- mirrors Stripe charges/payouts_enabled
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index consultant_profiles_active_idx on public.consultant_profiles (active_status);
create index consultant_profiles_rating_idx on public.consultant_profiles (rating_avg desc);

-- ── consultant_availability ───────────────────────────────────────────
create table public.consultant_availability (
  id              uuid primary key default uuid_generate_v4(),
  consultant_id   uuid not null unique references public.consultant_profiles(id) on delete cascade,
  timezone        text not null default 'UTC',       -- IANA tz, e.g. America/Toronto
  working_hours   jsonb not null default '{}'::jsonb,-- {mon:[["09:00","17:00"]], ...}
  max_cases       integer not null default 10 check (max_cases >= 0),
  accepting_new   boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- ── consultant_skills (visa types + languages; countries via consultant_countries) ─
create table public.consultant_skills (
  id              uuid primary key default uuid_generate_v4(),
  consultant_id   uuid not null unique references public.consultant_profiles(id) on delete cascade,
  visa_types      text[] not null default '{}',      -- matches pricing_visa_tiers.visa_type
  languages       text[] not null default '{}',      -- BCP-47 / ISO-639 codes
  countries_supported text[] not null default '{}',  -- denormalized mirror of consultant_countries
  updated_at      timestamptz not null default now()
);
create index consultant_skills_visa_gin on public.consultant_skills using gin (visa_types);
create index consultant_skills_lang_gin on public.consultant_skills using gin (languages);

-- ── consultant_reviews (applicant ratings) ────────────────────────────
create table public.consultant_reviews (
  id              uuid primary key default uuid_generate_v4(),
  consultant_id   uuid not null references public.consultant_profiles(id) on delete cascade,
  user_id         uuid not null references public.users on delete cascade,
  application_id  uuid references public.applications on delete set null,
  rating          integer not null check (rating between 1 and 5),
  feedback        text,
  created_at      timestamptz not null default now(),
  unique (consultant_id, user_id, application_id)     -- one review per case
);
create index consultant_reviews_consultant_idx on public.consultant_reviews (consultant_id, created_at desc);

-- ── consultant_commission_rules (revenue model: %, fixed, country/visa/consultant-scoped) ─
-- Resolution precedence (most specific wins): consultant > visa+country > country > visa > global.
create table public.consultant_commission_rules (
  id              uuid primary key default uuid_generate_v4(),
  scope           text not null
                    check (scope in ('global','country','visa','country_visa','consultant')),
  country_code    text,                               -- null unless scope touches country
  visa_type       text,                               -- null unless scope touches visa
  consultant_id   uuid references public.consultant_profiles(id) on delete cascade,
  model           text not null check (model in ('percentage','fixed')),
  platform_pct    numeric(5,4) check (platform_pct between 0 and 1),  -- e.g. 0.2000 = 20%
  platform_fixed_usd numeric(10,2) check (platform_fixed_usd >= 0),
  effective_from  timestamptz not null default now(),
  active          boolean not null default true,
  note            text,
  created_at      timestamptz not null default now(),
  -- exactly one of pct/fixed must be set for the chosen model
  constraint commission_model_value check (
    (model = 'percentage' and platform_pct is not null and platform_fixed_usd is null) or
    (model = 'fixed'      and platform_fixed_usd is not null and platform_pct is null)
  )
);
create index commission_rules_lookup_idx
  on public.consultant_commission_rules (scope, country_code, visa_type, active);

-- ── consultant_service_orders (the money spine: user buys a consultant service) ─
-- Pay-in row. On Stripe capture, commission is split into platform_fee + payout.
create table public.consultant_service_orders (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.users on delete cascade,
  consultant_id   uuid not null references public.consultant_profiles(id) on delete restrict,
  application_id  uuid references public.applications on delete set null,
  service_type    text not null
                    check (service_type in ('premium_review','consultation','priority_processing','document_review')),
  currency        text not null default 'usd',
  amount_usd      numeric(10,2) not null check (amount_usd >= 0),       -- gross charged to user
  platform_fee_usd numeric(10,2) not null default 0 check (platform_fee_usd >= 0),
  consultant_payout_usd numeric(10,2) not null default 0 check (consultant_payout_usd >= 0),
  commission_rule_id uuid references public.consultant_commission_rules(id),
  status          text not null default 'pending'
                    check (status in ('pending','paid','refunded','failed')),
  stripe_payment_intent_id text unique,
  created_at      timestamptz not null default now(),
  paid_at         timestamptz
);
create index service_orders_consultant_idx on public.consultant_service_orders (consultant_id, status);
create index service_orders_user_idx on public.consultant_service_orders (user_id, created_at desc);

-- ── consultant_payouts (Stripe Connect transfers out) ─────────────────
create table public.consultant_payouts (
  id              uuid primary key default uuid_generate_v4(),
  consultant_id   uuid not null references public.consultant_profiles(id) on delete restrict,
  amount_usd      numeric(10,2) not null check (amount_usd >= 0),
  currency        text not null default 'usd',
  status          text not null default 'pending'
                    check (status in ('pending','in_transit','paid','failed','reversed')),
  stripe_transfer_id text unique,
  period_start    date,
  period_end      date,
  payout_date     timestamptz,
  note            text,
  created_at      timestamptz not null default now()
);
create index consultant_payouts_consultant_idx on public.consultant_payouts (consultant_id, status);

-- Link service orders to the payout that swept them (m:1).
create table public.consultant_payout_items (
  id              uuid primary key default uuid_generate_v4(),
  payout_id       uuid not null references public.consultant_payouts(id) on delete cascade,
  service_order_id uuid not null unique references public.consultant_service_orders(id) on delete restrict,
  amount_usd      numeric(10,2) not null check (amount_usd >= 0)
);

-- ── consultations (scheduling: Zoom / Google Meet / MS Teams) ─────────
create table public.consultations (
  id              uuid primary key default uuid_generate_v4(),
  consultant_id   uuid not null references public.consultant_profiles(id) on delete cascade,
  user_id         uuid not null references public.users on delete cascade,
  application_id  uuid references public.applications on delete set null,
  service_order_id uuid references public.consultant_service_orders(id) on delete set null,
  provider        text not null check (provider in ('zoom','google_meet','ms_teams')),
  meeting_url     text,
  external_event_id text,                             -- provider meeting/event id
  scheduled_start timestamptz not null,
  scheduled_end   timestamptz not null,
  timezone        text not null default 'UTC',
  status          text not null default 'requested'
                    check (status in ('requested','confirmed','completed','cancelled','no_show')),
  created_at      timestamptz not null default now(),
  constraint consultations_time_order check (scheduled_end > scheduled_start)
);
create index consultations_consultant_idx on public.consultations (consultant_id, scheduled_start);
create index consultations_user_idx on public.consultations (user_id, scheduled_start);

-- ── Rating rollup trigger (keeps consultant_profiles.rating_avg/count fresh) ─
create or replace function public.refresh_consultant_rating()
returns trigger language plpgsql security definer set search_path = public as $$
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
create trigger consultant_reviews_rollup
  after insert or update or delete on public.consultant_reviews
  for each row execute function public.refresh_consultant_rating();

-- ── RLS ───────────────────────────────────────────────────────────────
alter table public.consultant_profiles          enable row level security;
alter table public.consultant_availability       enable row level security;
alter table public.consultant_skills             enable row level security;
alter table public.consultant_reviews            enable row level security;
alter table public.consultant_commission_rules   enable row level security;
alter table public.consultant_service_orders     enable row level security;
alter table public.consultant_payouts            enable row level security;
alter table public.consultant_payout_items       enable row level security;
alter table public.consultations                 enable row level security;

-- consultant_profiles: ACTIVE profiles are publicly browsable; owner + admin write.
create policy consultant_profiles_public_read on public.consultant_profiles
  for select using (active_status = 'active' or auth.uid() = user_id or public.is_marketplace_admin());
create policy consultant_profiles_owner_write on public.consultant_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy consultant_profiles_admin_write on public.consultant_profiles
  for all using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());

-- availability + skills: public read (for matching/browse), owner write.
create policy consultant_availability_read on public.consultant_availability
  for select using (true);
create policy consultant_availability_owner_write on public.consultant_availability
  for all using (exists (select 1 from public.consultant_profiles cp
                         where cp.id = consultant_id and cp.user_id = auth.uid()))
  with check (exists (select 1 from public.consultant_profiles cp
                      where cp.id = consultant_id and cp.user_id = auth.uid()));
create policy consultant_skills_read on public.consultant_skills
  for select using (true);
create policy consultant_skills_owner_write on public.consultant_skills
  for all using (exists (select 1 from public.consultant_profiles cp
                         where cp.id = consultant_id and cp.user_id = auth.uid()))
  with check (exists (select 1 from public.consultant_profiles cp
                      where cp.id = consultant_id and cp.user_id = auth.uid()));

-- reviews: public read; authenticated users insert their own.
create policy consultant_reviews_read on public.consultant_reviews
  for select using (true);
create policy consultant_reviews_author_write on public.consultant_reviews
  for insert with check (auth.uid() = user_id);
create policy consultant_reviews_author_update on public.consultant_reviews
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- commission rules: ADMIN read+write only (writes also service-role).
create policy commission_rules_admin_all on public.consultant_commission_rules
  for all using (public.is_marketplace_admin()) with check (public.is_marketplace_admin());

-- service orders: buyer + the consultant (owner) + admin read; writes are service-role (Stripe webhook).
create policy service_orders_participant_read on public.consultant_service_orders
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.consultant_profiles cp where cp.id = consultant_id and cp.user_id = auth.uid())
    or public.is_marketplace_admin()
  );

-- payouts: consultant reads own; admin reads all. Writes service-role.
create policy consultant_payouts_owner_read on public.consultant_payouts
  for select using (
    exists (select 1 from public.consultant_profiles cp where cp.id = consultant_id and cp.user_id = auth.uid())
    or public.is_marketplace_admin()
  );
create policy consultant_payout_items_read on public.consultant_payout_items
  for select using (
    exists (select 1 from public.consultant_payouts p
            join public.consultant_profiles cp on cp.id = p.consultant_id
            where p.id = payout_id and (cp.user_id = auth.uid() or public.is_marketplace_admin()))
  );

-- consultations: the two participants + admin read; participants update status.
create policy consultations_participant_read on public.consultations
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.consultant_profiles cp where cp.id = consultant_id and cp.user_id = auth.uid())
    or public.is_marketplace_admin()
  );
create policy consultations_participant_write on public.consultations
  for update using (
    auth.uid() = user_id
    or exists (select 1 from public.consultant_profiles cp where cp.id = consultant_id and cp.user_id = auth.uid())
  ) with check (true);

-- ── Seed: default global commission rule (80/20 — spec Phase 6) ────────
insert into public.consultant_commission_rules (scope, model, platform_pct, note) values
  ('global', 'percentage', 0.2000, 'Default platform take rate: VisaAI 20% / consultant 80%');
