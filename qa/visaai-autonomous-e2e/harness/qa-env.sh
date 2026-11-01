#!/usr/bin/env bash
# Reconstructs the QA environment described in reports/DISCOVERED_PRODUCT_INVENTORY.md §8.
#
# WHY THIS EXISTS: apps/web/.env.local and apps/api/.env both point at the REMOTE
# Supabase project. The QA run uses the disposable LOCAL stack instead, and that
# difference lived only in the shell that happened to launch the servers. Killing
# a dev server therefore silently reverted web to the remote project while the API
# stayed local — guest JWTs were then signed by one issuer and validated by
# another, and every application create returned 401 with no clue why.
#
# Keys are READ FROM THE RUNNING CONTAINERS rather than written down: they are the
# published local-demo keys, and hardcoding them here would trip gitleaks.
#
# Usage:  source qa/visaai-autonomous-e2e/harness/qa-env.sh
#         pnpm --filter web exec next dev -p 3100

set -u

_container() { docker ps --format '{{.Names}}' | grep -x "$1" >/dev/null 2>&1; }

if ! _container supabase_edge_runtime_VisaAI; then
  echo "qa-env: local Supabase stack is not running — start it with 'npx supabase@latest start'" >&2
  return 1 2>/dev/null || exit 1
fi

# container, VAR_NAME… — first name that yields a value wins. Several names are
# tried because the CLI renamed them: the edge runtime exposed SERVICE_ROLE_KEY
# in older images and SUPABASE_SERVICE_ROLE_KEY in current ones, and matching
# only the short name silently returned EMPTY (the API then refused to boot with
# "SUPABASE_SERVICE_ROLE_KEY: expected string to have >=1 characters").
_read_key() { # container, VAR_NAME...
  local container="$1"; shift
  local name value
  for name in "$@"; do
    value="$(docker exec "$container" env 2>/dev/null | grep -oE "(^|[^A-Za-z0-9_])$name=[A-Za-z0-9._-]+" | head -1 | sed "s/.*$name=//")"
    if [ -n "$value" ]; then echo "$value"; return 0; fi
  done
  echo ""
}

export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_API_URL=http://127.0.0.1:4100
export NEXT_PUBLIC_SITE_URL=http://localhost:3100
export WEB_URL=http://localhost:3100
export PORT=4100

NEXT_PUBLIC_SUPABASE_ANON_KEY="$(_read_key supabase_edge_runtime_VisaAI SUPABASE_ANON_KEY ANON_KEY)"
SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY"
SUPABASE_SERVICE_ROLE_KEY="$(_read_key supabase_edge_runtime_VisaAI SUPABASE_SERVICE_ROLE_KEY SERVICE_ROLE_KEY)"
SUPABASE_JWT_SECRET="$(_read_key supabase_auth_VisaAI GOTRUE_JWT_SECRET)"
export NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY SUPABASE_JWT_SECRET

if [ -z "$NEXT_PUBLIC_SUPABASE_ANON_KEY" ] || [ -z "$SUPABASE_JWT_SECRET" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "qa-env: could not read local Supabase keys from the containers" >&2
  return 1 2>/dev/null || exit 1
fi

echo "qa-env: web -> :3100, api -> :4100, supabase -> 127.0.0.1:54321 (local stack)"
