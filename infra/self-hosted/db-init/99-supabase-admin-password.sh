#!/usr/bin/env bash
# STAGE 1 of the service-role bootstrap: give `supabase_admin` a password.
#
# Runs from /docker-entrypoint-initdb.d (mount the FILE, never the directory —
# a directory mount replaces the image's own scripts and the cluster comes up
# with no roles at all, not even `postgres`).
#
# Only supabase_admin is set here, for two reasons:
#   * authenticator, supabase_auth_admin and supabase_storage_admin are RESERVED
#     roles. By the time this runs, the image's `demote-postgres` migration has
#     already stripped `postgres` of superuser, so altering them fails with
#     "is a reserved role, only superusers can modify it".
#   * supabase_admin is NOT reserved, so `postgres` can still set it — and
#     supabase_admin IS a superuser, which is what stage 2 needs.
set -euo pipefail
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" \
     -v pw="$POSTGRES_PASSWORD" -tA <<'SQL' |
SELECT format('ALTER ROLE supabase_admin WITH LOGIN PASSWORD %L', :'pw');
SQL
  psql -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-postgres}" -d "${POSTGRES_DB:-postgres}" >/dev/null

echo "stage 1: supabase_admin password set"
