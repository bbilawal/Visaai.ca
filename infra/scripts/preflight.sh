#!/usr/bin/env bash
# Pre-deploy validation. Run ON THE TARGET BOX, before deploy.sh.
#
# Everything here is a check that has actually gone wrong somewhere, or that
# would be silent and expensive if it did. It exits non-zero on the first
# failure so a bad deploy stops before pm2 is touched.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/visaai}"
API_ENV="$APP_DIR/apps/api/.env"
# The VPS keeps the web env in apps/web/.env.local (Next.js reads both);
# point WEB_ENV at it there.
WEB_ENV="${WEB_ENV:-$APP_DIR/apps/web/.env}"
# Legacy hosted project. Production moved to the self-hosted stack in
# infra/self-hosted (Kong on loopback :54421); the hosted project still holds
# pre-cutover data, so non-production must never point at it either.
PROD_SUPABASE_REF="ujxzxefvtaoxiydbdrhb"
PROD_SUPABASE_URL="${PROD_SUPABASE_URL:-http://127.0.0.1:54421}"

fail() { echo "PREFLIGHT FAIL: $*" >&2; exit 1; }
ok()   { echo "  ok  $*"; }

echo "preflight: $APP_DIR"

# 1. Tooling
command -v node >/dev/null || fail "node not on PATH"
command -v pnpm >/dev/null || fail "pnpm not on PATH"
command -v pm2  >/dev/null || fail "pm2 not on PATH"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "node >= 20 required, found $NODE_MAJOR"
ok "node $(node -v), pnpm $(pnpm -v), pm2 present"

# 2. Env files exist and are not world-readable. A 644 .env on a shared box
#    hands the service-role key to every user on it.
for f in "$API_ENV" "$WEB_ENV"; do
  [ -f "$f" ] || fail "missing $f"
  PERMS="$(stat -c '%a' "$f" 2>/dev/null || stat -f '%Lp' "$f")"
  [ "$PERMS" = "600" ] || fail "$f is mode $PERMS, expected 600"
done
ok "env files present and mode 600"

# 3. Required variables are set and non-empty.
REQUIRED_API=(NODE_ENV SUPABASE_URL SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY
              STRIPE_SECRET_KEY REDIS_URL WEB_URL EMAIL_ENCRYPTION_KEY)
for key in "${REQUIRED_API[@]}"; do
  grep -qE "^${key}=.+" "$API_ENV" || fail "$key missing or empty in $API_ENV"
done
ok "required api variables present"

# 4. Environment isolation. Mirrors apps/api/src/config/environment-isolation.ts
#    so the box refuses a mismatch before boot, not during it.
NODE_ENV_VALUE="$(grep -E '^NODE_ENV=' "$API_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
SUPABASE_URL_VALUE="$(grep -E '^SUPABASE_URL=' "$API_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"
STRIPE_VALUE="$(grep -E '^STRIPE_SECRET_KEY=' "$API_ENV" | head -1 | cut -d= -f2- | tr -d '"'"'"' ')"

if [ "$NODE_ENV_VALUE" != "production" ]; then
  case "$SUPABASE_URL_VALUE" in
    *"$PROD_SUPABASE_REF"*) fail "NODE_ENV=$NODE_ENV_VALUE but SUPABASE_URL points at production" ;;
  esac
  case "$STRIPE_VALUE" in
    sk_live_*) fail "NODE_ENV=$NODE_ENV_VALUE but STRIPE_SECRET_KEY is a LIVE key" ;;
  esac
  ok "non-production config is isolated from production"
else
  # The inverse mistake: production pointed at a test Stripe key takes payments
  # that never settle.
  case "$STRIPE_VALUE" in
    sk_test_*) fail "NODE_ENV=production but STRIPE_SECRET_KEY is a TEST key" ;;
  esac
  [ "${SUPABASE_URL_VALUE%/}" = "${PROD_SUPABASE_URL%/}" ] \
    || fail "NODE_ENV=production but SUPABASE_URL ($SUPABASE_URL_VALUE) is not the production stack ($PROD_SUPABASE_URL)"
  ok "production config points at production"
fi

# 5. Disk. A build that fills the disk leaves the box unbootable, and the
#    Next.js build alone needs ~2 GB of headroom.
AVAIL_MB="$(df -Pm "$APP_DIR" | awk 'NR==2 {print $4}')"
[ "$AVAIL_MB" -ge 3000 ] || fail "only ${AVAIL_MB}MB free on $APP_DIR, need >= 3000MB"
ok "disk headroom ${AVAIL_MB}MB"

# 6. Redis reachable — BullMQ workers silently stop processing without it.
if command -v redis-cli >/dev/null; then
  redis-cli ping >/dev/null 2>&1 || fail "redis not responding to PING"
  ok "redis responding"
else
  echo "  warn  redis-cli not installed; skipped redis check" >&2
fi

# 7. TLS certificate expiry. Renewal is automated, and automation fails quietly.
if command -v openssl >/dev/null && [ -n "${TLS_HOST:-}" ]; then
  END="$(echo | openssl s_client -servername "$TLS_HOST" -connect "$TLS_HOST:443" 2>/dev/null \
        | openssl x509 -noout -enddate | cut -d= -f2)"
  END_EPOCH="$(date -d "$END" +%s 2>/dev/null || date -j -f '%b %d %T %Y %Z' "$END" +%s)"
  DAYS=$(( (END_EPOCH - $(date +%s)) / 86400 ))
  [ "$DAYS" -ge 14 ] || fail "TLS certificate for $TLS_HOST expires in ${DAYS}d"
  ok "TLS certificate valid for ${DAYS}d"
fi

# 8. Schema parity. Every RPC the API calls must exist in the target database.
#    A build whose migration was never applied passes every other check here
#    and then fails in production on first use (REVIEW_HANDOFF §27.6, §34).
REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
node "$REPO_ROOT/infra/scripts/rpc-parity.mjs" "$REPO_ROOT" "$API_ENV" \
  || fail "database is missing RPCs this build calls — apply migrations first"
ok "database exposes every RPC the API calls"

echo "preflight: PASS"
