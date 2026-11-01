#!/bin/sh
# Tests for backup.sh's start-up behaviour — the initial backup and its retry.
# Run: sh infra/self-hosted/backup.test.sh
#
# pg_dump and sleep are stubbed on PATH, so no database is needed. The pg_dump
# stub fails $FAIL_TIMES times and then writes a dump big enough to pass the
# size floor. The sleep stub records each duration and, when backup.sh reaches
# the daily interval, stops it: the start-up phase is what is under test.
set -u

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/backup.sh"
fails=0
hangs=0

make_stubs() { # $1 = dir
  mkdir -p "$1/bin"
  cat > "$1/bin/pg_dump" <<'EOF'
#!/bin/sh
n=$(cat "$STUB_DIR/calls" 2>/dev/null || echo 0)
n=$((n + 1))
echo "$n" > "$STUB_DIR/calls"
if [ "$n" -le "$FAIL_TIMES" ]; then
  echo 'pg_dump: error: connection to server at "db", port 5432 failed: Connection refused' >&2
  exit 1
fi
while [ "$#" -gt 0 ]; do
  if [ "$1" = "-f" ]; then head -c 20000 /dev/zero > "$2"; exit 0; fi
  shift
done
exit 1
EOF
  cat > "$1/bin/sleep" <<'EOF'
#!/bin/sh
echo "$1" >> "$STUB_DIR/sleeps"
if [ "$1" = "$BACKUP_INTERVAL_SECONDS" ]; then kill -TERM "$PPID"; fi
exit 0
EOF
  chmod +x "$1/bin/pg_dump" "$1/bin/sleep"
}

run() { # $1 = dir, $2 = FAIL_TIMES, $3 = BACKUP_INITIAL_RETRIES
  make_stubs "$1"
  # The subshell keeps the shell from reporting the stubbed-out kill as a job.
  (STUB_DIR="$1" FAIL_TIMES="$2" BACKUP_INITIAL_RETRIES="$3" \
    BACKUP_INITIAL_RETRY_SECONDS=60 BACKUP_INTERVAL_SECONDS=86400 \
    BACKUP_DIR="$1/backups" POSTGRES_PASSWORD=test PATH="$1/bin:$PATH" \
    sh "$SCRIPT" > "$1/log" 2>&1; true) 2>/dev/null &
  pid=$!
  # Watchdog: the sleep stub ends the script at the daily interval; anything
  # still running after 20s is a hang.
  i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do command sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid"; hangs=$((hangs + 1)); fi
  wait "$pid" 2>/dev/null
}

pass() { echo "ok   $1"; }
fail() { echo "FAIL $1"; fails=$((fails + 1)); }

dumps() { find "$1/backups" -name 'visaai-*.dump' -type f 2>/dev/null | wc -l | tr -d ' '; }
sleeps() { tr '\n' ' ' < "$1/sleeps" 2>/dev/null | sed 's/ $//'; }

d=$(mktemp -d); run "$d" 0 30
name="first attempt succeeds: one dump, no retry"
if [ "$(dumps "$d")" = 1 ] && [ "$(sleeps "$d")" = "86400" ]; then pass "$name"; else fail "$name"; fi

d=$(mktemp -d); run "$d" 2 30
name="db not ready twice: retries after 60s and then dumps"
if [ "$(dumps "$d")" = 1 ] && [ "$(sleeps "$d")" = "60 60 86400" ]; then pass "$name"; else fail "$name"; fi
name="each failed initial attempt is logged"
if grep -q "initial backup attempt 2 failed — retrying in 60s" "$d/log"; then pass "$name"; else fail "$name"; fi

d=$(mktemp -d); run "$d" 99 3
name="gives up after BACKUP_INITIAL_RETRIES and falls back to the interval"
if [ "$(dumps "$d")" = 0 ] && [ "$(sleeps "$d")" = "60 60 86400" ]; then pass "$name"; else fail "$name"; fi
name="the give-up is logged"
if grep -q "initial backup failed 3 time(s) — will retry next interval" "$d/log"; then pass "$name"; else fail "$name"; fi

name="no run hung (each reached the daily interval)"
if [ "$hangs" -eq 0 ]; then pass "$name"; else fail "$name"; fi

if [ "$fails" -ne 0 ]; then echo "$fails failed"; exit 1; fi
echo "all passed"
