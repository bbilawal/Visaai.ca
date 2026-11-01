#!/usr/bin/env bash
# Migrate a Supabase database into this self-hosted stack.
#
#   ./migrate.sh --source "postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres"
#   ./migrate.sh --source "$SRC" --dry-run     # dump + inspect, restore nothing
#
# PREFER THE ENVIRONMENT over --source. A connection string on the command line
# is visible to every user on the box via `ps`, and lands in shell history:
#
#   read -rs SOURCE_DB_URL && export SOURCE_DB_URL   # paste, no echo, no history
#   ./migrate.sh --dry-run
#
# WHAT THIS MOVES, AND WHAT IT DOES NOT.
#   moves:  roles, the public schema, the auth schema (auth.users — the password
#           hashes, so accounts survive), the storage schema (object METADATA).
#   does NOT move: the storage OBJECTS themselves (the actual files), which live
#           in S3 behind the hosted Storage API. See runbook §7.
#
# THREE DUMPS, NOT ONE. A single `pg_dump --data-only` omits the auth schema,
# and losing auth.users means every login dies. Roles must also be restored
# before the schema that grants to them, or the grants silently vanish.
#
# SAFETY
#   * The SOURCE is only ever read. There is no code path here that writes to it.
#   * Refuses to restore into a target that already holds application data,
#     unless --force. Restoring twice is how you get duplicate rows.
#   * Uses a SESSION connection, not the transaction pooler — pg_dump needs it.
#   * Verifies afterwards with parity-check.sh and FAILS on any mismatch.
set -euo pipefail
cd "$(dirname "$0")"

SOURCE=""
DRY_RUN=0
FORCE=0
OUT="./dumps/$(date -u +%Y%m%dT%H%M%SZ)"

while [ $# -gt 0 ]; do
  case "$1" in
    --source)  SOURCE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    --force)   FORCE=1; shift ;;
    --out)     OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# Environment first: keeps the password out of argv and out of history.
SOURCE="${SOURCE:-${SOURCE_DB_URL:-}}"
if [ -z "$SOURCE" ]; then
  echo "FATAL: no source. Either:" >&2
  echo "  read -rs SOURCE_DB_URL && export SOURCE_DB_URL   # preferred" >&2
  echo "  ./migrate.sh --source \"postgresql://...\"        # visible in ps" >&2
  exit 2
fi
[ -f .env ] || { echo "FATAL: .env missing — see runbook §2" >&2; exit 1; }
set -a; . ./.env; set +a

# Restore as supabase_admin, not postgres. The image demotes `postgres` from
# superuser, and it does not own the auth.* tables, so `--disable-triggers`
# (which pg_dump emits as ALTER TABLE ... DISABLE TRIGGER) fails with
#   ERROR: must be owner of table audit_log_entries
# 572 times on a real run. The COPYs still land, so the data looks fine and the
# triggers were never actually disabled — exactly the kind of half-success worth
# refusing.
TARGET="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT:-54422}/${POSTGRES_DB:-postgres}"

# pg_dump refuses to run against a server newer than itself, so both dump and
# restore go through the pinned image rather than whatever is on the host.
PG_IMAGE="public.ecr.aws/supabase/postgres:17.6.1.127"
pg() { docker run --rm --network host -v "$PWD/dumps:/dumps" "$PG_IMAGE" "$@"; }

mkdir -p "$OUT"
echo "== source version =="
pg psql "$SOURCE" -tAc "select version()" | sed 's/^/  /'

echo "== 1/3 roles =="
pg pg_dumpall -d "$SOURCE" --roles-only --no-role-passwords \
  > "$OUT/01-roles.sql"

# Extensions must exist BEFORE the schema, or any object depending on one is
# silently skipped. Found the hard way: `consultations_no_overlap` is a GiST
# index over tstzrange, and without btree_gist the restore emitted
#   ERROR: data type uuid has no default operator class for access method "gist"
# and carried on. The table arrived, the index did not, and only the parity
# check noticed.
#
# CREATE EXTENSION rather than dumping the `extensions` schema: the extension
# owns those objects and recreates them itself.
echo "== 2/4 extensions =="
pg psql "$SOURCE" -tAc \
  "select format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', extname, extnamespace::regnamespace)
     from pg_extension where extname not in ('plpgsql')" \
  > "$OUT/015-extensions.sql"
sed 's/^/  /' "$OUT/015-extensions.sql" | grep -c CREATE | xargs echo "  extensions to create:"

echo "== 3/4 schema (public + auth + storage) =="
pg pg_dump -d "$SOURCE" --schema-only --no-owner --no-privileges \
  --schema=public --schema=auth --schema=storage \
  > "$OUT/02-schema.sql"

echo "== 4/4 data =="
pg pg_dump -d "$SOURCE" --data-only --no-owner --no-privileges \
  --disable-triggers \
  --schema=public --schema=auth --schema=storage \
  > "$OUT/03-data.sql"

for f in 01-roles 015-extensions 02-schema 03-data; do
  printf '  %-10s %s\n' "$f" "$(wc -c < "$OUT/$f.sql" | tr -d ' ') bytes"
done

# An empty or truncated data dump restores "successfully" and loses everything.
if [ "$(wc -c < "$OUT/03-data.sql" | tr -d ' ')" -lt 1000 ]; then
  echo "FATAL: data dump is suspiciously small — refusing to continue" >&2
  exit 1
fi

if [ "$DRY_RUN" = "1" ]; then
  echo "dry run: dumps written to $OUT, nothing restored"
  exit 0
fi

# Refuse to restore over existing data.
existing=$(pg psql "$TARGET" -tAc \
  "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public'" || echo 0)
if [ "${existing:-0}" -gt 0 ] && [ "$FORCE" != "1" ]; then
  echo "FATAL: target already holds ${existing} rows in public. Restoring again" >&2
  echo "       would duplicate them. Re-run with --force if that is intended." >&2
  exit 1
fi

echo "== restoring =="
# Roles first: the schema grants to them, and a missing role turns a GRANT into
# a silent no-op rather than an error.
pg psql "$TARGET" -v ON_ERROR_STOP=0 -q -f "/dumps/$(basename "$OUT")/01-roles.sql" >/dev/null 2>&1 || true
pg psql "$TARGET" -v ON_ERROR_STOP=0 -q -f "/dumps/$(basename "$OUT")/015-extensions.sql" > "$OUT/restore-ext.log" 2>&1 || true
pg psql "$TARGET" -v ON_ERROR_STOP=0 -q -f "/dumps/$(basename "$OUT")/02-schema.sql" > "$OUT/restore-schema.log" 2>&1 || true
pg psql "$TARGET" -v ON_ERROR_STOP=0 -q -f "/dumps/$(basename "$OUT")/03-data.sql" > "$OUT/restore-data.log" 2>&1 || true

# psql writes "psql:/path/file.sql:123: ERROR:  ..." — anchoring on ^ERROR:
# matched nothing and reported a clean restore over a broken one.
errs=$(cat "$OUT"/restore-*.log 2>/dev/null | grep -c 'ERROR:' || true)
echo "  restore errors logged: ${errs:-0} (see $OUT/restore-*.log)"
if [ "${errs:-0}" -gt 0 ]; then
  echo "  first few:"; grep -h 'ERROR:' "$OUT"/restore-*.log | head -5 | sed 's/^/    /'
fi

echo "== parity =="
./parity-check.sh --source "$SOURCE" || {
  echo "FATAL: parity check failed — do NOT cut over" >&2
  exit 1
}
echo "migration complete: $OUT"
