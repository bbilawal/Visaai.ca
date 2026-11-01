# Test strategy

## Suites and counts

Measured 2026-08-21 on branch `master-exec/visaai-2026-08-20`.

| Suite | Command | Result |
|---|---|---|
| API unit + integration | `pnpm --filter api exec jest` | **2,916 passed, 43 skipped, 0 failed** (386 suites) |
| Web unit + component | `pnpm --filter web exec vitest run` | **352 passed** (66 files) |
| DB RLS regression (SQL) | `psql < supabase/tests/security/*.sql` | passes |
| E2E (Playwright) | `pnpm --filter web exec playwright test` | see `E2E_RESULTS.md` |

The 43 skips are the live-Supabase suites, gated on `SUPABASE_*` env vars. CI
asserts they actually ran — a skip must not pass as green — in
`.github/workflows/agent-tests.yml`.

## Added on this branch

| Area | File | Tests |
|---|---|---|
| Requirement rules engine | `visa-rules/rule-evaluator.spec.ts` | 29 |
| Model policy + pricing + registry | `shared/ai/model-policy.spec.ts` | 25 |
| Cache-aware metering | `shared/ai/metering-callback.spec.ts` | +6 |
| AI eval harness | `shared/ai/evals/eval-harness.spec.ts` | 18 |
| Source normalization + change class | `visa-sync/normalize.spec.ts` | 23 |
| SSRF egress guards | `visa-sync/source-fetcher.spec.ts` | 19 |
| robots.txt (RFC 9309) | `visa-sync/robots.spec.ts` | 18 |
| Sync orchestration | `visa-sync/visa-sync.service.spec.ts` | 11 |
| Locale canonicals | `web/lib/seo/alternates.test.ts` | 9 |
| Plan price consistency | `web/lib/plan-error.test.ts` | 9 |
| User-facing claims | `web/messages/claims.test.ts` | 31 |
| Visa registry RLS | `supabase/tests/security/visa_registry_rls_test.sql` | 4 role scenarios |

## Principles applied

**A test asserts the property, not the literal.** `visa-agents.spec.ts` used to
assert `model === 'gpt-4o-mini'`. It now asserts that the estimator routes below
the evaluator — the property that matters — so it survives any model change.

**A regression test must be shown to catch its bug.** The visa registry RLS test
was verified by re-creating the original policy and confirming the test fails
with the exploit spelled out. A regression test never seen to fail is a
hypothesis.

**Three-valued logic where a missing answer is not a "no".** The rules engine
returns `unknown` for an unsupplied fact, and tests assert Kleene semantics
directly. Collapsing it to `false` would drop requirements off a checklist and
tell someone they are ready when they are not.

**Coverage guards must see every calling convention.** The prompt-injection
guard matched only the LangChain shape, so three sites using
`AiService.completeJSON` were invisible — and all three were unfenced. It now
matches both and asserts each set is non-empty.

**No valid test was weakened or deleted.** One test changed its assertion
because the contract changed (`extractTokens` gained cache fields); it kept its
intent and gained cases.

## Data-driven coverage

`scripts/visa-registry/coverage-matrix.mjs` generates the country × visa matrix
from the database. A hand-written matrix is a claim; a generated one is a
measurement. It immediately found a real bug — five visa types reported as
having no official source, caused by a global unique index on `source_url`.

## Gaps

- **AI eval suites are not run against a live model.** Harness built and tested;
  no fixtures, no funded key. See `AI_EVALS.md`.
- **Profile equivalence classes are defined but not exercised end to end.** See
  `PROFILE_COVERAGE.md`.
- **No load test on this branch.** See `docs/performance/PERFORMANCE_REPORT.md`.
- **`visa-sync` has no live integration test** against a real government host.
  Deliberate — the suite must never hit a government site.
