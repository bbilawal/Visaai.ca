-- Rollback for 20261015180000_consultant_decision_not_applicable.sql
--
-- Postgres cannot drop a value from an enum, so the type is rebuilt without
-- it. Rows already recorded as 'not_applicable' are re-labelled 'reviewed'
-- (the neutral decision: neither blocks auto-fill nor approves a value), so
-- the consultant's audit trail rows survive. After this the field is written
-- by auto-fill again — re-review any affected application.
--
-- Deploy the API WITHOUT the not-applicable endpoint before running this.

begin;

update public.consultant_approvals
   set decision = 'reviewed',
       reason = coalesce(reason, '') || ' [rolled back from not_applicable]'
 where decision::text = 'not_applicable';

alter type consultant_decision rename to consultant_decision_old;
create type consultant_decision as enum ('reviewed', 'approved', 'rejected', 'revoked');

alter table public.consultant_approvals
  alter column decision type consultant_decision
  using decision::text::consultant_decision;

drop type consultant_decision_old;

commit;
