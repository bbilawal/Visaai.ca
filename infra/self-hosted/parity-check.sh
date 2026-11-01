#!/usr/bin/env bash
# Compare a migrated self-hosted database against its SOURCE, object by object.
#
#   ./parity-check.sh --source "postgresql://postgres:PW@db.<ref>.supabase.co:5432/postgres"
#
# WHY THIS EXISTS SEPARATELY FROM verify.sh.
# verify.sh answers "is the stack serving?" — containers up, roles present,
# gateway routing. It cannot answer "did everything arrive?", because it never
# looks at the source. A restore that silently drops a schema, a policy, or half
# a table passes verify.sh completely.
#
# "Do not break anything" is a claim about the SOURCE and the TARGET agreeing,
# so this compares them directly and exits non-zero on any difference. Row
# counts are exact, not sampled — an off-by-a-few is exactly what a partial
# restore looks like.
set -uo pipefail
cd "$(dirname "$0")"

SOURCE=""
while [ $# -gt 0 ]; do
  case "$1" in
    --source) SOURCE="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
SOURCE="${SOURCE:-${SOURCE_DB_URL:-}}"
[ -n "$SOURCE" ] || { echo "FATAL: set SOURCE_DB_URL or pass --source" >&2; exit 2; }
[ -f .env ] || { echo "FATAL: .env missing" >&2; exit 1; }
set -a; . ./.env; set +a

TARGET="postgresql://supabase_admin:${POSTGRES_PASSWORD}@127.0.0.1:${POSTGRES_PORT:-54422}/${POSTGRES_DB:-postgres}"
PG_IMAGE="public.ecr.aws/supabase/postgres:17.6.1.127"
q() { docker run --rm --network host "$PG_IMAGE" psql "$1" -tAc "$2" 2>/dev/null; }

fails=0
ok(){  printf '  ok    %s\n' "$1"; }
bad(){ printf '  FAIL  %s\n' "$1"; fails=$((fails+1)); }

cmp_scalar() { # label, sql
  local label="$1" sql="$2" s t
  s=$(q "$SOURCE" "$sql"); t=$(q "$TARGET" "$sql")
  if [ -z "$s" ]; then bad "$label: could not read SOURCE"; return; fi
  if [ "$s" = "$t" ]; then ok "$label: $s"; else bad "$label: source=$s target=$t"; fi
}

echo "== object inventory =="
cmp_scalar "public tables" \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'"
cmp_scalar "public views" \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='v'"
cmp_scalar "RLS policies" \
  "select count(*) from pg_policy"
cmp_scalar "tables with RLS enabled" \
  "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity"
cmp_scalar "public functions" \
  "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
cmp_scalar "public indexes" \
  "select count(*) from pg_indexes where schemaname='public'"
cmp_scalar "auth.users" \
  "select count(*) from auth.users"
cmp_scalar "storage.objects (metadata)" \
  "select count(*) from storage.objects"

echo "== table inventory differences =="
src_tables=$(q "$SOURCE" "select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public'")
tgt_tables=$(q "$TARGET" "select string_agg(tablename, ',' order by tablename) from pg_tables where schemaname='public'")
if [ "$src_tables" = "$tgt_tables" ]; then
  ok "table names identical"
else
  bad "table names differ"
  comm -23 <(echo "$src_tables" | tr ',' '\n' | sort) <(echo "$tgt_tables" | tr ',' '\n' | sort) \
    | sed 's/^/        missing from target: /'
  comm -13 <(echo "$src_tables" | tr ',' '\n' | sort) <(echo "$tgt_tables" | tr ',' '\n' | sort) \
    | sed 's/^/        extra in target:     /'
fi

echo "== per-table row counts (exact) =="
# Built from the SOURCE's table list so a table missing entirely from the target
# is a comparison failure, not a silently skipped row.
tables=$(q "$SOURCE" "select tablename from pg_tables where schemaname='public' order by tablename")
mismatch=0; checked=0; empty=0
for t in $tables; do
  s=$(q "$SOURCE" "select count(*) from public.\"$t\"")
  g=$(q "$TARGET" "select count(*) from public.\"$t\"")
  checked=$((checked+1))
  [ "${s:-x}" = "0" ] && empty=$((empty+1))
  if [ "${s:-x}" != "${g:-y}" ]; then
    printf '  FAIL  %-42s source=%-8s target=%s\n' "$t" "${s:-?}" "${g:-MISSING}"
    mismatch=$((mismatch+1))
  fi
done
if [ "$mismatch" = "0" ]; then
  ok "$checked tables match ($empty of them empty in both)"
else
  bad "$mismatch of $checked tables differ"
  fails=$((fails+1))
fi

echo "== auth + storage schema row counts =="
# auth.users alone is not enough: losing auth.identities silently breaks every
# OAuth login, and losing auth.refresh_tokens logs everyone out. Compare the
# whole of both schemas.
sys_mismatch=0; sys_checked=0
for sch in auth storage; do
  for t in $(q "$SOURCE" "select tablename from pg_tables where schemaname='$sch' order by tablename"); do
    s=$(q "$SOURCE" "select count(*) from $sch.\"$t\"")
    g=$(q "$TARGET" "select count(*) from $sch.\"$t\"")
    sys_checked=$((sys_checked+1))
    if [ "${s:-x}" != "${g:-y}" ]; then
      printf '  FAIL  %-40s source=%-8s target=%s\n' "$sch.$t" "${s:-?}" "${g:-MISSING}"
      sys_mismatch=$((sys_mismatch+1))
    fi
  done
done
if [ "$sys_mismatch" = "0" ]; then
  ok "$sys_checked auth/storage tables match"
else
  bad "$sys_mismatch of $sys_checked auth/storage tables differ"
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "$fails PARITY CHECK(S) FAILED — the target does NOT match the source."
  echo "Do not cut over. Keep the hosted project serving."
  exit 1
fi
echo "PARITY OK — target matches source on every check above."
echo
echo "Still NOT covered by this script (runbook §7):"
echo "  * storage OBJECTS (the files). Only their metadata rows were compared."
echo "  * anything outside public/auth/storage."
