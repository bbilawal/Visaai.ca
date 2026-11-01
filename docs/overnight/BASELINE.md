# Overnight run — baseline

Captured 2026-08-16 before any changes in this run.

## Git

| | |
|---|---|
| Branch | `main` |
| HEAD | `16fedfd` feat(documents): lead with the applicant's uploads, gate official docs behind Generate |
| Working tree | clean (no modified or untracked files) |
| Remote | in sync with `origin/main` |

No pre-existing user changes were present, so nothing had to be preserved or worked around.

## Scale

| Metric | Value |
|---|---|
| API modules | 54 |
| API TypeScript | 100,456 LOC |
| Web routes (`page.tsx`) | 58 |
| Web TypeScript/TSX | 29,081 LOC |
| Supabase migrations | 106 |
| API spec files | 246 |
| Web test files | 63 |
| Playwright specs | 11 |

## Gates — as found

| Gate | Result |
|---|---|
| API typecheck | **clean** |
| API tests (no DB) | 2675 passed, **43 skipped**, 373/386 suites |
| API tests (with DB) | **2718 passed, 386/386 suites, 0 skipped** |
| API lint | 853 problems (791 errors, 62 warnings) — pre-existing, tracked by `.lint-baseline.json` ratchet (baseline 1034, so already improving) |
| API build (`nest build`) | OK |
| Web typecheck | **clean** |
| Web tests | 305 passed, 63 files |
| Web lint | 74 problems (61 errors, 13 warnings) — pre-existing |
| Web build (`next build`) | OK |

## Finding at baseline: security tests skip silently

The 43 skipped tests are **not** spread across the suite. They are 13 database-backed
suites, and every one of them tests authorization or tenant isolation:

```
test/rls-cross-tenant.spec.ts
test/messaging-rls.spec.ts            test/messaging-p2-rls.spec.ts
test/messaging-p3a-rls.spec.ts        test/messaging-p3b-rls.spec.ts
test/messaging-p3c-rls.spec.ts        test/messaging-p4-rls.spec.ts
test/messaging-delivered-rls.spec.ts  test/messaging-global-search-rls.spec.ts
test/messaging-pagination-rls.spec.ts test/messaging-perf-rls.spec.ts
test/schema-hygiene-db.spec.ts        test/schengen-registry-db-parity.spec.ts
```

Each uses `const describeIf = CONFIGURED ? describe : describe.skip`, gated on
`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY`. Without those
the suite silently disappears and the run still reports success.

**They all pass when actually run.** A local Supabase stack was started
(`npx supabase@latest start`, 140 public tables, migrations applied) and the full
suite went to 2718/2718 with zero skips.

**Correction to my first read of this.** I initially recorded it as a CI coverage
hole. It is not: `.github/workflows/agent-tests.yml` already has a dedicated job
that starts a local Supabase, runs the RLS suites, and *fails the build if any of
them skipped* — precisely the right design, and already in place. Locally
skipping without credentials is deliberate so `npm test` stays runnable offline.

The real defect is narrower. Of the 13 DB-gated suites, **`schema-hygiene-db` was
missing from that CI job's list** — so it did not run in CI, and it skips locally,
meaning it ran nowhere at all. Its own docstring asserts "CI's tenant-isolation
job supplies them and fails if any suite skips, so this cannot quietly stop
running", which was untrue for that file. It guards DB-003 (revoke DML grants no
RLS policy can exercise) and PERF-007 (redundant indexes).

Tracked as **OVN-001**; fixed in this run.

## Known environment facts

- Production OCR is `azure-di` under `DATA_RESIDENCY_MODE=regional`; `derive_fields`
  (OpenAI) is intentionally gated off there.
- Production storage holds exactly 1 document blob; 5 older rows are orphaned
  metadata from the self-hosted cutover and were marked `failed` earlier today.
- `git push` does not deploy. Deploys are SSH + build + pm2 restart on the VPS.
