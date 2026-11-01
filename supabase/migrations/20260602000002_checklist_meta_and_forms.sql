-- Distinguish "required forms" (e.g. DS-160, IMM 5257) from supporting
-- documents on VRI visa suggestions, and let the application checklist carry
-- form-specific metadata (form code, download URL) so the documents page can
-- group forms separately and link the user straight to the official source.

alter table public.vri_visa_suggestions
  add column if not exists required_forms jsonb not null default '[]';

alter table public.checklist_items
  add column if not exists meta jsonb not null default '{}';

create index if not exists checklist_items_meta_kind_idx
  on public.checklist_items ((meta->>'kind'));
