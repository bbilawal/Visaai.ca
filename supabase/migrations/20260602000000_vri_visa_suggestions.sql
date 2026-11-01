-- VRI visa category suggestions
-- After VRI calculation, the AI suggests alternative visa categories for the
-- destination country that have higher approval odds for the applicant, along
-- with the official required documents sourced from the country's official
-- visa portal (encoded in the LLM's knowledge base).

create table public.vri_visa_suggestions (
  id uuid primary key default uuid_generate_v4(),
  vri_score_id uuid not null references public.vri_scores on delete cascade,
  country_code text not null,
  visa_category text not null,
  approval_likelihood int not null check (approval_likelihood between 0 and 100),
  reasoning text not null,
  required_documents jsonb not null default '[]',
  official_source text,
  rank int not null default 0
);

alter table public.vri_visa_suggestions enable row level security;
create policy "vri_visa_suggestions_own_rows" on public.vri_visa_suggestions
  for all using (
    auth.uid() = (
      select a.user_id from public.vri_scores v
      join public.applications a on a.id = v.application_id
      where v.id = vri_score_id
    )
  );

create index if not exists vri_visa_suggestions_score_idx
  on public.vri_visa_suggestions (vri_score_id, rank);
