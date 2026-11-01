# Morning: real-browser automation — review before running

Nothing in this file was executed. Per the run's boundary, no action was taken
against any government or third-party website: no submissions, uploads,
declarations, payments, appointments, messages, or account changes.

## What already exists

The repo has 11 Playwright specs under `apps/web` and a CI job that runs them
against a local stack. Those are safe and already automated — this document is
only about the parts that touch the real world.

## Safe to run unattended (local / preview only)

```bash
# Local stack, no external side effects
npx supabase@latest start                 # applies all 106 migrations
pnpm --filter web test:unit               # 305 tests
pnpm --filter api exec jest               # 2790 tests, 391 suites
pnpm --filter web test:e2e                # Playwright, local
```

The API suite now requires a database for full coverage. Without it 43
tenant-isolation tests skip silently:

```bash
export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY=<local dev anon key from `supabase start` output>
export SUPABASE_SERVICE_ROLE_KEY=<local dev service key from same output>
pnpm --filter api exec jest
```

Those are the fixed local-development keys Supabase prints on startup, not
secrets. CI supplies the same values.

## Needs your review before it runs — production

### 1. Verify the three authorization fixes against production

These closed P0 cross-tenant holes. Worth confirming on the deployed API with
two real accounts you control:

- `GET /applications/:id/consultant/assignment` — as a user who does NOT own the
  application, expect **403** (previously 200 with another applicant's data).
- `GET /applications/:id/consultant/assignments` — same.
- `GET /applications/:id/consultant/approval` — same.
- `POST /applications/:id/preflight/start` — as a non-owner, expect **403**.
- `POST /applications/:ownId/preflight/reviews/:foreignReviewId/checks` — expect
  **404**, and confirm the foreign review is unchanged.

Read-only apart from the last, which should be refused. Use test accounts.

### 2. The documents-page restructure

Deployed earlier today. The *unlocked* state has never been seen against real
data, because no production application has a fully-satisfied checklist:

- Upload every required document until each shows Verified.
- Confirm the Generate button unlocks only then.
- Press it: prefill should run and the official sections should appear below.
- Reload: the sections should still be visible (the page re-reads the prefill).

### 3. OCR against a real multi-page document

Production OCR succeeded end-to-end for the first time today, on a one-line test
PDF. A real passport and a real bank statement would exercise:

- Azure `prebuilt-idDocument` routing for identity documents
- `prebuilt-layout` + queryFields for everything else (premium add-on — watch
  the Azure bill)
- the new document→profile write-back (`sync_profile`)

**Do not** upload a real person's identity documents. Use your own, or synthetic
ones.

## Explicitly NOT prepared, and why

No automation was written against government portals. The Chrome extension's
submission path exists, but writing unattended automation for it would produce
exactly the class of irreversible external action the run was told to avoid.
