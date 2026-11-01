#!/bin/sh
# Off-host, ENCRYPTED backup shipping for the self-hosted stack (SEC-7009).
#
# WHY THIS EXISTS
# backup.sh writes dumps to a directory on the SAME Docker host as the database.
# Its own comment says that is the floor, not the ceiling: one lost machine
# loses both the primary and its backups. This ships those dumps off-host.
#
# WHY restic
# The blocker on off-host backup was always confidentiality: the dumps contain
# real passports and bank statements, so they must never land in third-party
# object storage as plaintext. restic encrypts (and dedups + compresses) LOCALLY
# with RESTIC_PASSWORD before anything leaves the host, so the remote store only
# ever holds ciphertext. That is what makes shipping to S3/B2/Wasabi acceptable.
#
# WHAT THE OPERATOR PROVIDES (env, e.g. in infra/self-hosted/.env)
#   RESTIC_REPOSITORY   e.g. s3:s3.amazonaws.com/visaai-backups
#                        or  b2:visaai-backups   or  rclone:remote:visaai
#   RESTIC_PASSWORD      strong passphrase — STORE IT SEPARATELY. Lose it and the
#                        backups are unrecoverable (that is the point).
#   plus backend creds, e.g. AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, or
#   B2_ACCOUNT_ID / B2_ACCOUNT_KEY, per the backend chosen.
#
# Prereq: restic installed on the host (`apt-get install -y restic` or the static
# binary). First run must initialise the repo once: `restic init`.
set -eu

: "${RESTIC_REPOSITORY:?set RESTIC_REPOSITORY (off-host destination)}"
: "${RESTIC_PASSWORD:?set RESTIC_PASSWORD (encryption passphrase)}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_SECONDS="${OFFSITE_INTERVAL_SECONDS:-86400}"
# Retention on the REMOTE (independent of the local prune in backup.sh).
KEEP_DAILY="${OFFSITE_KEEP_DAILY:-7}"
KEEP_WEEKLY="${OFFSITE_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${OFFSITE_KEEP_MONTHLY:-6}"
HOST_TAG="${OFFSITE_HOST_TAG:-visaai-selfhosted}"

log() { echo "[offsite $(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

ensure_repo() {
  if ! restic snapshots >/dev/null 2>&1; then
    log "repo not initialised — running restic init"
    restic init
  fi
}

run_offsite() {
  # Back up the directory of local dumps. --host keeps snapshots identifiable;
  # restic is incremental so re-uploading the same dumps is cheap.
  if restic backup "$BACKUP_DIR" \
        --host "$HOST_TAG" --tag visaai --tag db-dump; then
    log "ok pushed $BACKUP_DIR"
  else
    log "ERROR restic backup failed"
    return 1
  fi

  # Enforce remote retention, then prune the freed data.
  if restic forget --host "$HOST_TAG" \
        --keep-daily "$KEEP_DAILY" --keep-weekly "$KEEP_WEEKLY" \
        --keep-monthly "$KEEP_MONTHLY" --prune; then
    log "retention applied (d=$KEEP_DAILY w=$KEEP_WEEKLY m=$KEEP_MONTHLY)"
  else
    log "WARN restic forget/prune failed — snapshots kept, will retry"
  fi

  # Integrity: a backup you cannot restore is not a backup. Cheap metadata check
  # every run; the operator should run a periodic `restic check --read-data`.
  restic check >/dev/null 2>&1 && log "restic check ok" || log "WARN restic check reported issues"
}

log "starting; interval=${INTERVAL_SECONDS}s repo=${RESTIC_REPOSITORY} src=${BACKUP_DIR}"
ensure_repo
run_offsite || log "initial offsite push failed — will retry next interval"

while true; do
  sleep "$INTERVAL_SECONDS"
  run_offsite || log "offsite push failed — will retry next interval"
done
