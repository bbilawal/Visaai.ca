#!/usr/bin/env bash
# =============================================================================
# Backup / restore drill — proves the RESTORE HALF of the runbook works.
# =============================================================================
#
# WHY THIS EXISTS
#   `docs/production/vps-hardening/supabase-snapshot.sh` documents how to take a
#   pg_dump and how to restore it. Nothing had ever executed the restore. A
#   restore procedure that has never been run is a hypothesis, and the moment
#   you need it is the worst possible moment to discover it does not work.
#
#   This runs the full cycle against a throwaway database seeded with the real
#   schema: dump -> destroy -> restore -> verify the inventory matches. It
#   deliberately DESTROYS the target, which is why the target must be a local
#   or disposable database and the script refuses anything that looks otherwise.
#
# WHAT THIS DOES *NOT* PROVE
#   That production has a backup. That is a separate, and currently unmet,
#   condition — see VISAAIDocs/security/security-audit-report.md. This proves the
#   mechanism; it cannot conjure an artefact that was never produced.
#
# USAGE
#   infra/scripts/backup-restore-drill.sh                 # local supabase stack
#   DB_URL=postgresql://... infra/scripts/backup-restore-drill.sh
# =============================================================================
set -Eeuo pipefail

DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
WORKDIR="$(mktemp -d)"
DUMP="$WORKDIR/drill.dump"
trap 'rm -rf "$WORKDIR"' EXIT

# Refuse to point the destructive half at anything that is not obviously local.
case "$DB_URL" in
  *127.0.0.1*|*localhost*) ;;
  *)
    echo "REFUSING: this drill DROPS the target schema."
    echo "  DB_URL must be a local/disposable database, got: ${DB_URL%%@*}@..."
    echo "  Set ALLOW_REMOTE_DRILL=1 only for a database you intend to destroy."
    [ "${ALLOW_REMOTE_DRILL:-0}" = "1" ] || exit 2
    ;;
esac

psql_q() { psql "$DB_URL" -tAc "$1"; }

# Tables / policies / our functions / RLS-enabled tables / EXCLUDE+CHECK+FK
# constraints. Constraints are counted explicitly because they are what a lossy
# restore drops first and quietly: an EXCLUDE constraint that fails to come back
# leaves a database that looks complete and accepts data it must reject.
inventory() {
  psql_q "select
     (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE') || '/' ||
     (select count(*) from pg_policies where schemaname='public') || '/' ||
     (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        left join pg_depend d on d.objid=p.oid and d.deptype='e'
        where n.nspname='public' and d.objid is null) || '/' ||
     (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r' and c.relrowsecurity) || '/' ||
     (select count(*) from pg_constraint c join pg_namespace n on n.oid=c.connamespace
        where n.nspname='public' and c.contype in ('x','c','f'))"
}

echo "== backup/restore drill =="
echo "target: ${DB_URL%%:*}://…@${DB_URL##*@}"

command -v pg_dump >/dev/null || { echo "pg_dump not on PATH"; exit 1; }
command -v psql    >/dev/null || { echo "psql not on PATH"; exit 1; }

BEFORE="$(inventory)"
echo "before   tables/policies/functions/rls/constraints = $BEFORE"

echo "-- 1. dump (custom format, whole database)"
# NOT --schema=public. pg_dump emits no CREATE EXTENSION for a schema-scoped
# dump, so a public-only snapshot restores without the extensions the schema
# depends on — and silently drops every constraint built on their operator
# classes. This mirrors the flags in
# docs/production/vps-hardening/supabase-snapshot.sh, which is the procedure
# this drill exists to validate; a drill that tests different flags to the
# runbook tests nothing.
START=$(date +%s)
pg_dump "$DB_URL" --format=custom --no-owner --no-acl --file="$DUMP"
DUMP_SECS=$(( $(date +%s) - START ))
echo "   wrote $(du -h "$DUMP" | cut -f1) in ${DUMP_SECS}s"

echo "-- 2. destroy (this is the part that makes it a real drill)"
psql "$DB_URL" -q -c 'drop schema public cascade' -c 'create schema public'
AFTER_DROP="$(inventory)"
echo "   after drop = $AFTER_DROP"
[ "${AFTER_DROP%%/*}" = "0" ] || { echo "FAIL: drop did not empty the schema"; exit 1; }

echo "-- 3. restore"
START=$(date +%s)
# --exit-on-error is deliberately NOT set: a dump taken without the Supabase
# platform roles present will emit ownership/grant notices that are not
# failures. Object counts are the acceptance test, not pg_restore's exit code.
pg_restore --dbname="$DB_URL" --no-owner --no-privileges "$DUMP" >/dev/null 2>"$WORKDIR/restore.err" || true
RESTORE_SECS=$(( $(date +%s) - START ))
echo "   restored in ${RESTORE_SECS}s"

AFTER="$(inventory)"
echo "after    tables/policies/functions/rls/constraints = $AFTER"

if [ "$AFTER" = "$BEFORE" ]; then
  echo
  echo "RESTORE DRILL: PASS"
  echo "  inventory identical after destroy+restore"
  echo "  dump ${DUMP_SECS}s / restore ${RESTORE_SECS}s (recovery time for this dataset)"
  exit 0
fi

echo
echo "RESTORE DRILL: FAIL"
echo "  expected $BEFORE"
echo "  got      $AFTER"
echo "  restore stderr (first 20 lines):"
head -20 "$WORKDIR/restore.err" | sed 's/^/    /'
exit 1
