#!/usr/bin/env bash
# QA API environment for the prefill matrix run.
#
# Builds on qa-env.sh (local Supabase stack keys, api -> :4100) and then
# NEUTRALISES every third party the .env file would otherwise point at the real
# account: Upstash, Redis, Stripe and SMTP all get local/dummy values so a QA
# run can never pull a job off the production queue, talk to live Stripe, or
# email a real person. OPENAI_API_KEY is deliberately left to apps/api/.env —
# the prefill graph is the thing under test.
#
# Usage:  source qa/prefill-matrix/api-env.sh
#         node apps/api/dist/main.js
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck source=/dev/null
source "$HERE/../visaai-autonomous-e2e/harness/qa-env.sh" || return 1

export NODE_ENV=development
export DATA_RESIDENCY_MODE=global
export OCR_PROVIDER=mock

# :4100 is qa-env.sh's port and may already be held by an earlier QA session —
# the matrix gets its own so a stale server can never answer for it.
export PORT=4200
export NEXT_PUBLIC_API_URL=http://127.0.0.1:4200

# Nothing may reach the real queue/cache.
export REDIS_URL=redis://127.0.0.1:6399
export UPSTASH_REDIS_REST_URL=http://127.0.0.1:9
export UPSTASH_REDIS_REST_TOKEN=qa-dummy-token

# Nothing may reach real Stripe.
export STRIPE_SECRET_KEY=sk_test_qa_dummy
export STRIPE_WEBHOOK_SECRET=whsec_qa_dummy
export STRIPE_CONNECT_WEBHOOK_SECRET=whsec_qa_dummy
export SUBSCRIPTIONS_ENABLED=false

# Mail goes to the local stack's inbucket, never to a real inbox.
export SMTP_HOST=127.0.0.1
export SMTP_PORT=54325
export SMTP_USER=qa
export SMTP_PASS=qa
export SMTP_FROM=qa@example.invalid

# The e2e suite drives everything from one address; the default 60/min limit
# would turn a rate limit into a fake product bug.
export THROTTLE_LIMIT=100000
export THROTTLE_TTL_MS=60000

echo "prefill-matrix: api env ready (NODE_ENV=$NODE_ENV, port $PORT, stripe/redis/smtp neutralised)"
