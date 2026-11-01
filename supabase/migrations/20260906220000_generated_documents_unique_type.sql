-- DOC-002: generated_documents is read as one row per application/type, but
-- the schema allowed concurrent generators to insert duplicates. Preserve the
-- most user-significant row before making that invariant database-enforced.

delete from public.generated_documents d
using (
  select id,
         row_number() over (
           partition by application_id, doc_type
           order by approved_by_user desc, generated_at desc, id desc
         ) as keep_rank
  from public.generated_documents
) ranked
where d.id = ranked.id and ranked.keep_rank > 1;

alter table public.generated_documents
  add constraint generated_documents_application_doc_type_key
  unique (application_id, doc_type);
