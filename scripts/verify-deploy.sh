#!/usr/bin/env bash
#
# Post-deploy verification for VisaAI. Run it ON the VPS, after a build and
# restart, before calling a deploy done.
#
# WHY THIS IS A SCRIPT AND NOT A RUNBOOK SECTION
#
# The runbook already said to check `.next/prerender-manifest.json` before
# restarting the web app. On 2026-08-24 that check was performed, the manifest
# was there at 77,851 bytes, and the restart crash-looped on ENOENT for that
# exact path anyway — 502 in public for about half a minute while `pm2 jlist`
# reported `status: online` the whole time. pm2 means "I have a process", not
# "it answers requests".
#
# Worse, the single curl fired inside that window reported a page with zero
# internal links, and that was true only of the 502 error body. A one-shot check
# inside a restart window does not distinguish "broken" from "starting", and a
# human reading a runbook will fire one-shot checks.
#
# So: poll until healthy, then sweep EVERY published page rather than a sample.
# A total outage any spot-check would catch is not the interesting failure; a
# partial one — a single country's pages 500ing because a migration half
# applied — is, and only the full sweep sees it.
#
# The page list is read out of `visa_publishable_pages`, never maintained by
# hand, so a page added yesterday is swept today without anyone remembering.
#
# Usage (on the VPS):
#   ./scripts/verify-deploy.sh
#   ./scripts/verify-deploy.sh --public          # sweep visaai.co instead of localhost
set -uo pipefail

WEB_PORT="${WEB_PORT:-3002}"
API_HEALTH="${API_HEALTH:-https://api.visaai.co/health}"
DB_CONTAINER="${DB_CONTAINER:-selfhosted_db}"
DB_USER="${DB_USER:-supabase_admin}"
BASE="http://127.0.0.1:${WEB_PORT}"
[ "${1:-}" = "--public" ] && BASE="https://visaai.co"

fail=0
say()  { printf '%s\n' "$1"; }
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }

code() { curl -s -o /dev/null -w '%{http_code}' -L -m 25 "$1"; }

say ""
say "VisaAI deploy verification — base ${BASE}"
say ""

# ── 1. Wait for the web app, do not judge it on one request ────────────────
say "Web app"
up=0
for i in $(seq 1 20); do
  c=$(code "${BASE}/visas")
  if [ "$c" = "200" ]; then
    ok "/visas answered 200 after ${i} attempt(s)"
    up=1
    break
  fi
  printf '  ...attempt %s: %s\n' "$i" "$c"
  sleep 3
done
if [ "$up" != "1" ]; then
  bad "/visas never reached 200 in ~60s"
  say ""
  say "Check the process before blaming nginx:"
  say "  pm2 logs visaai-web --lines 30 --nostream --err"
  say "  ls -la apps/web/.next/prerender-manifest.json"
  exit 1
fi

# ── 2. API ─────────────────────────────────────────────────────────────────
say ""
say "API"
c=$(code "$API_HEALTH")
[ "$c" = "200" ] && ok "health 200" || bad "health returned $c"

# ── 3. Every published page, read from the registry ────────────────────────
say ""
say "Published pages (read from the registry, not from a list)"

# Country hubs AND visa detail pages.
#
# The first version of this swept only visa_publishable_pages, which is detail
# pages. The 13 country hubs were never checked — a hub could have returned 500
# and this script would still have printed "Deploy verified". Hubs are the entry
# point to every detail page and they publish on DIFFERENT criteria (a country
# with all its sources blocked still has an indexable hub: Australia and Finland
# both do), so "the detail pages are fine" is not evidence about them.
pages=$(docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -t -A \
  -c "select slug from visa_countries where support_state <> 'unsupported'
      union all
      select country_slug || '/' || visa_slug from visa_publishable_pages
      order by 1;" 2>/dev/null)

if [ -z "$pages" ]; then
  bad "could not read the page list from ${DB_CONTAINER}"
else
  total=0; broken=0
  while read -r p; do
    [ -z "$p" ] && continue
    total=$((total+1))
    c=$(code "${BASE}/visas/${p}")
    if [ "$c" != "200" ]; then
      printf '  \033[31m%s\033[0m  /visas/%s\n' "$c" "$p"
      broken=$((broken+1))
    fi
  done <<< "$pages"

  if [ "$broken" -eq 0 ]; then
    ok "${total} page(s), all 200"
  else
    bad "${broken} of ${total} page(s) did not return 200"
  fi
fi

# ── 4. The sitemap must agree with the registry ────────────────────────────
#
# Both are derived from the same tables, so they agree by construction — until
# a filter diverges. The two are not the same query: the sitemap's country hubs
# come from `support_state <> 'unsupported'` while detail pages come from
# `visa_publishable_pages`, which has its own criteria. A change to either can
# silently make the sitemap advertise a URL that 404s, or omit a page that is
# live. Neither shows up in a status sweep, because every URL the sweep knows
# about still answers 200.
say ""
say "Sitemap vs registry"
sm=$(curl -s -m 30 "${BASE}/sitemap.xml" \
     | grep -o '<loc>[^<]*</loc>' \
     | sed -e 's|<loc>||' -e 's|</loc>||' \
     | grep -oE '/visas/[a-z0-9-]+(/[a-z0-9-]+)?$' \
     | sed 's|^/visas/||' | sort -u)
reg=$(docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -t -A \
  -c "select slug from visa_countries where support_state <> 'unsupported'
      union all
      select country_slug || '/' || visa_slug from visa_publishable_pages;" 2>/dev/null | sort -u)

if [ -z "$sm" ] || [ -z "$reg" ]; then
  bad "could not compare the sitemap with the registry"
else
  only_sitemap=$(comm -23 <(printf '%s\n' "$sm") <(printf '%s\n' "$reg"))
  only_registry=$(comm -13 <(printf '%s\n' "$sm") <(printf '%s\n' "$reg"))
  if [ -z "$only_sitemap" ] && [ -z "$only_registry" ]; then
    ok "$(printf '%s\n' "$sm" | wc -l | tr -d ' ') visa URL(s) match exactly"
  else
    [ -n "$only_sitemap" ] && { bad "sitemap advertises URLs the registry does not publish:"; printf '%s\n' "$only_sitemap" | sed 's/^/        /'; }
    [ -n "$only_registry" ] && {
      bad "registry publishes pages the sitemap omits:"
      printf '%s\n' "$only_registry" | sed 's/^/        /'
      say "      Most likely cause: Next's Data Cache survived the build. The pages"
      say "      themselves are fine; the sitemap was generated from cached registry"
      say "      reads. Fix: rm -rf apps/web/.next/cache, rebuild, restart."
    }
  fi
fi

# ── 4. Provenance — the one number that must be zero ───────────────────────
say ""
say "Provenance"
orphans=$(docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -t -A -c \
  "select count(*) from visa_requirements where status='active' and (source_version_id is null or source_excerpt is null);" 2>/dev/null)
if [ "$orphans" = "0" ]; then
  ok "no published requirement lacks its source version or excerpt"
elif [ -z "$orphans" ]; then
  bad "could not read the provenance count"
else
  # Not a deploy failure by itself, but it is the product's core promise and a
  # deploy is exactly when someone should be told.
  bad "${orphans} published requirement(s) have no provenance"
fi

say ""
if [ "$fail" -eq 0 ]; then
  say "Deploy verified."
else
  say "${fail} check(s) failed. The deploy is not verified."
  exit 1
fi
