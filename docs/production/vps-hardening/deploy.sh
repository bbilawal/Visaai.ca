#!/usr/bin/env bash
# =============================================================================
# EXAMPLE — REVIEW BEFORE USE. Not a drop-in script.
# =============================================================================
# VisaAI VPS deploy with health-gate + automatic rollback.
#
# WHAT IT REPLACES
#   The current process is "ssh in, git pull, pnpm build, pm2 restart" by hand
#   with no health check and no way back. This script makes the same steps
#   repeatable, records the previous git SHA, reloads with zero downtime, polls
#   /health, and auto-reverts to the previous SHA if the new build is unhealthy.
#
# WHERE IT RUNS
#   ON the VPS, from the app root. Two ways to invoke:
#     A) SSH + run:        ssh deploy@srv1584195.hstgr.cloud "cd /var/www/visaai && ./deploy.sh"
#     B) Pipe from laptop: ssh deploy@srv1584195.hstgr.cloud 'bash -s' < deploy.sh
#   You can later wrap (A) in a GitHub Actions job (appleboy/ssh-action) so a
#   tagged release or a manual "workflow_dispatch" triggers it. `git push` still
#   does NOT deploy on its own — that stays true until you add that workflow.
#
# WHAT IT DOES NOT DO
#   It does NOT run DB migrations. Migrations are forward-only and destructive to
#   roll back, so they are a SEPARATE, deliberate step (see README §4 and
#   supabase-snapshot.sh). Snapshot + migrate BEFORE running this for any deploy
#   that ships a migration. This script only moves app CODE, which is reversible.
# =============================================================================

set -Eeuo pipefail

# --- Config (override via env) ----------------------------------------------
APP_DIR="${APP_DIR:-/var/www/visaai}"
BRANCH="${BRANCH:-main}"
ECOSYSTEM="${ECOSYSTEM:-docs/production/vps-hardening/ecosystem.config.js}"
API_HEALTH_URL="${API_HEALTH_URL:-http://127.0.0.1:4000/health}"
WEB_HEALTH_URL="${WEB_HEALTH_URL:-http://127.0.0.1:3000/}"   # add /api/health route ideally (README §5)
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"      # 20 × 3s = 60s max wait
HEALTH_INTERVAL="${HEALTH_INTERVAL:-3}"
LOCKFILE="${LOCKFILE:-/tmp/visaai-deploy.lock}"

log()  { printf '\033[1;34m[deploy]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[deploy]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[deploy] FATAL:\033[0m %s\n' "$*" >&2; exit 1; }

# Deploy alerting. No-op when DEPLOY_ALERT_WEBHOOK is unset, so a dev box stays
# quiet; on the VPS it is set and a failed deploy pages someone.
#
# Never `die` or `return 1` from here: this is called from the rollback path and
# from the ERR trap, and an alert that fails must not become the thing that
# aborts the recovery. Curl failure is reported to stderr and swallowed.
alert() {
  local msg="$1"
  warn "ALERT: $msg"
  [ -n "${DEPLOY_ALERT_WEBHOOK:-}" ] || return 0
  # Slack-compatible payload. jq builds it so a quote or newline in $msg cannot
  # break out of the JSON; falls back to a conservative escape if jq is absent.
  local payload
  if command -v jq >/dev/null 2>&1; then
    payload=$(jq -nc --arg t "[VisaAI deploy] $msg" '{text: $t}')
  else
    payload="{\"text\":\"[VisaAI deploy] ${msg//\"/\\\"}\"}"
  fi
  curl -fsS --max-time 10 -X POST -H 'Content-Type: application/json' \
    -d "$payload" "$DEPLOY_ALERT_WEBHOOK" >/dev/null 2>&1 \
    || warn "alert webhook POST failed (deploy status above is authoritative)"
  return 0
}

# --- Single-flight lock: never let two deploys race -------------------------
exec 9>"$LOCKFILE" || die "cannot open lock $LOCKFILE"
flock -n 9 || die "another deploy is in progress ($LOCKFILE)"

cd "$APP_DIR" || die "APP_DIR $APP_DIR not found"
command -v pnpm >/dev/null || die "pnpm not on PATH"
command -v pm2  >/dev/null || die "pm2 not on PATH"

# --- Health probe: poll until 2xx or give up --------------------------------
check_health() {
  local url="$1" name="$2" i
  for ((i = 1; i <= HEALTH_RETRIES; i++)); do
    if curl -fsS --max-time 4 "$url" >/dev/null 2>&1; then
      log "$name healthy (${url})"
      return 0
    fi
    sleep "$HEALTH_INTERVAL"
  done
  warn "$name FAILED health check after $((HEALTH_RETRIES * HEALTH_INTERVAL))s (${url})"
  return 1
}

build_all() {
  log "install (frozen lockfile)…"
  pnpm install --frozen-lockfile
  log "build types → web → api…"
  pnpm build:types
  # Web build bakes NEXT_PUBLIC_* from apps/web/.env at THIS moment.
  pnpm --filter web build
  pnpm --filter api build
}

reload_pm2() {
  # `reload` = zero-downtime for the web/api HTTP procs (pm2 restarts workers
  # one at a time). For a single fork instance it is effectively a fast restart;
  # combined with the health-gate below that is acceptable. --update-env re-reads
  # the ecosystem env block.
  log "pm2 reload $ECOSYSTEM…"
  pm2 reload "$ECOSYSTEM" --update-env
}

# --- Capture rollback target BEFORE we touch anything -----------------------
PREV_SHA="$(git rev-parse HEAD)"
log "current SHA: $PREV_SHA"

# --- Pull new code ----------------------------------------------------------
log "fetching origin/$BRANCH…"
git fetch --prune origin "$BRANCH"
TARGET_SHA="$(git rev-parse "origin/$BRANCH")"
if [[ "$PREV_SHA" == "$TARGET_SHA" ]]; then
  log "already at origin/$BRANCH ($TARGET_SHA). Reloading anyway to pick up env/deps."
fi
# Hard reset to the remote tip — the VPS checkout is a deploy target, not a
# workspace, so local drift is discarded intentionally.
git reset --hard "$TARGET_SHA"

# --- Build + reload + gate --------------------------------------------------
rollback() {
  warn "ROLLING BACK to $PREV_SHA"
  git reset --hard "$PREV_SHA"
  build_all || warn "rollback build had errors — inspect manually!"
  reload_pm2 || warn "rollback reload had errors — inspect manually!"
  if check_health "$API_HEALTH_URL" "api" && check_health "$WEB_HEALTH_URL" "web"; then
    warn "rollback succeeded — service restored on $PREV_SHA. Deploy of $TARGET_SHA ABORTED."
    alert "deploy of $TARGET_SHA FAILED; rolled back to $PREV_SHA. Service is up."
  else
    # Alert BEFORE dying. The TODO this replaces sat after the `die`, so the
    # single most severe outcome — rollback itself unhealthy — was the one case
    # that could never have alerted anyone.
    alert "DEPLOY AND ROLLBACK BOTH FAILED. Service is DOWN on $PREV_SHA. Manual intervention required."
    die "ROLLBACK ALSO UNHEALTHY. Manual intervention required. SHA=$PREV_SHA"
  fi
  exit 1
}

trap 'warn "error on line $LINENO"; rollback' ERR

build_all
reload_pm2

# Health-gate the new build. Any failure trips the ERR trap → rollback().
check_health "$API_HEALTH_URL" "api" || rollback
check_health "$WEB_HEALTH_URL" "web" || rollback

trap - ERR
log "DEPLOY OK — now on $TARGET_SHA (was $PREV_SHA)"
pm2 save >/dev/null 2>&1 || true
