# VisaAI — autonomous improvement run

**Started** `16fedfd` · **Ended** see git log below · branch `main`, working tree clean.

---

## Executive summary

Three **P0 cross-tenant authorization holes** were found in deployed code and
closed with tests. Any authenticated user could read another applicant's
consultant assignment and per-field decision history, open and complete another
applicant's pre-submission review, and revoke another organization's live
production API tokens.

A prompt-injection defence that existed in the codebase turned out to be applied
to **one of seven** prompt sites; it is now at all seven, with a guard that fails
when a new site appears without it.

On the product side, the run removed four concrete sources of duplicated
applicant work — chiefly that facts extracted from uploaded documents never
reached the profile the intake chat reads, so the chat kept asking for answers
already in the database.

**Not claimed:** no end-to-end applicant, consultant or admin journey was driven;
no mobile or performance testing was done; the new autofill paths are unit-tested
but unverified against production data.

## Baseline

`main` @ `16fedfd`, clean tree. API: 2675 tests passing, **43 skipped**, tsc
clean, lint 853 problems. Web: 305 tests, tsc clean, lint 74, build OK.
Full detail in `docs/overnight/BASELINE.md`.

## Features implemented

| | |
|---|---|
| PI-1 | Document facts fold into the applicant profile (`sync_profile` node) |
| PI-2 | Account name/nationality/phone/address reach the prefilled form |
| PI-3 | Every uploaded document reaches the form generator (was: only the first) |
| PI-4 | Non-identity documents extract at all (Azure type-aware routing) |
| PI-5 | Documents page leads with the applicant's task, gates official docs |

Detail and limits: `docs/overnight/PRODUCT_IMPROVEMENTS.md`.

## Bugs found and fixed

| ID | Sev | Area | Status |
|---|---|---|---|
| OVN-003 | **P0** | Preflight: no ownership check, review not bound to application, audit role hardcoded | FIXED |
| OVN-004 | **P0** | Three unguarded consultant read routes | FIXED |
| OVN-005 | **P0** | Partner suspend skipped org ownership | FIXED |
| OVN-006 | P1 | Injection defence applied to 1 of 7 prompt sites | FIXED |
| OVN-001 | P2 | A DB-gated security suite ran nowhere at all | FIXED |
| OVN-002 | P2 | Cross-org invitation revocation | FIXED |
| OVN-007 | P3 | Account details never reached the form | IMPROVED |
| OVN-008 | P3 | Document facts never reached the profile | IMPROVED |
| OVN-009 | P4 | Two flaky tests | 1 FIXED / 1 NOT REPRODUCIBLE |

Evidence, reproduction and validation for each: `docs/overnight/EVIDENCE_LEDGER.md`.

## Security findings

Three P0s, one P2 — all fixed with regression tests. ~60 further controllers were
audited and found correctly scoped, either through RLS via `forUser` or an
explicit ownership check; that is recorded rather than assumed.

The common shape of all three P0s: a route keyed on a path parameter whose
service reads or writes through the **service-role client, which bypasses RLS**.
`JwtGuard` proves a caller is logged in and nothing about their relationship to
the resource. Worth treating that combination as a review checklist item.

**Remaining risk:** no dependency-CVE sweep, no pen-test, PII-in-logs not
systematically reviewed.

## User-effort improvements

Measured in fields the applicant no longer re-types:

- up to **9** contact/identity fields per prefilled form (PI-2)
- up to **6** per passport, **3-5** per employment or admission document (PI-1)
- **all documents after the first** now contribute at all (PI-3)
- non-identity documents extract at all in production (PI-4)

## Testing performed

| Suite | Result |
|---|---|
| API | **2790 passed / 391 suites / 0 skipped** (with a local Supabase) |
| Web | **305 passed / 63 files** |
| API typecheck / build | clean / OK |
| Web typecheck / build | clean / OK |
| API lint | 848 problems (from 853 — ratchet respected) |
| Web lint | 74 (unchanged) |

Tests added this run: 8 injection-helper, 9 injection-coverage, 8 guard, 16
route-guard, 5 IDOR-binding, 1 audit-role, 20 profile-merge, 3 account-field,
1 cross-org partner, 1 invitation-scoping.

**Applicant / consultant / admin journeys: 0 driven end-to-end.** Authorization
for all three roles was audited statically and, for the fixed routes, tested.

**Country/visa coverage: not exercised this run.** No matrix was produced;
`docs/testing/COUNTRY_VISA_COVERAGE_MATRIX.md` was deliberately not written
rather than filled with untested rows.

## AI testing

Structural, not behavioural. Fencing verified against escape attempts; directive
present at all 7 sites; a coverage guard prevents silent regression; extraction
output is hard-filtered to a per-document-type schema so an invented key cannot
reach a government form. Live-model adversarial behaviour is **not** verified
(BLK-3).

One real fabrication was caught and fixed earlier the same day: asked for
`nationality` on a bank statement, the extractor answered "CANADA", inferred
from the bank's name. The fix was to stop asking documents what they cannot
know.

## Performance

Not measured. One perf test was found to be a load-sensitive wall-clock proxy
and replaced with a deterministic concurrency assertion. No before/after
benchmarks were taken, so no performance claim is made.

## Remaining issues

- Applicant/consultant/admin E2E coverage is thin.
- Mobile and accessibility unaudited.
- `rls-cross-tenant` flake unexplained (BLK-4), not affecting CI.
- A leaked test handle causes a jest teardown warning.
- Profile carry-forward and document reuse across applications remain the two
  largest untouched effort reductions (F-1, F-2).

## Blocked items

`docs/overnight/BLOCKED_ITEMS.md` — real-site automation (by instruction),
production-data verification, live-model adversarial testing, one flake.

## Real browser automation

`docs/testing/MORNING_REAL_BROWSER_AUTOMATION.md`. Nothing was executed against
any external site. It separates what is safe to run unattended from what needs
your review, and names what was deliberately not prepared.

## Git state

Branch `main`, clean tree, 9 commits, nothing pushed — deploy is a separate
explicit step in this project.

## Recommended next 10 actions

1. Review and deploy the three P0 authorization fixes — they are live holes today.
2. Verify those fixes against production with two accounts you control.
3. Drive one applicant journey end-to-end and turn it into a Playwright spec.
4. Same for one consultant and one admin journey (weakest scorecard categories).
5. Exercise the new autofill paths with a real multi-document application (BLK-2).
6. Decide F-1 (profile carry-forward) — the largest remaining effort reduction.
7. Decide F-2 (document reuse across applications).
8. Run a dependency vulnerability sweep — not done here.
9. Take a measured performance baseline so the 45 score becomes real.
10. Chase the leaked test handle and the `rls-cross-tenant` flake.
