#!/usr/bin/env bash
#
# Build and ship VisaAI ON THE VPS. The single deploy path: the GitHub push
# webhook (/var/www/webhook/deploy-visaai.sh) and scripts/deploy-web.sh both
# call this, under the same lock.
#
# WHY (2026-10-15): two deployers ran at once on every merge — the webhook
# built IN PLACE (`nest build` wipes dist/, `next build` rewrites .next/ under
# the running processes) while deploy-web.sh built too. That raced and crash-
# looped prod on every deploy (+60..95 web restarts; a full API + web outage on
# 2026-10-15). Now:
#   - one lock: a second deploy waits instead of racing
#   - staging builds: dist-staging / .next-staging, the live dirs untouched
#   - one swap + restart, then a health check; a web build that will not serve
#     is rolled back to .next-prev automatically
#
# Usage (on the VPS, from anywhere):
#   flock -w 1800 /var/lock/visaai-deploy.lock bash /var/www/visaai/VisaAI/scripts/deploy-on-vps.sh [--api]
# The caller pulls first; this builds whatever is checked out.
set -euo pipefail

APP="${VISAAI_APP:-/var/www/visaai/VisaAI}"
WANT_API=0
for arg in "$@"; do case "$arg" in --api) WANT_API=1 ;; esac; done

export HOME="${HOME:-/root}"
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH"
cd "$APP"
echo "==> deploying $(git log --oneline -1)"

# Node 20 box: pnpm 11 needs Node >= 22.13, 9.15.9 works.
corepack prepare pnpm@9.15.9 --activate >/dev/null 2>&1 || true

echo "==> build shared types"
pnpm build:types > /tmp/types-build.log 2>&1 || {
  echo "!! types build FAILED — nothing changed"; tail -20 /tmp/types-build.log; exit 1; }

if [[ "$WANT_API" == "1" ]]; then
  echo "==> build api -> dist-staging"
  (cd apps/api && rm -rf dist-staging && npx nest build -p tsconfig.staging.json) \
    > /tmp/api-build.log 2>&1 || {
    echo "!! api build FAILED — nothing changed"; tail -30 /tmp/api-build.log; exit 1; }
  files=$(find apps/api/dist-staging -name '*.js' | wc -l)
  if [[ ! -f apps/api/dist-staging/main.js || "$files" -lt 300 ]]; then
    echo "!! api build incomplete ($files .js files) — nothing changed"; exit 1
  fi
  echo "   api ok ($files .js files)"
fi

echo "==> build web -> .next-staging"
(cd apps/web && rm -rf .next-staging && NEXT_DIST_DIR=.next-staging pnpm build) \
  > /tmp/web-build.log 2>&1 || {
  echo "!! web build FAILED — nothing changed"; tail -30 /tmp/web-build.log; exit 1; }
for f in BUILD_ID prerender-manifest.json; do
  [[ -f "apps/web/.next-staging/$f" ]] || {
    echo "!! web build has no .next-staging/$f — nothing changed"; exit 1; }
done

echo "==> swap + restart"
procs="visaai-web"
(cd apps/web && rm -rf .next-prev && mv .next .next-prev && mv .next-staging .next)
if [[ "$WANT_API" == "1" ]]; then
  (cd apps/api && rm -rf dist-prev && mv dist dist-prev && mv dist-staging dist)
  procs="visaai-api visaai-web"
fi
pm2 restart $procs --update-env >/dev/null

healthy() {
  local web api
  web=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3002/ || true)
  api=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/health || true)
  [[ "$web" =~ ^(200|307|308)$ && "$api" == "200" ]]
}

echo "==> health (up to 90s)"
for _ in $(seq 1 30); do healthy && break; sleep 3; done
if ! healthy; then
  echo "!! not healthy after the swap — rolling back to the previous build"
  (cd apps/web && rm -rf .next-bad && mv .next .next-bad && mv .next-prev .next)
  if [[ "$WANT_API" == "1" ]]; then
    (cd apps/api && rm -rf dist-bad && mv dist dist-bad && mv dist-prev dist)
  fi
  pm2 restart $procs --update-env >/dev/null
  sleep 10
  healthy && echo "   rolled back; previous build is serving" || echo "!! STILL UNHEALTHY after rollback — check pm2 logs"
  exit 1
fi
echo "==> live: $(git log --oneline -1)"
