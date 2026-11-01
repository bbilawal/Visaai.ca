-- SP3 — coupons/promotions/redemptions (doc 40) + add-ons (doc 30 §3) + payment
-- tax/invoice/discount capture. Floor guardrail lives in app; redeem_coupon is the
-- atomic max_redemptions guard.

-- Admin predicate (doc 40 uses is_pricing_admin()); mirror the jwt admin check.
create or replace function public.is_pricing_admin()
returns boolean as $$
  select (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin';
$$ language sql stable;

create table if not exists public.coupons (
  id uuid primary key default uuid_generate_v4(),
  code text not null unique,
  stripe_coupon_id text,
  kind text not null check (kind in ('percent','amount')),
  percent_off numeric check (percent_off is null or (percent_off > 0 and percent_off <= 100)),
  amount_off_cents integer check (amount_off_cents is null or amount_off_cents > 0),
  currency text not null default 'usd',
  applies_to text not null default 'processing_fee'
    check (applies_to in ('processing_fee','addon','subscription','any')),
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redeemed_count integer not null default 0 check (redeemed_count >= 0),
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((kind='percent' and percent_off is not null and amount_off_cents is null)
      or (kind='amount'  and amount_off_cents is not null and percent_off is null))
);
alter table public.coupons enable row level security;
create policy coupons_public_read on public.coupons for select using (active = true);
create policy coupons_admin_write on public.coupons for all
  using (public.is_pricing_admin()) with check (public.is_pricing_admin());

create table if not exists public.promotions (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  coupon_id uuid not null references public.coupons on delete cascade,
  stripe_promotion_code_id text,
  audience text not null default 'all'
    check (audience in ('all','returning','family_bundle','new_corridor','manual')),
  country_code text,
  visa_type text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.promotions enable row level security;
create policy promotions_public_read on public.promotions for select using (active = true);
create policy promotions_admin_write on public.promotions for all
  using (public.is_pricing_admin()) with check (public.is_pricing_admin());

create table if not exists public.discount_redemptions (
  id uuid primary key default uuid_generate_v4(),
  coupon_id uuid not null references public.coupons on delete restrict,
  promotion_id uuid references public.promotions on delete set null,
  user_id uuid not null references public.users on delete cascade,
  application_id uuid references public.applications on delete set null,
  payment_id uuid references public.payments on delete set null,
  list_price_cents integer not null check (list_price_cents >= 0),
  discount_cents integer not null check (discount_cents >= 0),
  charged_price_cents integer not null check (charged_price_cents >= 0),
  resulting_margin numeric not null check (resulting_margin >= -1 and resulting_margin <= 1),
  floor_ok boolean not null,
  config_snapshot_id uuid,
  created_at timestamptz not null default now()
);
alter table public.discount_redemptions enable row level security;
create policy discount_redemptions_admin_read on public.discount_redemptions
  for select using (public.is_pricing_admin());
create index if not exists discount_redemptions_lookup_idx
  on public.discount_redemptions (coupon_id, created_at desc);

create table if not exists public.addon_purchases (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users on delete cascade,
  application_id uuid not null references public.applications on delete cascade,
  payment_id uuid references public.payments on delete set null,
  addon_sku text not null check (addon_sku in
    ('addon_document_review','addon_rush_sla','addon_premium_upgrade')),
  amount_cents integer not null check (amount_cents >= 0),
  stripe_payment_intent_id text,
  status text not null default 'complete' check (status in ('pending','complete','refunded')),
  created_at timestamptz not null default now()
);
alter table public.addon_purchases enable row level security;
create policy addon_purchases_own_read on public.addon_purchases
  for select using (auth.uid() = user_id);
create index if not exists addon_purchases_app_idx
  on public.addon_purchases (application_id, addon_sku, status);

-- payments: capture invoice + tax + discount; allow the 'addon' feature.
alter table public.payments
  add column if not exists invoice_id text,
  add column if not exists invoice_url text,
  add column if not exists tax_cents integer,
  add column if not exists discount_cents integer;

do $$
declare cname text;
begin
  select conname into cname from pg_constraint
   where conrelid = 'public.payments'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%feature%';
  if cname is not null then
    execute format('alter table public.payments drop constraint %I', cname);
  end if;
end $$;
alter table public.payments
  add constraint payments_feature_check
  check (feature in ('plan','prefill','processing_fee','addon'));

-- Atomic redemption counter — respects max_redemptions under concurrency.
create or replace function public.redeem_coupon(p_coupon_id uuid)
returns boolean as $$
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
$$ language plpgsql security definer;

-- ROLLBACK:
--   drop function if exists public.redeem_coupon(uuid);
--   alter table public.payments drop column if exists invoice_id, drop column if exists invoice_url,
--     drop column if exists tax_cents, drop column if exists discount_cents;
--   drop table if exists public.addon_purchases;
--   drop table if exists public.discount_redemptions;
--   drop table if exists public.promotions;
--   drop table if exists public.coupons;
--   drop function if exists public.is_pricing_admin();
