-- ROLLBACK for 20260903120000_visa_knowledge_rag.sql
--
-- Not a Supabase "down migration" — this project has no down-migration runner.
-- It is an operator script, applied by hand, and it is written to be run in the
-- middle of an incident by someone who did not write the forward migration.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -1 \
--     -f supabase/migrations/rollback/20260903120000_visa_knowledge_rag.down.sql
--
-- WHAT IT DESTROYS, stated plainly because -1 will not save you from an
-- intentional DROP: the entire retrieval corpus — every extraction, section,
-- chunk, embedding and retrieval log. Re-creating it means re-running
-- `knowledge-ingest.ts` over every source version, which re-fetches nothing
-- (versions are untouched) but does re-pay for every embedding.
--
-- WHAT IT PRESERVES: the whole official-source registry. `visa_countries`,
-- `visa_types`, `visa_sources`, `visa_source_versions`, `visa_source_checks`,
-- `visa_source_changes` and `visa_requirements` are NOT touched. The knowledge
-- layer is additive over them, so rolling it back returns the database to a
-- working pre-RAG state rather than to an empty one.
--
-- BEFORE YOU RUN THIS, consider whether you need to. The knowledge layer is
-- reachable only through `/knowledge/*` and `/admin/knowledge/*`. Disabling
-- those routes stops all of it without losing the corpus, and is reversible in
-- seconds. Roll the schema back only when the SCHEMA is the problem.

begin;

-- ---------------------------------------------------------------------------
-- 1. Function and view first — they depend on the tables.
-- ---------------------------------------------------------------------------
drop function if exists public.kb_search_hybrid(
  text, extensions.vector, text, uuid, uuid, text[], text[], boolean, date, integer, integer, integer
);
drop view if exists public.kb_storage_stats;

-- ---------------------------------------------------------------------------
-- 2. The additive column on the registry table.
-- ---------------------------------------------------------------------------
-- Dropped BEFORE kb_blobs, because it holds the foreign key into it. Leaving
-- it would block the drop; dropping the constraint but keeping the column
-- would leave a dangling reference to a table that no longer exists.
alter table if exists public.visa_source_versions
  drop column if exists blob_sha256;

-- ---------------------------------------------------------------------------
-- 3. Tables, in dependency order.
-- ---------------------------------------------------------------------------
-- `cascade` on each, because the indexes, policies and triggers created by the
-- forward migration go with them and enumerating those here would be a second
-- list to keep in sync with the first.
drop table if exists public.kb_answer_citations cascade;
drop table if exists public.kb_retrieval_logs   cascade;
drop table if exists public.kb_review_queue     cascade;
drop table if exists public.kb_quarantine       cascade;
drop table if exists public.kb_freshness_policies cascade;
drop table if exists public.kb_ingestion_jobs   cascade;
drop table if exists public.kb_embeddings       cascade;
drop table if exists public.kb_chunk_scopes     cascade;
drop table if exists public.kb_chunks           cascade;
drop table if exists public.kb_chunk_texts      cascade;
drop table if exists public.kb_sections         cascade;
drop table if exists public.kb_extractions      cascade;
drop table if exists public.kb_blobs            cascade;

-- ---------------------------------------------------------------------------
-- 4. What is deliberately NOT dropped.
-- ---------------------------------------------------------------------------
-- The `visa-knowledge` storage bucket and its objects. Dropping the bucket
-- destroys cached copies of official documents that may be the only record of
-- what an authority published on a given date — and the registry's version
-- hashes still reference them. Remove it by hand, after deciding that, with:
--
--   delete from storage.objects where bucket_id = 'visa-knowledge';
--   delete from storage.buckets where id = 'visa-knowledge';
--
-- The `vector` and `pg_trgm` extensions. Both are shared infrastructure; a
-- future feature or another schema may already depend on them, and dropping an
-- extension another object uses fails the whole transaction. Remove with
-- `drop extension vector;` only after confirming nothing else uses it.

-- ---------------------------------------------------------------------------
-- 5. Post-conditions
-- ---------------------------------------------------------------------------
do $$
declare
  remaining text[];
begin
  select array_agg(table_name::text)
    into remaining
  from information_schema.tables
  where table_schema = 'public' and table_name like 'kb\_%';

  if remaining is not null then
    raise exception 'rollback incomplete, still present: %', remaining;
  end if;

  -- The registry must be untouched. If this fires, something dropped more than
  -- it should have and the transaction must not commit.
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'visa_source_versions'
  ) then
    raise exception 'rollback damaged the source registry — refusing to commit';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'visa_source_versions'
      and column_name = 'blob_sha256'
  ) then
    raise exception 'visa_source_versions.blob_sha256 was not removed';
  end if;

  raise notice 'knowledge layer rolled back; source registry intact';
end $$;

commit;
