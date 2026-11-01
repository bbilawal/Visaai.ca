-- PRICE-2.1 — promote pricing-engine market inputs from app code into config.
-- The engine (07 §2) needs per-visa ai_cost base, market anchor, and human_fee,
-- plus a global lawyer-rate multiplier. These lived in apps/api .../pricing.reference.ts;
-- this migration moves them into the config tables so pricing stays config-over-code (D4).
-- Additive + idempotent. Canada-anchored (08 §1 ai cost, §2 anchors, 06 human fee).

-- ── pricing_visa_tiers: new market-input columns ──────────────────────
alter table public.pricing_visa_tiers
  add column if not exists ai_cost_base_usd numeric not null default 0 check (ai_cost_base_usd >= 0),
  add column if not exists base_anchor_usd  numeric not null default 0 check (base_anchor_usd  >= 0),
  add column if not exists human_fee_usd    numeric not null default 0 check (human_fee_usd    >= 0);

-- Seed ai_cost base + human_fee by complexity tier (08 §1, 06).
update public.pricing_visa_tiers set
  ai_cost_base_usd = case complexity_tier
    when 'low' then 0.20 when 'med' then 0.38 when 'med_high' then 0.52 when 'high' then 0.55 end,
  human_fee_usd = case complexity_tier
    when 'low' then 500 when 'med' then 1250 when 'med_high' then 2500 when 'high' then 5000 end;

-- Seed Canada market anchor per visa (08 §2). Non-CA corridors scale this by PPP at read time.
update public.pricing_visa_tiers set base_anchor_usd = case visa_type
  when 'visitor'             then 149
  when 'tourist'             then 149
  when 'digital_nomad'       then 149
  when 'open_work_permit'    then 179
  when 'student'             then 349
  when 'work_permit'         then 349
  when 'citizenship'         then 349
  when 'family_sponsorship'  then 699
  when 'permanent_residency' then 699
  when 'express_entry'       then 699
  when 'business'            then 1199
  when 'startup'             then 1199
  when 'investor'            then 1799
  when 'refugee_humanitarian' then 0
  else base_anchor_usd
end;

-- ── pricing_constants: global lawyer-rate multiplier ──────────────────
insert into public.pricing_constants (key, value, note)
select 'lawyer_rate_multiplier', 2.0,
       'lawyer review rate vs blended reviewer rate (08 §2 investor ~$256/h vs $125)'
where not exists (
  select 1 from public.pricing_constants where key = 'lawyer_rate_multiplier'
);
