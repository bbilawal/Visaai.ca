-- Rollback for 20261016120000_ca_eta_program.sql
-- Restores the eTA rows to their extracted state (evidence kinds, no rules)
-- and removes the 'eta' pricing tier. Deleted checklist rows are NOT restored:
-- they were never satisfiable, and a rebuild recreates them from the restored
-- requirements if this is ever run.
begin;

update public.visa_requirements r
   set kind = 'evidence',
       description = 'IRCC sends the decision on the eTA application by email.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'valid_email_address';

update public.visa_requirements r
   set kind = 'evidence',
       description = 'IRCC accepts Visa, Mastercard, American Express, pre-paid Visa, Mastercard or American Express, Visa Debit or Debit Mastercard, UnionPay and JCB. It states the fee is non-refundable.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'accepted_payment_method';

update public.visa_requirements r
   set rule = null, description = null
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'passport_from_visa_exempt_country';

update public.visa_requirements r
   set rule = null,
       description = 'IRCC also states that citizens of select visa-required countries may be eligible to apply for an eTA instead of a visitor visa when travelling to Canada by air, but that they still need a visitor visa when arriving by car, bus, train or boat including a cruise ship. Neither country list has been extracted, so this condition carries no rule.'
  from public.visa_types t
 where t.id = r.visa_type_id
   and t.visaai_id = 'ca-electronic-travel-authorization-eta'
   and r.requirement_code = 'eta_required_country_air_travel';

delete from public.pricing_quotes where visa_type = 'eta';
delete from public.pricing_visa_tiers where visa_type = 'eta';

commit;
