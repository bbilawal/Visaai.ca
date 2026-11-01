-- Record which visa an application is actually for.
--
-- THE GAP
--
-- `applications` has `destination_country` and `framework_id`, and nothing
-- else about the route. `framework_id` references the legacy
-- `country_frameworks` table and is never populated by any code path — which is
-- already recorded as D-01, the reason the deterministic checklist engine has
-- never run in production.
--
-- Investigating that turned up the deeper cause: **the product has no record of
-- which visa type the applicant chose.** Not an unset column — no column. The
-- VRI suggests visa types and the intake conversation discusses them, but the
-- selection is never persisted anywhere. So there is no key to look a
-- requirement set up by.
--
-- That is what stops the sourced registry from reaching an applicant's
-- checklist. 166 verified requirements sit in visa_requirements, keyed by visa
-- type, and the application cannot say which one it wants.
--
-- WHY A NEW COLUMN RATHER THAN REUSING framework_id
--
-- framework_id points at country_frameworks, a one-row table whose `visa_type`
-- is a free-text public code ('TRV'). visa_types.id is a real key into the
-- registry, with provenance behind it. Overloading the old column would mean
-- one field pointing at two incompatible tables depending on era.
--
-- Both are kept. country_frameworks still holds the only data for visa types
-- the registry has not reached, and load-framework.ts falls back to it — a thin
-- checklist beats no checklist.
--
-- NULLABLE ON PURPOSE
--
-- Null means "the applicant has not chosen a route yet", which is a real and
-- common state: it is exactly what discovery mode is for. The loader returns no
-- requirements when it is null rather than guessing, because merging every visa
-- type's requirements into one checklist would show someone documents for a
-- route they are not taking.

alter table public.applications
  add column if not exists visa_type_id uuid
    references public.visa_types on delete set null;

comment on column public.applications.visa_type_id is
  'The visa route this application is for, into the sourced registry. NULL '
  'until the applicant chooses one — discovery mode. ON DELETE SET NULL rather '
  'than CASCADE: retiring a visa type must never delete a person''s '
  'application.';

-- The loader reads by application; the admin and coverage views read the other
-- way. Partial because most in-flight applications are still in discovery.
create index if not exists applications_visa_type_idx
  on public.applications (visa_type_id)
  where visa_type_id is not null;
