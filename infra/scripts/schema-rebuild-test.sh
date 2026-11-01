#!/usr/bin/env bash
# Disaster-recovery rehearsal: rebuild the entire schema from
# supabase/migrations/ into a throwaway Postgres, and compare the result
# against production's object inventory.
#
# This tests SCHEMA recovery, not data recovery. It is the half of DR that is
# under our control given the production project currently has no restorable
# backup (see VISAAIDocs/infrastructure/backup-and-restore.md).
#
# Safe by construction: it never connects to production. Production's
# inventory is supplied as a file, fetched separately.
set -euo pipefail

PG_IMAGE="${PG_IMAGE:-postgres:17-alpine}"
CONTAINER="${CONTAINER:-visaai-dr-rehearsal}"
PGPASSWORD_VALUE="rehearsal"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-supabase/migrations}"
EXPECTED="${EXPECTED:-}"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "== DR rehearsal: rebuilding schema from $MIGRATIONS_DIR =="
cleanup
docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASSWORD_VALUE" \
  -e POSTGRES_DB=visaai "$PG_IMAGE" >/dev/null

# The postgres image starts a TEMPORARY server to run initdb, then shuts it down
# and starts the real one. `pg_isready` answers YES during that window, so a
# naive wait raced the restart and the script died on the next command with
# "socket ... No such file or directory". Require an actual query to succeed,
# twice in a row, so a single lucky poll during init cannot let us through.
printf 'waiting for postgres'
READY=0
for _ in $(seq 1 90); do
  if docker exec "$CONTAINER" psql -U postgres -d visaai -tAc 'select 1' >/dev/null 2>&1; then
    READY=$((READY + 1))
    if [ "$READY" -ge 2 ]; then echo " ready"; break; fi
  else
    READY=0
  fi
  printf '.'; sleep 1
done
if [ "$READY" -lt 2 ]; then
  echo " TIMED OUT"
  echo "postgres in $CONTAINER never accepted a query; last 20 lines of its log:"
  docker logs --tail 20 "$CONTAINER" 2>&1 | sed 's/^/  /'
  exit 1
fi

# Passes through any extra psql flags. Callers currently only pipe SQL on stdin,
# so shellcheck sees "$@" as unused — keep it, so a caller that needs a flag can
# add one without editing the helper.
# shellcheck disable=SC2120
run_sql() { docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d visaai -q "$@"; }

# Supabase provides these; a bare Postgres does not. Shimming them is the
# point of the exercise — it documents exactly what the platform gives us,
# which is what a rebuild elsewhere would have to replace.
# shellcheck disable=SC2119
run_sql <<'BOOTSTRAP'
create extension if not exists "uuid-ossp";
create extension if not exists pgcrypto;
create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, name text, statements text[]
);
-- Supabase's auth.users and the auth.uid()/auth.role() helpers RLS depends on.
create table if not exists auth.users (
  id uuid primary key default uuid_generate_v4(),
  email text, raw_app_meta_data jsonb, raw_user_meta_data jsonb,
  is_anonymous boolean default false, created_at timestamptz default now()
);
create or replace function auth.uid() returns uuid language sql stable
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
create or replace function auth.jwt() returns jsonb language sql stable
  as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
-- Supabase Storage. A migration seeds a private bucket for uploaded documents,
-- so a rebuild without these tables stops there — which is precisely the kind
-- of platform dependency this rehearsal exists to surface.
create table if not exists storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now()
);
-- storage.foldername() splits an object path; RLS policies use it to scope a
-- file to its owning user's folder. Reimplemented here to match Supabase's
-- semantics, because a rebuild elsewhere would need the same.
create or replace function storage.foldername(name text) returns text[]
  language sql immutable as $$
    select string_to_array(regexp_replace(name, '/[^/]*$', ''), '/')
  $$;
create table if not exists storage.objects (
  id uuid primary key default uuid_generate_v4(),
  bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now()
);
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role;
  end if;
end $$;
BOOTSTRAP
echo "  bootstrap applied (Supabase-provided objects shimmed)"

APPLIED=0
FAILED=0
FAILED_LIST=""
for file in "$MIGRATIONS_DIR"/*.sql; do
  if docker exec -i "$CONTAINER" psql -v ON_ERROR_STOP=1 -U postgres -d visaai -q < "$file" >/tmp/dr-out.txt 2>&1; then
    APPLIED=$((APPLIED + 1))
  else
    FAILED=$((FAILED + 1))
    ERR="$(grep -m1 '^ERROR:' /tmp/dr-out.txt || tail -2 /tmp/dr-out.txt | tr '\n' ' ')"
    FAILED_LIST="$FAILED_LIST\n  $(basename "$file"): $ERR"
  fi
done

echo "== applied: $APPLIED   failed: $FAILED =="
[ "$FAILED" -eq 0 ] || printf 'failures:%b\n' "$FAILED_LIST"

TABLES=$(docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
  "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")
POLICIES=$(docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
  "select count(*) from pg_policies where schemaname='public'")
RLS=$(docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")
FUNCS=$(docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'")

echo "rebuilt: tables=$TABLES rls_enabled=$RLS policies=$POLICIES functions=$FUNCS"

# == Security invariants (Task 14) ==========================================
# Asserted against the schema as REBUILT FROM MIGRATIONS, which is the only
# place they can be checked honestly: a fix applied by hand to a live database
# is not a fix, it is a state that the next rebuild discards.
LINT_FAILED=0

NO_RLS=$(docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
  "select coalesce(string_agg(c.relname, ', '), '') from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false")
if [ -n "$NO_RLS" ]; then
  echo "SECURITY: tables without row-level security: $NO_RLS"
  echo "  (partitions do not inherit the parent's row-security setting)"
  LINT_FAILED=1
else
  echo "security: every public table has RLS enabled"
fi

DEFINER_VIEWS=$(docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
  "select coalesce(string_agg(c.relname, ', '), '') from pg_class c
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
      and not coalesce((select option_value::boolean
                          from pg_options_to_table(c.reloptions)
                         where option_name = 'security_invoker'), false)")
if [ -n "$DEFINER_VIEWS" ]; then
  echo "SECURITY: views without security_invoker (they bypass the caller's RLS): $DEFINER_VIEWS"
  LINT_FAILED=1
else
  echo "security: every public view sets security_invoker"
fi

MUTABLE_PATH=$(docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
  "select coalesce(string_agg(p.proname, ', '), '') from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and (p.proconfig is null
           or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))")
if [ -n "$MUTABLE_PATH" ]; then
  echo "SECURITY: SECURITY DEFINER functions with a mutable search_path: $MUTABLE_PATH"
  LINT_FAILED=1
else
  echo "security: every SECURITY DEFINER function pins search_path"
fi

if [ -n "$EXPECTED" ] && [ -f "$EXPECTED" ]; then
  echo "== comparing against production inventory ($EXPECTED) =="
  docker exec "$CONTAINER" psql -U postgres -d visaai -tAc \
    "select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE' order by 1" \
    | sed '/^$/d' > /tmp/dr-rebuilt-tables.txt
  MISSING=$(comm -23 <(sort "$EXPECTED") <(sort /tmp/dr-rebuilt-tables.txt) || true)
  EXTRA=$(comm -13 <(sort "$EXPECTED") <(sort /tmp/dr-rebuilt-tables.txt) || true)
  # Word splitting is intentional: these hold newline-separated table names and
  # each should print on its own line.
  # shellcheck disable=SC2086
  if [ -n "$MISSING" ]; then echo "MISSING from rebuild:"; printf '  %s\n' $MISSING; fi
  # shellcheck disable=SC2086
  if [ -n "$EXTRA" ];   then echo "EXTRA in rebuild:";    printf '  %s\n' $EXTRA; fi
  [ -z "$MISSING" ] && [ -z "$EXTRA" ] && echo "  table inventory MATCHES production"
fi

[ "$FAILED" -eq 0 ] || exit 1
[ "$LINT_FAILED" -eq 0 ] || { echo "DR rehearsal: FAIL (security invariants)"; exit 1; }
echo "DR rehearsal: PASS"
