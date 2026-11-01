# Quality scorecard

Scored on evidence gathered in this run, not on optimism. Where a category was
not exercised, it says so and is scored low for lack of evidence rather than
assumed good.

| Category | Score | Basis |
|---|---:|---|
| Functional correctness | 72 | 2790 API + 305 web tests pass, 0 skipped. But tests are unit/integration-heavy; few exercise a real applicant end-to-end. |
| Applicant UX | 62 | Documents page restructured and shipped; the rest of the journey unreviewed this run. |
| User-effort reduction | 70 | Four concrete duplications removed (PI-1..PI-4). The largest remaining — profile carry-forward, document reuse — are documented, not built. |
| Consultant workflow | 55 | Two P0 authorization holes found here. Fixed, but the workflow itself was never exercised end-to-end. |
| Admin workflow | 50 | Audited for authorization only. Not exercised at all. |
| Visa-rule reliability | 55 | Not examined this run. Prior audits recorded country/registry parity tests, which pass. |
| AI reliability | 68 | Injection defence now at all 7 prompt sites with a regression guard; fabrication controls verified in extraction. Live-model behaviour unverified (BLK-3). |
| Security | 74 | Three P0s and one P2 closed with tests. 60+ controllers audited and found correctly scoped. Not a pen-test; no dependency-CVE sweep. |
| Privacy | 70 | Data-residency gate holds; OCR text no longer leaves region; document bytes no longer need a public URL. PII-in-logs not systematically reviewed. |
| Performance | 45 | Not measured. One perf test was found to be a flaky wall-clock proxy and replaced. No before/after benchmarks taken. |
| Accessibility | 45 | Only the components touched this run (progress, gate) were built with reduced-motion and non-visual progress. No audit. |
| Mobile UX | 35 | Not exercised this run. |
| Database integrity | 68 | 106 migrations apply cleanly to a fresh local stack; schema-hygiene guards now actually run in CI. Orphaned storage metadata found and reconciled earlier today. |
| Test coverage | 70 | 391 suites, 2790 tests, 0 skipped with a DB. 43 tenant-isolation tests confirmed genuinely executing. Applicant E2E remains thin. |
| Observability | 60 | Structured logging and request ids exist; failures are surfaced not swallowed. A leaked test handle is unexplained. |
| Maintainability | 72 | Lint 853 → 848 (ratchet respected). Duplicated completion rule collapsed to one definition. Comments explain why, not what. |
| Production readiness | 58 | Three cross-tenant P0s were live until today — that is the honest ceiling. Now fixed and tested, but unverified against production data (BLK-2). |

## Where the numbers are weakest, and why

**Mobile (35) and performance (45)** are low because they were not tested, not
because they are known bad. Scoring them higher would be invention.

**Production readiness (58)** reflects that three P0 cross-tenant authorization
gaps existed in deployed code this morning. Two of them let any authenticated
user read another applicant's consultant assignment and decision history; one
let any user revoke another organization's live API tokens. They are fixed and
covered by tests, but a codebase that shipped them warrants caution.

**Consultant (55) and admin (50)** were audited for authorization and nothing
else. No consultant or admin workflow was driven end-to-end in this run.

## What would move these most

1. An applicant E2E suite against a seeded local stack (functional, UX, coverage).
2. Driving consultant and admin workflows once each (two categories at 50-55).
3. A measured performance pass with before/after numbers (currently unscored guesswork).
