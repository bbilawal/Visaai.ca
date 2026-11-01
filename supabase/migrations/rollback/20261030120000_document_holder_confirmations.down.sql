-- Rollback of 20261030120000_document_holder_confirmations.sql.
-- Held passports go back to needing a consultant approval; the API code that
-- reads the table treats a missing table as "no confirmations" (fails closed).
drop table if exists public.document_holder_confirmations;
