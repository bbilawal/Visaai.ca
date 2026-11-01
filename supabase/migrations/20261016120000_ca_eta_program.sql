-- =====================================================================
-- Canada eTA behaves as an eTA, not a visitor visa.
-- Date: 2026-10-16  (dry run 2026-10-16, app a37a534b, Pakistani applicant)
--
-- Source of truth: data/requirements/ca-electronic-travel-authorization-eta.json
-- (kept in sync by hand in the same PR; the generator emits INSERTs for new
-- extractions, and these rows already exist).
--
-- 1. valid_email_address and accepted_payment_method: evidence -> condition.
--    As evidence they became required UPLOAD slots, and a photo of a VOID
--    payment card was accepted and marked Verified. A card image is
--    cardholder data VisaAI has no reason to hold (IRCC takes the card on its
--    own payment page); an email address is typed, not scanned. The API also
--    refuses to turn either into a document (registry-to-framework.ts
--    NEVER_UPLOADED), so this is the data fix behind a code guard.
--
-- 2. passport_from_visa_exempt_country gets a nationality rule: IRCC's
--    eTA-required list plus the conditional CAN+ list (read 2026-10-16 from
--    entry-requirements-country.html, page dated 2026-07-31; mirrored in
--    packages/types/src/canada-eta.ts). A Pakistani passport was "Verified"
--    in this slot; with the rule, the slot does not apply to it.
--
-- 3. eta_required_country_air_travel gets its rule (visa-exempt list AND
--    travel_by_air). The rule facts travel_by_air / us_lpr /
--    valid_us_nonimmigrant_visa / canadian_visa_last_10y are added to the
--    closed vocabulary in apps/api/src/modules/visa-rules/rule.types.ts.
--
-- 4. Checklist rows already built from (1) on eTA applications: still-missing
--    ones are deleted (they can never be satisfied and must not invite a card
--    upload); any that were uploaded are made optional and left for a human —
--    the uploaded FILE is applicant data and is not touched here.
--
-- 5. pricing_visa_tiers gets an 'eta' tier (low complexity: a short online
--    form, no letters, no evidence bundle). The anchor price is a placeholder
--    for the owner to confirm.
--
-- Data only. Idempotent.
-- Apply (not applied by this PR):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261016120000_ca_eta_program.down.sql
-- =====================================================================

begin;

-- 1 ---------------------------------------------------------------------
update public.visa_requirements r
   set kind = 'condition',
       description = 'IRCC sends the decision on the eTA application by email. The address is typed into the form; it is not a document to upload.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'valid_email_address'
   and r.status <> 'retired';

update public.visa_requirements r
   set kind = 'condition',
       description = 'IRCC accepts Visa, Mastercard, American Express, pre-paid Visa, Mastercard or American Express, Visa Debit or Debit Mastercard, UnionPay and JCB. It states the fee is non-refundable. The card is entered on IRCC''s own payment page: VisaAI never asks for, stores or verifies an image or number of a payment card.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'accepted_payment_method'
   and r.status <> 'retired';

-- 2 ---------------------------------------------------------------------
update public.visa_requirements r
   set rule = '{"fact":"nationality","op":"in","value":["AD","AU","AT","BS","BB","BE","GB","AI","BM","VG","KY","FK","GI","MS","PN","SH","TC","BN","BG","CL","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HK","HU","IS","IE","IL","IT","JP","LV","LI","LT","LU","MT","MC","NL","NZ","NO","PG","PL","PT","QA","KR","RO","WS","SM","SG","SK","SI","SB","ES","SE","CH","TW","AE","VA","AG","AR","BR","CR","ID","MY","MX","MA","PA","PH","KN","LC","VC","SC","TH","TT","UY"]}'::jsonb,
       description = 'Rule: the applicant''s nationality is on IRCC''s eTA-required list or its conditional CAN+ list. Any other passport cannot hold an eTA, so this slot does not apply to it.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'passport_from_visa_exempt_country'
   and r.status <> 'retired';

-- 3 ---------------------------------------------------------------------
update public.visa_requirements r
   set rule = '{"all":[{"fact":"nationality","op":"in","value":["AD","AU","AT","BS","BB","BE","GB","AI","BM","VG","KY","FK","GI","MS","PN","SH","TC","BN","BG","CL","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HK","HU","IS","IE","IL","IT","JP","LV","LI","LT","LU","MT","MC","NL","NZ","NO","PG","PL","PT","QA","KR","RO","WS","SM","SG","SK","SI","SB","ES","SE","CH","TW","AE","VA"]},{"fact":"travel_by_air","op":"eq","value":true}]}'::jsonb,
       description = 'IRCC also states that citizens of select visa-required countries (the CAN+ list) may be eligible to apply for an eTA instead of a visitor visa when travelling to Canada by air, but that they still need a visitor visa when arriving by car, bus, train or boat including a cruise ship. The rule encodes the visa-exempt list and air travel; the CAN+ branch is decided by the eTA program''s eligibility check.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'eta_required_country_air_travel'
   and r.status <> 'retired';

-- 4 ---------------------------------------------------------------------
delete from public.checklist_items c
 using public.applications a, public.visa_types t
 where c.application_id = a.id
   and a.visa_type_id = t.id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and c.document_type in ('valid_email_address', 'accepted_payment_method')
   and c.status = 'missing';

update public.checklist_items c
   set required = false
  from public.applications a, public.visa_types t
 where c.application_id = a.id
   and a.visa_type_id = t.id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and c.document_type in ('valid_email_address', 'accepted_payment_method')
   and c.required;

-- 5 ---------------------------------------------------------------------
insert into public.pricing_visa_tiers
  (visa_type, complexity_tier, compressed_review_hours, lawyer_flag, priceable,
   ai_cost_base_usd, base_anchor_usd, human_fee_usd)
values
  ('eta', 'low', 0.10, false, true, 0.10, 49, 150)
on conflict (visa_type) do nothing;

-- Guards ------------------------------------------------------------------
do $$
declare n_upload integer; n_rule integer;
begin
  select count(*) into n_upload from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ca-electronic-travel-authorization-eta'
     and r.requirement_code in ('valid_email_address', 'accepted_payment_method')
     and r.kind in ('evidence', 'recommended')
     and r.status <> 'retired';
  if n_upload <> 0 then
    raise exception 'eTA email/payment rows still kinded as uploads: %', n_upload;
  end if;

  select count(*) into n_rule from public.visa_requirements r
    join public.visa_types t on t.id = r.visa_type_id
   where t.visaai_id = 'ca-electronic-travel-authorization-eta'
     and r.requirement_code = 'passport_from_visa_exempt_country'
     and r.status <> 'retired'
     and r.rule is not null
     and r.rule->'value' ? 'PK';
  if n_rule <> 0 then
    raise exception 'Pakistan must not be on the eTA passport rule';
  end if;
end $$;

commit;
