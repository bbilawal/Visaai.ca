# Overnight run — evidence ledger

Every meaningful finding, with what was actually verified rather than what looked
plausible. Statuses: FIXED / VERIFIED / IMPROVED / BLOCKED / DEFERRED / NOT REPRODUCIBLE.

---

## OVN-001 — a DB-gated security suite ran nowhere at all

| | |
|---|---|
| Severity | P2 (coverage gap; no live vulnerability) |
| Area | CI / database schema hygiene |
| Role | n/a (build infrastructure) |
| Status | **FIXED** |

**Reproduction.** `pnpm --filter api exec jest` reports `2675 passed, 43 skipped`.
The 43 are 13 suites gated on `describeIf = CONFIGURED ? describe : describe.skip`.
Comparing that set against the suite list in the CI tenant-isolation job:

```
grep -ln 'describeIf\|CONFIGURED' apps/api/test/*.spec.ts   # 13 suites
# CI job listed 12 — schema-hygiene-db was absent
```

**Root cause.** `.github/workflows/agent-tests.yml` has a well-designed job that
starts a local Supabase and fails the build if any tenant-isolation suite skips.
`schema-hygiene-db.spec.ts` gates the same way but was never added to that job's
argument list, so it skipped locally (no credentials) and was never invoked in CI
— it ran nowhere. Its own docstring claimed the CI job kept it honest.

It guards two production invariants: DB-003 (revoke DML grants that no RLS policy
can exercise) and PERF-007 (no redundant indexes).

**Change made.** Added `schema-hygiene-db` to the job's suite list; raised the
"did enough tests actually run" threshold from 40 to 43 so adding the suite
cannot be silently undone; added a comment telling the next person how to find
stragglers.

**Files.** `.github/workflows/agent-tests.yml`

**Validation.** Ran the exact corrected command against a local Supabase and
executed the job's own assertion script against the real JSON output:

```
passed=43 skipped=0 suites=13
CI gate PASSES with new threshold 43
```

Threshold is tight: with 43 expected and 43 actual, dropping any suite fails.

**Note on my own first read.** I initially recorded this as "CI never runs the RLS
tests", which was wrong — that job already existed and is correctly built. Only
one suite was missing from it. Corrected in `BASELINE.md`.

---

## OVN-002 — full API suite verified green with a database present

| | |
|---|---|
| Severity | INFO |
| Status | **VERIFIED** |

Started a local Supabase stack and ran the complete API suite with credentials:

```
Test Suites: 386 passed, 386 total
Tests:       2718 passed, 2718 total
```

Zero skips, zero failures — including all 6 cross-tenant isolation tests and the
10 messaging RLS suites. So tenant isolation is genuinely exercised and passing,
not merely assumed.

One non-blocking warning: `A worker process has failed to exit gracefully`. Test
teardown leaks a handle somewhere. Noted, not chased — it does not affect results.

---

## OVN-003 — Preflight module had no ownership check at all

| | |
|---|---|
| Severity | **P0** — cross-tenant read + unauthorized write |
| Area | `apps/api/src/modules/preflight/` |
| Role | any authenticated user |
| Status | **FIXED** |

**Reproduction (static, verified by hand after an agent flagged it).**
`preflight.controller.ts` carried only a class-level `@UseGuards(JwtGuard)`.
Every `PreflightRepository` method runs on `supabase.admin` — the service-role
client, which bypasses RLS — filtered by the path parameter alone:

```
grep -rn "user_id|forUser|verifyOwnership|assertAssigned" src/modules/preflight/
# (no matches)
```

**Impact.** Any authenticated user, given any application UUID, could open a
preflight review, tick all six mandatory pre-submission checks, and complete it.
Completion mints `locked_diff_hash`, which the module's own comments call the
execution trust anchor for portal auto-submission. Execution wiring is frozen
today, which bounds present blast radius to cross-tenant reads and audit
corruption — but it is the value the submission path is designed to trust.

**Second defect, same module.** `:reviewId` was never bound to `:applicationId`.
A guard alone does not close this: a caller who legitimately owns application A
could pass their own id with a review id from application B, and the repository,
keyed on the review id, would act on the victim's review.

**Third.** The reviewer's role was hardcoded to `'consultant'`, so an applicant
opening their own preflight was recorded in the audit trail — the one record of
who checked the application — as a consultant review.

**Changes.** `ApplicationAccessGuard` on the controller; `assertReviewBelongsTo`
in the service (returning the same "not found" for a foreign review as a missing
one, so the error cannot confirm a guessed id); reviewer role derived from
`AuthUser.appRole`.

**Validation.** 5 binding tests, 1 audit-role test, plus the guard's own 8.
`applicationId` was made a REQUIRED argument so the compiler found all callers —
three internal ones, all of which already had the id in scope.

---

## OVN-004 — three unguarded consultant read routes

| | |
|---|---|
| Severity | **P0** — cross-tenant data access |
| Status | **FIXED** |

`GET assignment`, `GET assignments`, `GET approval` had no method-level guard
while every sibling did; their services also read through the service-role
client keyed on the path parameter. Any authenticated user could read a
stranger's consultant assignment, full reassignment history, and per-field
decision rollup.

Fixed with `ApplicationAccessGuard` (owner OR admin OR **active** assignee) —
deliberately not `OwnerOrAdminGuard`, which is right for assignment *writes* but
would lock the assigned consultant out of reads about their own assignment.

Also added 16 source-level assertions that every application-scoped route on
that controller carries a method-level guard. The failure mode is an ABSENT
decorator, which has no runtime behaviour to test.

---

## OVN-005 — partner application suspend skipped org ownership

| | |
|---|---|
| Severity | **P0** — cross-tenant unauthorized write |
| Status | **FIXED** |

`POST /partner-portal/applications/:id/suspend` parsed
`RevokeKeyDto.pick({ reason: true })`, dropping `organizationId`, and mutated
through the service-role client keyed on the path parameter. Every sibling
(`createKey`, `rotateKey`, `revokeKey`) calls `requireApplicationAsAdmin`.

Exploitable because `partner.manage` is granted to `org_admin` platform-wide,
`PermissionsGuard` resolves a flat organization-agnostic permission union, and
organizations are self-serve with the creator auto-granted `org_admin`. Any user
could create an org, inherit the permission, and suspend an unrelated
organization's partner application — revoking its live production API tokens.

Nothing called the endpoint from our own web client, so requiring the org id
broke no caller.

---

## OVN-006 — prompt-injection defence existed but was applied once

| | |
|---|---|
| Severity | P1 |
| Status | **FIXED** |

`shared/ai/untrusted.ts` (AI-001) implements fencing plus a directive, is well
reasoned, and had **no test of its own**. Of seven prompt sites that send to a
model, exactly one used it.

Unprotected included the two most attacker-controllable paths: `derive-fields`
(raw OCR text of an uploaded PDF) and `generate-fields` (document data that
becomes a government form). Also `intake/ask-question`, `intake/process-answer`,
`vri/generate-recommendations`, `narrative/self-review`.

All six now fence their untrusted interpolations and carry the directive. Added
8 tests for the helper — including that a value trying to close the fence and
issue instructions cannot escape it — and a coverage guard that walks the source
and fails when a new prompt site appears without the defence, so the same gap
cannot reopen silently.

The helper's own test also found a latent bug: `asUntrustedData` threw on a
circular structure, which would have aborted document generation. It now
degrades to a marker.

---

## OVN-007 — account details never reached the prefilled form

| | |
|---|---|
| Severity | P3 (user effort) |
| Status | **IMPROVED** |

All four pipeline modules that read `users` selected `preferred_language` and
nothing else; `user_profiles` (phone + full postal address) was read by no
pipeline module at all — verified independently of the agent that reported it:

```
grep -rn "from('user_profiles')|from('users')" src/modules/{prefill,intake,narrative,vri}
# four hits, every one selecting preferred_language
```

So an applicant typed their name, nationality, phone and address into onboarding
and Settings, and the prefilled government form still came back with Contact and
Address blank — a section `generate-fields` is explicitly instructed to fill.

`load-context` now loads them into a new `accountProfile` context block, fenced
as untrusted like the rest. Best-effort: an RLS refusal or missing column costs
a few pre-filled fields, never the form. Up to 9 fields recovered per form.

---

## OVN-008 — document facts never reached the applicant profile

| | |
|---|---|
| Severity | P3 (user effort — largest single source of duplicate work) |
| Status | **IMPROVED** |

See commit `9736eb3`. Gap-fill only, no currency conversion, safe against the
intake writer because intake seeds from the DB and its reducer merges.

---

## OVN-009 — two flaky tests

| | |
|---|---|
| Severity | P4 |
| Status | **1 FIXED / 1 NOT REPRODUCIBLE** |

Observed while running the full suite repeatedly (8 runs):

**`analytics-perf › summary over 7 keys` — FIXED.** Asserted wall-clock < 200ms
as a proxy for "parallel, not serial". The suite runs across parallel jest
workers, so a genuinely-parallel run can exceed the stopwatch on a loaded host.
Now asserts peak concurrent computes equals the metric count — the actual
property, deterministic, and stricter than what it replaced.

**`rls-cross-tenant › owner (A) can read their own application` — NOT
REPRODUCIBLE.** Failed once in eight full-suite runs. Investigated rather than
patched: the 13 DB suites run 6/6 clean in isolation, and the failure appears
only under full-suite parallelism against one shared local Supabase — resource
contention, not suite logic. My first hypothesis (fixture emails keyed on
`Date.now()` colliding) was checked and **disproved**: each suite uses a distinct
prefix. CI runs these suites in a dedicated job where they execute alone, the
configuration that is stable, so CI correctness is unaffected. Left alone rather
than retried away or loosened.
