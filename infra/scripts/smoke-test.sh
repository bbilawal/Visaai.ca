#!/usr/bin/env bash
# Post-deploy smoke test. Run against the deployed origin; exits non-zero if
# the release is not serving correctly, which is deploy.sh's rollback signal.
#
# Read-only and unauthenticated by design: a smoke test that writes data is a
# smoke test nobody dares run against production.
set -euo pipefail

API="${API_ORIGIN:-http://127.0.0.1:4000}"
WEB="${WEB_ORIGIN:-http://127.0.0.1:3000}"
FAILED=0

check() {
  local name="$1" url="$2" expect="$3"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)"
  if [ "$code" = "$expect" ]; then
    echo "  ok    $name ($code)"
  else
    echo "  FAIL  $name — expected $expect, got $code  [$url]" >&2
    FAILED=1
  fi
}

echo "smoke test: api=$API web=$WEB"

# Liveness: the process is up.
check "api liveness"  "$API/health"        200
# Readiness: Postgres and Redis are both reachable. 503 here means the release
# is running but cannot serve, which is exactly what should trigger a rollback.
check "api readiness" "$API/health/ready"  200
check "web root"      "$WEB/"              200

# An authenticated route must still refuse an anonymous caller. If a deploy
# ever makes this 200, authentication is broken and rollback is urgent.
check "api rejects anonymous" "$API/v1/me" 401

# Security headers survived the deploy.
HEADERS="$(curl -s -I --max-time 10 "$WEB/" || true)"
for header in "strict-transport-security" "x-content-type-options"; do
  if grep -qi "$header" <<<"$HEADERS"; then
    echo "  ok    header $header present"
  else
    echo "  FAIL  header $header missing" >&2
    FAILED=1
  fi
done

[ "$FAILED" -eq 0 ] || { echo "smoke test: FAIL" >&2; exit 1; }
echo "smoke test: PASS"
