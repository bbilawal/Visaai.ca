-- Canada visitor visa (TRV): add the bank statement IRCC recommends.
-- Date: 2026-10-29  (live bug, app 945eb7f1: self-funded Pakistani tourist)
--
-- Source of truth: data/requirements/ca-visitor-visa.json (row bank_statement,
-- added in the same commit). Regression test:
-- apps/api/src/modules/visa-rules/ca-visitor-visa-checklist.spec.ts.
--
-- WHAT WAS WRONG
--
-- The TRV registry had NO funds document. The only funds row is
-- sufficient_funds (5a11c12d-5821-4814-b52c-e7c07046c89a), kind 'condition'
-- ("have enough money for your stay"), which registry-to-framework.ts
-- correctly never turns into an upload. The extraction (20260821210000)
-- captured travel_history from the apply page's "Recommended documents"
-- heading but missed the "Bank account statement" entry under the SAME
-- heading. Since the route is registry-backed, the strategy's proof_of_funds
-- default no longer applies, so applicants had no slot for their own
-- statements, and the IRCC fill's "Proof of financial support" upload
-- (ircc-uploads.ts, slot 'funds': proof_of_funds | bank_statement | ...)
-- had nothing to attach. (#188 / 20261018120000 touched only
-- ca-business-visitors, not this route.)
--
-- THE ROW
--
-- kind 'recommended', officially_required false: IRCC's own heading. The
-- requirement_code is 'bank_statement', the type the document classifier
-- assigns to uploaded statements and the type the IRCC funds slot attaches.
-- Excerpt re-checked against the live page on 2026-10-29 with
-- apps/api/scripts/verify-excerpts.ts (19/19 verbatim) and
-- check-excerpt-shape.ts (0 rejected).
--
-- Inserted directly as 'active' (single reviewed row; same review standard as
-- the v2 promote files). Existing applications pick it up when their checklist
-- is next rebuilt (base_requirement rows are added on rebuild, never removed
-- here).
--
-- Apply (NOT applied by this commit):
--   docker exec -i selfhosted_db psql -U supabase_admin -d postgres -1 < this file
-- Rollback: rollback/20261029120000_ca_visitor_visa_bank_statement.down.sql

begin;

insert into public.visa_requirements (
  visa_type_id, requirement_code, kind, officially_required, label, description,
  official_form_code, official_form_url, rule, parameters,
  source_version_id, source_excerpt, source_excerpt_display, extraction_method, confidence,
  status, display_order, last_verified_at
) values (
  (select id from public.visa_types where visaai_id = 'ca-visitor-visa-temporary-resident-visa'),
  'bank_statement', 'recommended', false,
  'Bank account statement (proof of funds)',
  'IRCC lists this under a heading it labels "recommended documents", not as a requirement. It shows you have enough money to support yourself during your stay.',
  null, null,
  null, '{}'::jsonb,
  -- Same visa-type-scoped source lookup as 20260821210000 (passport_copy).
  (select v.id from public.visa_source_versions v
     join public.visa_sources s on s.id = v.source_id
    where s.source_url = 'https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/apply-visitor-visa.html'
      and v.is_active
      and (s.visa_type_id is null
           or s.visa_type_id = (select id from public.visa_types
                                 where visaai_id = 'ca-visitor-visa-temporary-resident-visa'))
    order by s.visa_type_id nulls last
    limit 1),
  'bank account statement this can help us understand if you have enough money to support yourself during your stay in canada.',
  'Bank account statement This can help us understand if you have enough money to support yourself during your stay in Canada.',
  'manual', 1.00,
  'active', 510, '2026-10-29'::timestamptz
)
on conflict (visa_type_id, requirement_code) where status <> 'retired'
do nothing;

do $$
declare ok int;
begin
  select count(*) into ok
  from public.visa_requirements r
  join public.visa_types t on t.id = r.visa_type_id
  where t.visaai_id = 'ca-visitor-visa-temporary-resident-visa'
    and r.requirement_code = 'bank_statement'
    and r.status = 'active'
    and r.kind = 'recommended'
    and not r.officially_required
    and r.source_version_id is not null;
  if ok <> 1 then
    raise exception 'Expected 1 active bank_statement row on the TRV route with provenance, found %.', ok;
  end if;
end $$;

commit;
