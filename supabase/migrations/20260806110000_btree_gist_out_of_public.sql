-- Task 14 security audit — move btree_gist out of the public schema.
--
-- `20260805030000_consultations_booking.sql` runs:
--
--     create extension if not exists btree_gist;
--
-- with no `with schema` clause, so it lands in the first writable schema on the
-- search_path — `public`. Every other extension in this database
-- (uuid-ossp, pgcrypto, pg_net, pg_stat_statements) lives in `extensions`.
-- btree_gist is the only one that does not, and only because the clause was
-- omitted.
--
-- Two things follow from that, neither of them intended:
--
--   1. It puts ~188 extension functions into `public`, the schema PostgREST
--      exposes. This is the condition Supabase's own `extension_in_public`
--      advisor flags. The functions are not individually dangerous, but
--      "extensions are not in the API-exposed schema" is a property worth
--      having unconditionally rather than case by case.
--
--   2. It makes a schema-scoped dump silently lossy. `pg_dump --schema=public`
--      emits no CREATE EXTENSION at all, so a selective restore — which
--      `docs/production/vps-hardening/supabase-snapshot.sh` explicitly offers
--      as an option ("restore selectively with pg_restore") — comes back
--      WITHOUT btree_gist, and therefore without the EXCLUDE constraint that
--      depends on its operator class. That constraint is
--      `consultations_no_overlap`: the only thing preventing a consultant from
--      being double-booked. It would be missing, and nothing would say so.
--
--      Verified, not theorised: a dump/destroy/restore cycle through the
--      public-schema-only path was run during the audit and the constraint was
--      absent afterwards.
--
-- `alter extension ... set schema` relocates the extension's objects and
-- rewrites the dependency, so the EXCLUDE constraint keeps working — the
-- operator class is still resolvable because `extensions` is on the search_path.
-- Verified locally against the full schema before this migration was written.

do $$
begin
  if exists (
    select 1
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
    where e.extname = 'btree_gist' and n.nspname = 'public'
  ) then
    execute 'alter extension btree_gist set schema extensions';
  end if;
end;
$$;
