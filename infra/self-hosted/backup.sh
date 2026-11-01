#!/bin/sh
# Scheduled logical backup for the self-hosted stack (BLK-1).
#
# WHY THIS EXISTS
# BLK-1 is that production has no backup of any kind — measured, not assumed:
# `pitr_enabled: false, backups: []`. The self-hosted stack was built to remove
# the free-plan limits, and its own runbook says so bluntly: "You now own
# backups. Nothing in this stack backs anything up… or you have recreated BLK-1
# with extra steps." This is the part that stops that being true.
#
# WHY pg_dump AND NOT A GITHUB WORKFLOW
# The obvious automation — a scheduled CI job that dumps the database — would
# move a file containing 13 real users' passports and bank statements into a
# third-party artifact store. That trades a availability risk for a
# confidentiality one. Backups stay on infrastructure the operator controls.
#
# WHAT IT DOES NOT DO
# A dump on the same Docker host as the database is not disaster recovery: one
# lost machine loses both. It is the floor, not the ceiling. Ship
# ${BACKUP_DIR} off-host (restic/rclone to object storage, or a mounted volume
# on another machine) before this holds real data — see runbook §11.
set -eu

: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}"
DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-postgres}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
INITIAL_RETRY_SECONDS="${BACKUP_INITIAL_RETRY_SECONDS:-60}"
INITIAL_RETRIES="${BACKUP_INITIAL_RETRIES:-30}"

export PGPASSWORD="$POSTGRES_PASSWORD"
mkdir -p "$BACKUP_DIR"

log() { echo "[backup $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

run_backup() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  target="$BACKUP_DIR/visaai-$stamp.dump"

  # Custom format (-Fc): compressed, and restorable selectively with pg_restore.
  # --no-owner/--no-privileges so a restore does not depend on identical role
  # names existing first, which is the usual reason a restore fails at 3am.
  if pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" \
      -Fc --no-owner --no-privileges -f "$target.partial"; then
    # Rename only on success: a partial file must never look like a backup.
    mv "$target.partial" "$target"
    size=$(wc -c < "$target")
    # A dump that is suspiciously small is a failed dump that exited 0.
    if [ "$size" -lt 10000 ]; then
      log "ERROR dump is only ${size} bytes — treating as failed"
      mv "$target" "$target.suspect"
      return 1
    fi
    log "ok $target (${size} bytes)"
  else
    log "ERROR pg_dump failed"
    rm -f "$target.partial"
    return 1
  fi

  # Prune AFTER a successful dump, never before: pruning first can leave you
  # with nothing when the new dump then fails.
  find "$BACKUP_DIR" -name 'visaai-*.dump' -type f -mtime "+$RETENTION_DAYS" -delete
  count=$(find "$BACKUP_DIR" -name 'visaai-*.dump' -type f | wc -l)
  log "retained $count backup(s), pruning older than ${RETENTION_DAYS}d"
}

log "starting; interval=${INTERVAL_SECONDS}s retention=${RETENTION_DAYS}d dir=${BACKUP_DIR}"

# Back up immediately on start, so a fresh stack is never left unprotected
# waiting out the first interval.
#
# Retry that first backup on a short interval before falling back to the daily
# one. `depends_on: db: service_healthy` only orders `docker compose up`; after
# a host reboot Docker's restart policy starts every container at once, so this
# one can start before the database accepts connections. On the VPS both
# reboots on 2026-09-20 did exactly that ("Connection refused"), and with a
# single attempt the next backup came a full interval later.
attempt=1
until run_backup; do
  if [ "$attempt" -ge "$INITIAL_RETRIES" ]; then
    log "initial backup failed ${attempt} time(s) — will retry next interval"
    break
  fi
  log "initial backup attempt ${attempt} failed — retrying in ${INITIAL_RETRY_SECONDS}s"
  attempt=$((attempt + 1))
  sleep "$INITIAL_RETRY_SECONDS"
done

while true; do
  sleep "$INTERVAL_SECONDS"
  run_backup || log "backup failed — will retry next interval"
done
