# NEXT ACTION — Definition of Done met

_Updated 2026-08-12 (later session) · run `visaai-e2e-20260812` · git `9ae7a99` + uncommitted fixes_

## Status: all gates green

| Gate | Result |
|---|---|
| Country × visa matrix | **71/71 cells, 33/33 countries** |
| Real-life scenarios | **1,015 / 1,000**, 100% pass |
| Journey stages 1-6 | **all COVERED** — intake by 1,086 guest scenarios, stages 2-6 by 32 authenticated runs (160/160 stage checks) |
| Defects | 0 P0 · 2 P1 fixed · 4 P2 fixed · 1 P3 closed as intentional · **0 open, 0 escalated** |
| api jest | exit 0 — 353 suites, 2,460 passed, 43 skipped |
| web vitest | exit 0 — 60 files, 283 passed |
| api / web typecheck | exit 0 |
| api / web production build | exit 0 (web: 611 static pages) |

`reports/final-summary.json` now **derives** `definition_of_done_met` from the
ledgers plus `state/regression-gates.json` rather than hardcoding `false`, and
records which gates were **not** run (`formatter`, `lint`) so the claim stays
auditable.

> ⚠️ Everything below `qa/` plus the source fixes are **uncommitted**. `main` is
> level with `origin/main` at `9ae7a99`.

## Closed since the previous NEXT_ACTION

Both items that file listed as needing a human are done:

1. **BUG-002** — fixed via the safe client-side option (b). New
   `isGuestSession()` predicate; the three offending call sites now gate on a
   *permanent* session rather than "a session exists". The fail-closed
   `JwtGuard` was **not** widened. Verified live: 0 requests to all three routes
   and 0×403 over a 20 s guest dwell (`evidence/BUG-002-verify.json`).
2. **Stages 2-6 coverage** — was already delivered by `run-stages.mjs` after
   that file was written; the 0% claim was stale.

Also fixed this session: **FINDING-PRICING-001** (pricing page now computes the
catalog on demand when `pricing_quotes` is empty — verified with the table at 0
rows), **BUG-004** (the api suite failed on a *different* test every run —
jest's 5 s default was too tight for real-work suites under parallelism), and
**BUG-005** (the defensive secret scan flagged the secret scanner's own
allowlist, so a security gate had been permanently red).

## What a human still owns

1. **Commit and push.** Nothing here is committed. Suggested split: the api
   pricing fix, the web guest-fetch fix, the two test-infrastructure fixes, and
   the `qa/` harness. Note `qa/` is **193 MB** (screenshot evidence) — the
   previous session deliberately left it untracked; keep doing that unless you
   want the evidence in history.
2. **`apps/api/src/modules/payouts/connect.service.ts` is modified and is NOT
   part of this QA work** — it is in-flight Stripe Connect work. Left untouched.
3. **`lint` and `formatter` gates were never run** for this program.
4. **P3 / CLASSIFIED-003** stays open by decision (an intentional React pattern),
   not by oversight.

## Environment (nothing here survives a reboot)

The local stack config lived only in the shell that launched the servers, which
made it easy to lose. It is now scripted:

```bash
source qa/visaai-autonomous-e2e/harness/qa-env.sh   # web:3100, api:4100, supabase:54321
cd apps/web && npx next dev -p 3100
```

`apps/web/.env.local` and `apps/api/.env` both point at the **remote** Supabase
project. Restarting a dev server without `qa-env.sh` silently reverts web to
that project while the api stays local — guest JWTs are then signed by one
issuer and validated by another, and every application create returns **401**
with no clue why. (`apps/web/.env.local` currently has `NEXT_PUBLIC_API_URL`
pointed at `:4100` for the harness; original saved at `.env.local.bak.qa`.)

Run at **workers 2-3**: the host reaped three runs at higher concurrency, and
the local PostgREST container saturates under sustained load (restart it with
`docker restart supabase_rest_VisaAI` if 5xx appear on
`/rest/v1/checklist_items`).

## Re-running

```bash
# deep-profile scenario pass (3 turns does not reach DOB/passport/marital/dependants)
node qa/visaai-autonomous-e2e/harness/run-scenarios.mjs --mode scenarios --turns 8 --workers 2

# authenticated stages 2-6
node qa/visaai-autonomous-e2e/harness/run-stages.mjs --limit 5

# BUG-002 guard (exits non-zero if the guest 403s ever come back)
node qa/visaai-autonomous-e2e/harness/verify-bug-002.mjs

# refresh every report from the ledgers
node qa/visaai-autonomous-e2e/harness/build-reports.mjs
node qa/visaai-autonomous-e2e/harness/build-coverage.mjs
```
