-- Checklist items now distinguish who is responsible for each form/document:
-- the visa "applicant" or their "sponsor"/host. The value lives in meta->>'owner'
-- (alongside meta.kind and meta.specs), so no column change is needed — but an
-- index keeps the documents page's owner-grouped queries cheap.

create index if not exists checklist_items_meta_owner_idx
  on public.checklist_items ((meta->>'owner'));
