#!/usr/bin/env bash
# Asserts the self-hosted stack is actually serving — not merely "up".
# Every check is a fact, not a container status.
set -uo pipefail
cd "$(dirname "$0")" || exit 1
[ -f .env ] || { echo "FAIL: .env missing — see runbook §2"; exit 1; }
set -a
# shellcheck source=/dev/null
. ./.env
set +a
GW="http://127.0.0.1:${KONG_HTTP_PORT:-54421}"
fails=0
ok(){ printf '  ok    %s\n' "$1"; }
bad(){ printf '  FAIL  %s\n' "$1"; fails=$((fails+1)); }

echo "== containers =="
for s in db auth rest storage kong; do
  st=$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | awk -v s="$s" '$1==s{print $2}')
  if [ "$st" = "running" ]; then ok "$s running"; else bad "$s not running (state: ${st:-absent})"; fi
done

echo "== postgres =="
if docker compose exec -T db pg_isready -U postgres >/dev/null 2>&1; then ok "accepting connections"; else bad "not ready"; fi
ver=$(docker compose exec -T db psql -U postgres -tAc "show server_version" 2>/dev/null | tr -d '\r')
if [ -n "$ver" ]; then ok "server_version $ver"; else bad "could not read server_version"; fi

echo "== supabase roles present (a restore needs these) =="
for r in anon authenticated service_role authenticator supabase_auth_admin supabase_storage_admin; do
  if docker compose exec -T db psql -U postgres -tAc \
      "select 1 from pg_roles where rolname='$r'" 2>/dev/null | grep -q 1
  then ok "role $r"; else bad "role $r MISSING"; fi
done

echo "== gateway routes =="
code=$(curl -s -o /dev/null -w '%{http_code}' "$GW/auth/v1/health")
if [ "$code" = "200" ]; then ok "auth/v1 health 200"; else bad "auth/v1 health -> $code"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' "$GW/rest/v1/" -H "apikey: ${ANON_KEY}")
if [ "$code" = "200" ]; then ok "rest/v1 reachable with anon key"; else bad "rest/v1 -> $code"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' "$GW/rest/v1/")
if [ "$code" = "401" ]; then ok "rest/v1 rejects a missing key (401)"; else bad "rest/v1 without key -> $code (expected 401)"; fi
code=$(curl -s -o /dev/null -w '%{http_code}' "$GW/storage/v1/bucket" -H "Authorization: Bearer ${SERVICE_ROLE_KEY}")
if [ "$code" = "200" ]; then ok "storage/v1 reachable with service key"; else bad "storage/v1 -> $code"; fi

echo "== hardening applied by this stack =="
if [ "${PASSWORD_MIN_LENGTH:-8}" -ge 12 ]; then ok "AUTH-001 password_min_length=${PASSWORD_MIN_LENGTH}"; else bad "AUTH-001 password_min_length too low"; fi
if [ "${STORAGE_FILE_SIZE_LIMIT:-0}" -le 26214400 ]; then ok "DB-004 bucket size limit set"; else bad "DB-004 bucket limit missing"; fi

echo
if [ "$fails" -eq 0 ]; then echo "ALL CHECKS PASSED"; else echo "$fails CHECK(S) FAILED"; exit 1; fi
