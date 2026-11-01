#!/usr/bin/env bash
# Give the Supabase service roles a password, AFTER the image has created them.
#
# STAGE 2 of the service-role bootstrap.
#
# Connects as supabase_admin, NOT postgres. The image's `demote-postgres`
# migration strips `postgres` of superuser, and authenticator /
# supabase_auth_admin / supabase_storage_admin are RESERVED roles that only a
# superuser may alter — as `postgres` this fails with:
#
#   ERROR: "authenticator" is a reserved role, only superusers can modify it
#
# supabase_admin's own password is set in stage 1
# (db-init/99-supabase-admin-password.sh), which runs during initdb where it is
# still permitted.
#
# WHY A SIDECAR AND NOT /docker-entrypoint-initdb.d.
# `supabase/postgres` creates authenticator, supabase_auth_admin,
# supabase_storage_admin and the rest during its own post-init migration phase,
# which runs AFTER the entrypoint's initdb.d hook. An initdb.d script therefore
# finds those roles absent and silently sets nothing — measured: only
# `supabase_admin` existed at that point, the other six did not.
#
# Worse, bind-mounting a DIRECTORY at /docker-entrypoint-initdb.d replaces the
# image's own scripts, and the cluster comes up with no roles at all, not even
# `postgres`.
#
# So this runs as a one-shot service once the db is healthy, and the services
# that need to log in wait for it via `service_completed_successfully`.
#
# THE UNDERLYING PROBLEM. `POSTGRES_PASSWORD` sets only the `postgres`
# superuser. Every other role is created passwordless, so GoTrue, PostgREST and
# Storage restart-loop on:
#
#   FATAL: password authentication failed for user "supabase_auth_admin"
#
# while `docker compose ps` reports the db healthy. The db IS healthy; nothing
# can log into it.
set -euo pipefail

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"
HOST="${POSTGRES_HOST:-db}"
DB="${POSTGRES_DB:-postgres}"
export PGPASSWORD="$POSTGRES_PASSWORD"

ROLES=(
  authenticator
  supabase_auth_admin
  supabase_storage_admin
  supabase_admin
  supabase_functions_admin
  supabase_read_only_user
  supabase_replication_admin
  supabase_etl_admin
  supabase_privileged_role
  pgbouncer
)

# The roles appear during the image's migration phase, which finishes slightly
# after the healthcheck passes. Wait for the last one to exist rather than
# racing it.
for _ in $(seq 1 60); do
  if psql -h "$HOST" -U supabase_admin -d "$DB" -tAc \
      "SELECT 1 FROM pg_roles WHERE rolname='supabase_storage_admin'" | grep -q 1; then
    break
  fi
  sleep 2
done

set_count=0
for role in "${ROLES[@]}"; do
  exists=$(psql -h "$HOST" -U supabase_admin -d "$DB" -tAc \
    "SELECT 1 FROM pg_roles WHERE rolname = '${role}'" || true)
  [ "$exists" = "1" ] || { echo "  role ${role} absent, skipped"; continue; }

  # format(%L) lets Postgres quote and escape the password. Building the
  # statement by string concatenation would break on a quote character and
  # would be injectable.
  psql -h "$HOST" -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 -tA \
       -v pw="$POSTGRES_PASSWORD" -v role="$role" <<'SQL' |
SELECT format('ALTER ROLE %I WITH LOGIN PASSWORD %L', :'role', :'pw');
SQL
    psql -h "$HOST" -U supabase_admin -d "$DB" -v ON_ERROR_STOP=1 >/dev/null
  echo "  password set for role ${role}"
  set_count=$((set_count + 1))
done

# Fail loudly. A bootstrap that "succeeds" having set nothing just moves the
# failure to auth's restart loop, where it is far harder to read.
if [ "$set_count" -lt 3 ]; then
  echo "FATAL: only ${set_count} role password(s) set; expected at least 3" >&2
  exit 1
fi
echo "service-role passwords set (${set_count} roles)"
