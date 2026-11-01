#!/bin/sh
# Tests for backup-health.sh — the `backup` sidecar's healthcheck.
# Run: sh infra/self-hosted/backup-health.test.sh
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
CHECK="$HERE/backup-health.sh"
fails=0

# touch -t takes [[CC]YY]MMDDhhmm on both BSD and GNU.
stamp_ago() { # $1 = seconds ago
  now=$(date +%s)
  t=$((now - $1))
  date -u -r "$t" +%Y%m%d%H%M 2>/dev/null || date -u -d "@$t" +%Y%m%d%H%M
}

expect() { # $1 = name, $2 = expected exit, $3 = dir
  BACKUP_DIR="$3" BACKUP_INTERVAL_SECONDS=86400 sh "$CHECK" >/dev/null 2>&1
  got=$?
  if [ "$got" -eq "$2" ]; then echo "ok   $1"; else echo "FAIL $1 (exit $got, want $2)"; fails=$((fails + 1)); fi
}

fresh() { d=$(mktemp -d); echo "$d"; }

d=$(fresh);                                                                   expect "empty backup dir is unhealthy" 1 "$d"
d=$(fresh); TZ=UTC touch -t "$(stamp_ago 3600)" "$d/visaai-x.dump";           expect "dump from 1h ago is healthy" 0 "$d"
d=$(fresh); TZ=UTC touch -t "$(stamp_ago 172000)" "$d/visaai-x.dump";         expect "dump just inside 2x interval is healthy" 0 "$d"
d=$(fresh); TZ=UTC touch -t "$(stamp_ago 259200)" "$d/visaai-x.dump";         expect "dump from 3 days ago is unhealthy" 1 "$d"
d=$(fresh); touch "$d/visaai-x.dump.partial";                                 expect "only an in-progress .partial is unhealthy" 1 "$d"
d=$(fresh); touch "$d/visaai-x.dump.suspect";                                 expect "only a .suspect (too-small) dump is unhealthy" 1 "$d"
d=$(fresh); touch "$d/other.dump";                                            expect "a dump not named visaai-* is unhealthy" 1 "$d"
expect "missing backup dir is unhealthy" 1 "/nonexistent-backup-dir-$$"

if [ "$fails" -ne 0 ]; then echo "$fails failed"; exit 1; fi
echo "all passed"
