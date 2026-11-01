#!/usr/bin/env bash
#
# Deploy apps/web on the VPS without crash-looping the running server.
#
# WHAT WENT WRONG WITHOUT THIS
#
# `next build` deletes and rewrites `.next/`. `next start` reads
# `.next/prerender-manifest.json` at boot and exits if it is absent. Restart the
# server while a build is mid-flight and pm2 restarts it, it exits again, and
# the loop continues until the build happens to write that file. On 2026-08-25
# that cost 134 restarts and a stretch of 502s during a live dry run — long
# enough that applicants created applications and could not answer the first
# question.
#
# Waiting on the build LOG is not enough: the route table and the "○ (Static)"
# legend both print before the manifest is on disk. The only safe signals are
# the build process being gone AND the manifest existing, so this waits for
# both, then restarts.
#
# Usage:  scripts/deploy-web.sh [--api]   (--api also rebuilds + restarts the API)
set -euo pipefail

HOST="${VISAAI_HOST:-root@2.24.196.5}"
KEY="${VISAAI_KEY:-$HOME/.ssh/visaai_vps}"
APP="/var/www/visaai/VisaAI"
SSH=(ssh -i "$KEY" -o StrictHostKeyChecking=no "$HOST")

run() { "${SSH[@]}" "$@"; }

# Accept --api anywhere in the arguments, not only as $1.
WANT_API=0
for arg in "$@"; do
  case "$arg" in --api) WANT_API=1 ;; esac
done

# The commit this deploy is supposed to put on the box. Asserted after the pull
# so a fetch that quietly fails cannot leave the old code building. Resolved
# from the script's own location, so the deploy does not depend on the caller's
# working directory.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WANT="$(git -C "$REPO" rev-parse HEAD)"

# Fail fast, and locally, on unpushed commits. The VPS deploys from
# origin/main, so anything sitting only in the local repo simply will not be
# there — and the post-pull assertion below would report that as "the VPS is on
# the wrong commit", which describes the symptom rather than the cause.
git -C "$REPO" fetch -q origin main 2>/dev/null || true
REMOTE="$(git -C "$REPO" rev-parse origin/main 2>/dev/null || echo "")"
if [[ -n "$REMOTE" && "$WANT" != "$REMOTE" ]]; then
  echo "!! HEAD is $(git -C "$REPO" rev-parse --short HEAD), but origin/main is $(git -C "$REPO" rev-parse --short origin/main)."
  if git -C "$REPO" merge-base --is-ancestor "$REMOTE" "$WANT"; then
    echo "   You have unpushed commits. The VPS deploys from origin/main, so they will not ship:"
    git -C "$REPO" log --oneline "$REMOTE..$WANT" | sed 's/^/     /'
    echo "   Run: git push origin main"
  else
    echo "   Your branch is behind or has diverged from origin/main. Reconcile before deploying."
  fi
  exit 1
fi

# Everything on the box — pull, assert, build, swap — runs as ONE command under
# the same lock the push webhook takes (scripts/webhook-deploy-visaai.sh), so a
# manual deploy and a webhook deploy wait for each other instead of racing.
# Two deployers building at once is what crash-looped prod on 2026-10-15.
#
# The fetch tolerates losing the refs lock to the webhook's own fetch, then
# ASSERTS the box is on the commit being deployed — a silently failing fetch
# must never rebuild the old code.
API_FLAG=""
[[ "$WANT_API" == "1" ]] && API_FLAG="--api"
echo "==> deploy $WANT on the VPS (waits for any running deploy)"
run "exec 9>/var/lock/visaai-deploy.lock; flock -w 3600 9; set -e; cd $APP; \
  for i in 1 2 3; do git fetch -f -q origin main:refs/remotes/origin/main && break || sleep 4; done; \
  git merge --ff-only -q origin/main || true; \
  if [ \"\$(git rev-parse HEAD)\" != \"$WANT\" ]; then echo \"!! VPS is on \$(git rev-parse --short HEAD), not $WANT — refusing to build\"; exit 1; fi; \
  bash scripts/deploy-on-vps.sh $API_FLAG; \
  echo $WANT > /var/lib/visaai-last-deployed" || {
  echo "!! deploy failed — see the output above; the previous build is still serving (or was rolled back)"
  exit 1
}

sleep 12
echo "==> verify"
for url in https://visaai.co/applications/new https://api.visaai.co/countries; do
  printf '%s -> ' "$url"
  curl -s -o /dev/null -w '%{http_code}\n' "$url"
done

# A restart count that keeps climbing after the restart is the crash loop this
# script exists to prevent. Sampled twice so a healthy single restart does not
# read as one.
before=$(run "pm2 jlist" | python3 -c "import sys,json;print([p['pm2_env']['restart_time'] for p in json.load(sys.stdin) if p['name']=='visaai-web'][0])")
sleep 20
after=$(run "pm2 jlist" | python3 -c "import sys,json;print([p['pm2_env']['restart_time'] for p in json.load(sys.stdin) if p['name']=='visaai-web'][0])")
if [[ "$before" != "$after" ]]; then
  echo "!! visaai-web is restarting in a loop ($before -> $after). Check: pm2 logs visaai-web --err"
  exit 1
fi
echo "==> web stable at $after restarts"
