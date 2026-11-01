#!/usr/bin/env bash
# Stand up the self-hosted Supabase stack ON THE VPS and load production data
# into it — WITHOUT touching the live apps. This is the reversible half of the
# move: it does NOT repoint apps/api or apps/web, so production keeps running on
# the hosted Supabase project exactly as before. Cutover is a separate, manual
# step printed at the end.
#
# Run it on the VPS, from the repo:
#   cd <APP_DIR>/infra/self-hosted
#   read -rs SOURCE_DB_URL && export SOURCE_DB_URL   # prod session URI, no echo
#   sudo -E ./vps-bootstrap.sh
#
# SAFE BY CONSTRUCTION
#   * production database: read-only (pg_dump only).
#   * the live apps: untouched. No env file is edited, no pm2 process restarted.
#   * refuses to run if the machine is too small, or if the ports are taken by
#     something that is not this stack.
set -euo pipefail
cd "$(dirname "$0")"

echo "== preflight =="

# 1. Docker.
command -v docker >/dev/null || { echo "FATAL: docker not installed"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "FATAL: docker compose v2 required"; exit 1; }

# 2. Memory. The stack (postgres + gotrue + postgrest + storage + kong + meta)
#    needs headroom, and this box is ALSO running the live API and web. Refuse
#    rather than OOM-kill production.
mem_mb=$(free -m | awk '/^Mem:/{print $2}')
avail_mb=$(free -m | awk '/^Mem:/{print $7}')
echo "  memory: ${mem_mb}MB total, ${avail_mb}MB available"
if [ "${avail_mb:-0}" -lt 1500 ]; then
  echo "FATAL: <1.5GB available. The stack will fight the live API for RAM."
  echo "       Add swap or a bigger plan before doing this on a serving box."
  exit 1
fi

# 3. Disk for the dumps + the postgres volume.
avail_gb=$(df -BG --output=avail . | tail -1 | tr -dc '0-9')
echo "  disk: ${avail_gb}GB free here"
[ "${avail_gb:-0}" -ge 5 ] || { echo "FATAL: <5GB free"; exit 1; }

# 4. Ports. The stack uses KONG_HTTP_PORT (54421) and POSTGRES_PORT (54422),
#    deliberately offset so they cannot collide with the CLI dev stack. Make
#    sure nothing ELSE holds them — and if it is our own stack from a previous
#    run, that is fine.
for port in 54421 54422; do
  if ss -ltn "( sport = :$port )" 2>/dev/null | grep -q ":$port"; then
    if docker compose ps --format '{{.Publishers}}' 2>/dev/null | grep -q "$port"; then
      echo "  port $port held by this stack (ok)"
    else
      echo "FATAL: port $port is in use by something that is not this stack."
      exit 1
    fi
  fi
done

# 5. .env — generate on first run. CRITICAL DECISION baked in here:
if [ ! -f .env ]; then
  echo "== generating .env =="
  cp .env.example .env
  # SESSION CONTINUITY. Reuse the hosted project's JWT secret so tokens already
  # issued stay valid and nobody is logged out at cutover. Supply it as
  # PROD_JWT_SECRET; if absent, a fresh secret is generated and EVERY user is
  # logged out at cutover — allowed, but you must know which you chose.
  python3 - <<'PY'
import base64, hmac, hashlib, json, os, secrets, time, re
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b'=').decode()
def jwt(role, secret):
    h = b64(json.dumps({"alg":"HS256","typ":"JWT"},separators=(',',':')).encode())
    iat = int(time.time()); exp = iat + 10*365*24*3600
    p = b64(json.dumps({"iss":"supabase","role":role,"iat":iat,"exp":exp},separators=(',',':')).encode())
    s = b64(hmac.new(secret.encode(), f"{h}.{p}".encode(), hashlib.sha256).digest())
    return f"{h}.{p}.{s}"
prod = os.environ.get("PROD_JWT_SECRET", "").strip()
secret = prod if prod else secrets.token_urlsafe(48)
vals = {
 "POSTGRES_PASSWORD": secrets.token_urlsafe(24),
 "JWT_SECRET": secret,
 "ANON_KEY": jwt("anon", secret),
 "SERVICE_ROLE_KEY": jwt("service_role", secret),
}
s = open(".env").read()
for k,v in vals.items():
    s = re.sub(rf"^{k}=.*$", f"{k}={v}", s, flags=re.M) if re.search(rf"^{k}=", s, re.M) else s + f"\n{k}={v}\n"
open(".env","w").write(s)
print("  JWT secret:", "REUSED from PROD_JWT_SECRET (sessions preserved)" if prod
      else "FRESH (every user will be logged out at cutover)")
PY
else
  echo "  .env exists — keeping it (down -v then delete .env to regenerate)"
fi

echo "== bringing the stack up =="
docker compose up -d
echo "  waiting for the role bootstrap..."
for _ in $(seq 1 60); do
  docker compose logs db-bootstrap 2>/dev/null | grep -q "service-role passwords set" && break
  sleep 5
done

echo "== verify (is it serving?) =="
./verify.sh || { echo "FATAL: stack is not serving — fix before loading data"; exit 1; }

if [ -z "${SOURCE_DB_URL:-}" ]; then
  echo
  echo "Stack is up and serving, but SOURCE_DB_URL is unset so NO data was loaded."
  echo "Set it and re-run to load production:"
  echo "  read -rs SOURCE_DB_URL && export SOURCE_DB_URL && sudo -E ./vps-bootstrap.sh"
  exit 0
fi

echo "== loading production data (read-only on source) =="
./migrate.sh   # dumps, restores into THIS stack, ends in parity-check

cat <<'DONE'

================================================================================
The self-hosted stack is up on the VPS and holds a verified copy of production.
The LIVE APPS ARE UNCHANGED — they still use the hosted Supabase project.

Nothing is cut over yet. That is deliberate: this step is reversible, cutover is
not (there is no production backup — BLK-1).

TO CUT OVER (separate, deliberate, do it in a maintenance window):
  1. Re-run ./migrate.sh --force to capture writes since this load (or freeze
     writes first). The gap between load and cutover is lost otherwise.
  2. Copy STORAGE OBJECTS — pg_dump moved only their metadata (runbook §7).
  3. Edit <APP_DIR>/apps/api/.env and <APP_DIR>/apps/web/.env:
        SUPABASE_URL                -> http://127.0.0.1:54421
        SUPABASE_ANON_KEY           -> ANON_KEY from infra/self-hosted/.env
        SUPABASE_SERVICE_ROLE_KEY   -> SERVICE_ROLE_KEY from .env
        NEXT_PUBLIC_SUPABASE_URL / ANON_KEY likewise for web
     apps/web is build-time for NEXT_PUBLIC_* — rebuild, do not just restart.
  4. pm2 restart api && (rebuild web) && pm2 restart web
  5. Smoke-test a login and one data read. If anything is wrong, revert the
     three vars — the hosted project is still live and is your rollback.

DO NOT delete or pause the hosted Supabase project until the self-hosted stack
has served real traffic for long enough to trust it.
================================================================================
DONE
