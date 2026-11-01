#!/usr/bin/env bash
#
# The checks CI would run, run here instead.
#
# GitHub Actions has not executed a job since 24 Aug 2026 — every run dies two
# seconds in with "recent account payments have failed or your spending limit
# needs to be increased". Until that is settled, anything landing on main is
# verified by whoever pushed it or by nothing at all. This script is the
# "by whoever pushed it" half, so it is at least one command rather than six.
#
#   ./scripts/verify-local.sh
#
# IT IS NOT A CI REPLACEMENT. It deliberately runs only the checks that need no
# external services, because those are the ones that will actually get run. What
# it SKIPS is listed at the end of every run, so the gap stays visible instead of
# being quietly mistaken for green.
#
set -uo pipefail
cd "$(dirname "$0")/.."

pass=0; fail=0; failed_names=()

step() {
  local name="$1"; shift
  printf '\n\033[1m▸ %s\033[0m\n' "$name"
  if "$@"; then
    printf '\033[32m  ✔ %s\033[0m\n' "$name"; pass=$((pass + 1))
  else
    printf '\033[31m  ✘ %s\033[0m\n' "$name"; fail=$((fail + 1)); failed_names+=("$name")
  fi
}

step "Shared types build"        pnpm build:types
step "API — typecheck"           pnpm --filter api exec tsc --noEmit -p tsconfig.json
step "API — jest"                pnpm --filter api exec jest --ci --silent
step "API — vulnerable deps gate" node scripts/check-vulnerable-deps.mjs
step "Web — typecheck"           pnpm --filter web exec tsc --noEmit -p tsconfig.json
step "Web — unit (vitest)"       pnpm --filter web test:unit --reporter=dot
step "Extension — typecheck"     pnpm --filter extension exec tsc --noEmit
step "Extension — jest"          pnpm --filter extension exec jest --silent
step "Extension — both packages build" bash -c 'cd apps/extension && node build.mjs && node build.mjs --selfhost'

printf '\n\033[1m──────── %d passed, %d failed ────────\033[0m\n' "$pass" "$fail"

cat <<'SKIPPED'

NOT covered here (these need a local Supabase, Playwright browsers, or network):
  · Tenant isolation / RLS suites          supabase start + jest
  · Web E2E + a11y                          playwright, incl. against a real API
  · Perf budgets                            lighthouse-ci
  · Mobile lint/typecheck/jest              pnpm --filter mobile
  · osv-scanner dependency scan
A green run here is NOT the same as a green CI run. Fix the Actions billing.
SKIPPED

if [ "$fail" -gt 0 ]; then
  printf '\n\033[31mFailed: %s\033[0m\n' "${failed_names[*]}"
  exit 1
fi
