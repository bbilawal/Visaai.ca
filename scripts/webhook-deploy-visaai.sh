#!/usr/bin/env bash
#
# Installed on the VPS as /var/www/webhook/deploy-visaai.sh — the script the
# GitHub push webhook (/var/www/webhook/server.js) runs on every push to main.
# Keep the two in sync: `install -m 755 scripts/webhook-deploy-visaai.sh
# /var/www/webhook/deploy-visaai.sh`.
#
# It used to pull and build IN PLACE, racing scripts/deploy-web.sh and crash-
# looping prod on every merge (full outage 2026-10-15). Now it only launches
# scripts/deploy-on-vps.sh, detached, under the shared deploy lock:
#   - detached: server.js kills its child after 10 minutes, which used to cut
#     a build off mid-write
#   - locked:   a deploy already running is waited for, never raced
#   - deduped:  a burst of pushes (5 merges = 5 webhooks) builds once per new
#     commit, not once per push
set -euo pipefail

REPO=/var/www/visaai/VisaAI
LOCK=/var/lock/visaai-deploy.lock
LOG=/var/log/visaai-deploy.log
LAST=/var/lib/visaai-last-deployed

export HOME=/root
export PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

nohup setsid bash -c '
  set -euo pipefail
  exec 9>"'"$LOCK"'"
  flock -w 3600 9
  cd "'"$REPO"'"
  echo "=== $(date -u +%FT%TZ) webhook deploy ==="
  for i in 1 2 3; do git fetch -q origin main && break || sleep 4; done
  git merge --ff-only -q origin/main
  head=$(git rev-parse HEAD)
  if [ "$(cat "'"$LAST"'" 2>/dev/null)" = "$head" ]; then
    echo "already live: $head — nothing to do"; exit 0
  fi
  if [ -n "$(git diff --name-only HEAD@{1} HEAD -- pnpm-lock.yaml 2>/dev/null)" ]; then
    pnpm install --frozen-lockfile || pnpm install
  fi
  bash scripts/deploy-on-vps.sh --api
  echo "$head" > "'"$LAST"'"
' >> "$LOG" 2>&1 < /dev/null &

echo "deploy launched (log: $LOG)"
