-- PRICE-6 — record Hybrid-C per-visa processing-fee payments.
-- Additive + non-breaking: widen the feature check and capture the corridor +
-- charged amount. Existing 'plan'/'prefill' rows stay valid. The full PlanTier→
-- product reconciliation is PRICE-12; this only unblocks the processing-fee charge.

alter table public.payments
  add column if not exists visa_type    text,
  add column if not exists country_code text,
  add column if not exists amount_cents integer
    check (amount_cents is null or amount_cents >= 0);

-- Widen the (inline-named) feature check to allow 'processing_fee'.
do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.payments'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%feature%';
  if cname is not null then
    execute format('alter table public.payments drop constraint %I', cname);
  end if;
end $$;

alter table public.payments
  add constraint payments_feature_check
  check (feature in ('plan', 'prefill', 'processing_fee'));
