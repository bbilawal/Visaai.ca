#!/usr/bin/env bash
# Deploy visaai.ca (Canada-only VisaAI) to the shared Hostinger VPS.
#   scripts/canada/deploy-vps.sh [--install]
# Ships the committed HEAD as a git bundle (no deploy key needed), then builds
# web + api in /var/www/visaai-ca/app and restarts pm2 apps visaai-ca-web (3005)
# and visaai-ca-api (4001). Build happens BEFORE restart; a failed build leaves
# the running version untouched.
set -euo pipefail
HOST=${VPS_HOST:-root@2.24.196.5}
KEY=${VPS_KEY:-$HOME/.ssh/visaai_vps}
APP=/var/www/visaai-ca/app
INSTALL=0; [[ " $* " == *" --install "* ]] && INSTALL=1
cd "$(git rev-parse --show-toplevel)"
SHA=$(git rev-parse HEAD)
BUNDLE=$(mktemp -t visaai-ca).bundle
git bundle create "$BUNDLE" HEAD main >/dev/null 2>&1
scp -q -i "$KEY" "$BUNDLE" "$HOST:/var/www/visaai-ca/release.bundle"
rm -f "$BUNDLE"
ssh -i "$KEY" "$HOST" bash -s -- "$SHA" "$INSTALL" <<'REMOTE'
set -euo pipefail
SHA=$1; INSTALL=$2; APP=/var/www/visaai-ca/app
cd /var/www/visaai-ca
if [ ! -d "$APP/.git" ]; then git clone -q release.bundle app; fi
cd "$APP"
git fetch -q ../release.bundle main:refs/remotes/bundle/main
git checkout -q -f "$SHA"
test "$(git rev-parse HEAD)" = "$SHA"
ln -sf /var/www/visaai-ca/env/api.env apps/api/.env
ln -sf /var/www/visaai-ca/env/web.env apps/web/.env.local
corepack prepare pnpm@9.15.9 --activate >/dev/null 2>&1 || true
if [ "$INSTALL" = 1 ] || [ ! -d node_modules ]; then nice -n 10 pnpm install --no-frozen-lockfile --config.confirmModulesPurge=false 2>&1 | tail -3; fi
nice -n 10 pnpm --filter @visaai/types build >/dev/null
# API: nest build deletes dist/ and fails ENOTEMPTY under a running process,
# so stop the Canada API first (brief downtime by design).
pm2 describe visaai-ca-api >/dev/null 2>&1 && pm2 stop visaai-ca-api >/dev/null && sleep 2
rm -rf apps/api/dist apps/api/*.tsbuildinfo
nice -n 10 pnpm --filter api build >/var/www/visaai-ca/api-build.log 2>&1 || { tail -30 /var/www/visaai-ca/api-build.log; pm2 start visaai-ca-api >/dev/null 2>&1 || true; exit 1; }
test -f apps/api/dist/main.js
echo "api files: $(find apps/api/dist -type f | wc -l)"
# Web
NODE_OPTIONS=--max-old-space-size=3072 nice -n 10 pnpm --filter web build > /var/www/visaai-ca/web-build.log 2>&1 || { tail -40 /var/www/visaai-ca/web-build.log; exit 1; }
test -f apps/web/.next/BUILD_ID && test -f apps/web/.next/prerender-manifest.json
if pm2 describe visaai-ca-api >/dev/null 2>&1; then pm2 restart visaai-ca-api --update-env >/dev/null; else
  pm2 start npm --name visaai-ca-api --cwd "$APP/apps/api" -- run start:prod >/dev/null; fi
if pm2 describe visaai-ca-web >/dev/null 2>&1; then pm2 restart visaai-ca-web --update-env >/dev/null; else
  pm2 start npm --name visaai-ca-web --cwd "$APP/apps/web" -- run start -- -p 3005 >/dev/null; fi
pm2 save >/dev/null
for i in $(seq 1 30); do
  w=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3005/ || true)
  a=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4001/health || true)
  [ "$w" = 200 ] || [ "$w" = 307 ] || [ "$w" = 308 ] && [ "$a" = 200 ] && break; sleep 3; done
echo "web=$w api=$a sha=$(git rev-parse --short HEAD)"
pm2 jlist | python3 -c "import json,sys;[print(p['name'],p['pm2_env']['status'],'restarts',p['pm2_env']['restart_time']) for p in json.load(sys.stdin) if p['name'].startswith('visaai-ca')]"
REMOTE
