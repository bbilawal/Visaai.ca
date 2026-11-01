-- Persist the inferred document type on the documents row so cross-verification
-- can reference it without joining through checklist_items.
alter table public.documents add column if not exists document_type text;
