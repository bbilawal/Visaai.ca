-- Add destination country/state to applications so users can start an
-- application without pre-committing to a specific visa framework. The
-- intake agent now operates in "discovery mode" until enough is known
-- about the applicant to recommend (and later attach) a framework.

alter table public.applications
  add column if not exists destination_country text,
  add column if not exists destination_state text;

create index if not exists applications_destination_country_idx
  on public.applications (destination_country);
