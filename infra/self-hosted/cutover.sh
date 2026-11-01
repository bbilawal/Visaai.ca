#!/usr/bin/env bash
# Cut the LIVE VisaAI apps over to the self-hosted Supabase stack — reversibly.
#
#   sudo ./cutover.sh --api            # server-side only (safe, env + restart)
#   sudo ./cutover.sh --api --web      # also the browser side (nginx + rebuild)
#   sudo ./cutover.sh --rollback       # undo everything from the last run
#
# CONTEXT this script assumes (verified 2026-08-10 on srv1584195):
#   * apps/api/.env currently points at a DEAD Supabase ref (xaemx…, NXDOMAIN),
#     so the live API cannot reach its DB at all — RemindersService logs
#     "fetch failed" daily. Cutover can only improve that.
#   * the self-hosted stack is up (infra/self-hosted, kong on 127.0.0.1:54421)
#     and holds a parity-verified copy of the real DB (ujxz…, 13 users).
#   * nginx: visaai.co -> localhost:3002 (TLS, cert visaai.co); api.visaai.co ->
#     localhost:4000 (:80, TLS at Cloudflare).
#
# WHAT EACH HALF DOES
#   --api : rewrites 3 vars in apps/api/.env to the local stack and restarts
#           visaai-api. Runtime env, no rebuild. Fully reversible.
#   --web : (a) adds an nginx `location /sbkong/` on the visaai.co 443 vhost that
#               proxies to kong, so the BROWSER can reach Supabase over TLS
#               (NEXT_PUBLIC_SUPABASE_URL must be public — localhost is useless
#               to a user's browser);
#           (b) rewrites apps/web/.env and REBUILDS the web app. The rebuild
#               ships whatever the current checkout is — right now ~5 weeks ahead
#               of the running build (DEPLOY-001). That is a real code deploy, not
#               just a config change. Know that before running --web.
set -euo pipefail
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
API_ENV="$REPO/apps/api/.env"
WEB_ENV="$REPO/apps/web/.env.local"   # Next.js reads .env.local, not .env
SB_ENV="./.env"
NGINX_SITE="/etc/nginx/sites-available/visaai.co"   # the ENABLED file (sites-enabled/visaai.co -> this)
BK="/root/cutover-state"                 # where this script records what it did
KONG="http://127.0.0.1:54421"
# corepack's default pnpm is v11 which needs Node 22; the box runs Node 20.
# pnpm 9 runs fine under Node 20 (same major CI uses). Pin it for the build.
PNPM="npx --yes pnpm@9.15.0"
PUBLIC_SB_PATH="/sbkong"                 # browser-facing prefix on visaai.co
PUBLIC_SB_URL="https://visaai.co${PUBLIC_SB_PATH}"

do_api=0; do_web=0; do_rollback=0
for a in "$@"; do case "$a" in
  --api) do_api=1;; --web) do_web=1;; --rollback) do_rollback=1;;
  *) echo "unknown arg: $a"; exit 2;; esac; done
[ $do_api -eq 0 ] && [ $do_web -eq 0 ] && [ $do_rollback -eq 0 ] && { echo "nothing to do; pass --api and/or --web, or --rollback"; exit 2; }

ts() { date -u +%Y%m%dT%H%M%SZ; }

# ---------------------------------------------------------------- rollback ----
if [ $do_rollback -eq 1 ]; then
  [ -d "$BK" ] || { echo "no $BK — nothing to roll back"; exit 1; }
  echo "== rolling back from $BK =="
  [ -f "$BK/api.env" ] && { cp "$BK/api.env" "$API_ENV"; echo "  restored apps/api/.env"; pm2 restart visaai-api --update-env >/dev/null && echo "  restarted visaai-api"; }
  [ -f "$BK/web.env" ] && cp "$BK/web.env" "$WEB_ENV" && echo "  restored apps/web/.env"
  if [ -f "$BK/visaai.nginx" ]; then
    cp "$BK/visaai.nginx" "$NGINX_SITE"
    nginx -t 2>/dev/null && systemctl reload nginx && echo "  restored + reloaded nginx"
  fi
  if [ -d "$BK/web-dotnext" ]; then
    rm -rf "$REPO/apps/web/.next"; cp -r "$BK/web-dotnext" "$REPO/apps/web/.next"
    pm2 restart visaai-web >/dev/null && echo "  restored web build + restarted visaai-web"
  fi
  echo "rollback done. Verify: curl -s https://api.visaai.co/countries | head -c 80"
  exit 0
fi

# read the local stack's keys
ANON=$(grep -E '^ANON_KEY=' "$SB_ENV" | cut -d= -f2-)
SVC=$(grep -E '^SERVICE_ROLE_KEY=' "$SB_ENV" | cut -d= -f2-)
[ -n "$ANON" ] && [ -n "$SVC" ] || { echo "FATAL: ANON_KEY/SERVICE_ROLE_KEY missing in $SB_ENV"; exit 1; }

# the stack must actually be serving before we point production at it
./verify.sh >/dev/null 2>&1 || { echo "FATAL: self-hosted stack not serving (verify.sh failed). Aborting."; exit 1; }

mkdir -p "$BK"

setv() { # file key value
  python3 - "$1" "$2" "$3" <<'PY'
import sys,re
f,k,v=sys.argv[1:4]; s=open(f).read()
s=re.sub(rf'^{k}=.*$', f'{k}={v}', s, flags=re.M) if re.search(rf'^{k}=',s,re.M) else s+f'\n{k}={v}\n'
open(f,'w').write(s)
PY
}

# ------------------------------------------------------------------- --api ----
if [ $do_api -eq 1 ]; then
  echo "== API cutover =="
  [ -f "$BK/api.env" ] || cp "$API_ENV" "$BK/api.env"   # pristine rollback point (once)
  setv "$API_ENV" SUPABASE_URL "$KONG"
  setv "$API_ENV" SUPABASE_ANON_KEY "$ANON"
  setv "$API_ENV" SUPABASE_SERVICE_ROLE_KEY "$SVC"
  echo "  apps/api/.env -> $KONG (+ new keys). backup: $BK/api.env"
  pm2 restart visaai-api --update-env >/dev/null && echo "  restarted visaai-api"
  sleep 6
  code=$(curl -s -m 8 -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/countries)
  echo "  smoke: /countries -> $code"
  if pm2 logs visaai-api --lines 30 --nostream 2>/dev/null | grep -qi "fetch failed"; then
    echo "  NOTE: 'fetch failed' still in recent logs — check it is stale, not new."
  fi
  echo "  API is now on the local stack. Roll back: ./cutover.sh --rollback"
fi

# ------------------------------------------------------------------- --web ----
if [ $do_web -eq 1 ]; then
  echo "== WEB cutover =="
  echo "  WARNING: this rebuilds apps/web from the current checkout, which is"
  echo "  ahead of the running build. It is a code deploy as well as a config"
  echo "  change. Ctrl-C in the next 8s to abort."
  sleep 8

  # (a) expose kong on the public TLS vhost so browsers can reach it
  if ! grep -q "location ${PUBLIC_SB_PATH}/" "$NGINX_SITE"; then
    [ -f "$BK/visaai.nginx" ] || cp "$NGINX_SITE" "$BK/visaai.nginx"   # once
    # insert the location into the visaai.co :443 server block, before `location / {`
    python3 - "$NGINX_SITE" "$PUBLIC_SB_PATH" "$KONG" <<'PY'
import sys,re
f,path,kong=sys.argv[1:4]
s=open(f).read()
block=f'''    location {path}/ {{
        proxy_pass {kong}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }}

'''
# Insert before the visaai.co web block's `location / {` — matched by its
# proxy_pass to :3002, tolerant of localhost vs 127.0.0.1. api.visaai.co proxies
# to :4000, so this cannot accidentally hit that block.
m=re.search(r"    location / \{\n        proxy_pass http://(?:localhost|127\.0\.0\.1):3002;", s)
if not m:
    raise SystemExit("FATAL: could not find the visaai.co :3002 web block to anchor /sbkong")
s=s[:m.start()] + block + s[m.start():]
open(f,'w').write(s)
PY
    nginx -t 2>/dev/null || { echo "  FATAL: nginx config invalid, restoring"; cp "$BK/visaai.nginx" "$NGINX_SITE"; exit 1; }
    systemctl reload nginx && echo "  nginx: kong exposed at ${PUBLIC_SB_URL} (reloaded)"
  else
    echo "  nginx: ${PUBLIC_SB_PATH}/ already present"
  fi

  # (b) point the browser client at the public URL + rebuild
  [ -f "$BK/web.env" ] || cp "$WEB_ENV" "$BK/web.env"   # pristine rollback point (once)
  setv "$WEB_ENV" NEXT_PUBLIC_SUPABASE_URL "$PUBLIC_SB_URL"
  setv "$WEB_ENV" NEXT_PUBLIC_SUPABASE_ANON_KEY "$ANON"
  echo "  apps/web/.env -> ${PUBLIC_SB_URL} (+ anon). backup: $BK/web.env"

  [ -d "$BK/web-dotnext" ] || { [ -d "$REPO/apps/web/.next" ] && cp -r "$REPO/apps/web/.next" "$BK/web-dotnext"; }   # once
  echo "  rebuilding web (this is the slow, risky part)..."
  # Build workspace deps FIRST. The checkout is 5 weeks ahead of the VPS's
  # built packages/types (dist was Jul 6), so web fails type-check on exports
  # that exist in source but not the stale dist (e.g. PartnerApiKeySummary).
  ( cd "$REPO" && $PNPM install --frozen-lockfile \
      && $PNPM --filter @visaai/types build \
      && $PNPM --filter @visaai/partner-sdk build 2>/dev/null; \
    cd "$REPO" && $PNPM --filter web build ) || { echo "  BUILD FAILED — rolling web back"; [ -d "$BK/web-dotnext" ] && { rm -rf "$REPO/apps/web/.next"; cp -r "$BK/web-dotnext" "$REPO/apps/web/.next"; }; exit 1; }
  pm2 restart visaai-web --update-env >/dev/null && echo "  restarted visaai-web"
  sleep 4
  code=$(curl -s -m 10 -o /dev/null -w '%{http_code}' "${PUBLIC_SB_URL}/auth/v1/health")
  echo "  smoke: ${PUBLIC_SB_URL}/auth/v1/health -> $code (200 = browsers can reach Supabase)"
fi

echo
echo "Done. Rollback anything: ./cutover.sh --rollback"
echo "Keep the old Supabase project reachable as a fallback until this is trusted."
