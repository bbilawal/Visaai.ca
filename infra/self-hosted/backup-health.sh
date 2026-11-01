#!/bin/sh
# Healthcheck for the `backup` sidecar: healthy iff a completed dump
# (visaai-*.dump — never .partial or .suspect) is younger than two intervals.
#
# WHY
# The sidecar runs the postgres image, so without its own healthcheck it
# inherits the image's `pg_isready` against localhost:5432 — where nothing
# listens. On the VPS that reported `unhealthy` (failing streak 293,590) while
# dumps were landing daily, so the one signal that should say "backups
# stopped" said it permanently and meant nothing. Two intervals tolerates one
# missed run (e.g. the db restarting mid-dump) before going red.
set -u

BACKUP_DIR="${BACKUP_DIR:-/backups}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-86400}"
max_minutes=$(( (INTERVAL_SECONDS * 2) / 60 ))

[ -d "$BACKUP_DIR" ] || { echo "no backup dir $BACKUP_DIR"; exit 1; }

latest=$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'visaai-*.dump' -mmin "-$max_minutes" | head -n 1)
if [ -z "$latest" ]; then
  echo "no completed dump newer than ${max_minutes}m in $BACKUP_DIR"
  exit 1
fi
echo "ok $latest"
