# Messaging Load Test

Manual harness for the messaging send + SSE path. Not part of CI — it needs a
running API + live Supabase and produces a report, not a pass/fail.

## Run

Terminal 1 — start the API (or point `LT_API_URL` at another stack):

```bash
pnpm --filter api start:dev   # serves http://localhost:4000
```

Terminal 2 — run the harness with the api env loaded:

```bash
cd apps/api
set -a; . ./.env; set +a            # loads SUPABASE_URL / SERVICE_ROLE_KEY / ANON_KEY
npx ts-node scripts/load-test-messaging.ts
```

Knobs (env):

| Var | Default | Meaning |
|-----|---------|---------|
| `LT_API_URL` | `http://localhost:4000` | API base URL |
| `LT_SUBSCRIBERS` | `12` | SSE connections opened (split across 2 users) |
| `LT_MESSAGES` | `300` | total messages POSTed |
| `LT_CONCURRENCY` | `20` | max POSTs in flight |

Example: `LT_SUBSCRIBERS=20 LT_MESSAGES=1000 LT_CONCURRENCY=50 npx ts-node scripts/load-test-messaging.ts`

## Reading the report

- **POST latency** — p50/p95/p99/max round-trip of `POST /messaging/:id/messages` under load.
- **Throughput** — successful sends per second across the send window.
- **Send errors** — non-2xx sends / total. The harness exits non-zero if this exceeds 5%.
- **Subscribers** — `rejected(429+)` counts connections refused by the per-user SSE cap (8). With `LT_SUBSCRIBERS > 16` (i.e. > 8 per user across 2 users), expect rejections — that is the slice-2 cap working, not a failure.
- **SSE events** — total non-heartbeat events received across subscribers. SSE payloads carry no message id (privacy: Option A), so delivery is aggregate, not per-message correlated.
- **SSE drain lag** — wall time between the last send and the last event observed (informational).

Cleanup (test users, application, conversation) runs automatically in a `finally`.
