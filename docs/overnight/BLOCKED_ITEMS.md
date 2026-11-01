# Blocked items

Work identified during the run that could not be completed safely or at all.

## BLK-1 — real-website browser automation (deferred by instruction)

Not attempted, per the run's explicit boundary. Nothing was executed against any
government or third-party site: no submissions, uploads, declarations, payments,
appointments, messages, or account changes.

See `docs/testing/MORNING_REAL_BROWSER_AUTOMATION.md`.

## BLK-2 — production data verification of the new autofill paths

The account-profile enrichment (OVN-007) and document→profile write-back
(OVN-008) are unit-tested and typechecked, but have not been observed against
real production data.

**Why blocked.** Production currently has exactly one document with a completed
OCR extraction, and its content is a one-line placeholder
(`VisaAI browser upload test - IMM 5257`). No production application has a
fully-satisfied checklist. There is no realistic applicant record to exercise
them against, and creating one would mean writing synthetic data into the
production database — outside this run's safety boundary.

**What is needed.** Either a staging environment with representative data, or a
real applicant completing an upload. The first genuine multi-document
application will exercise both paths.

## BLK-3 — AI behaviour under live models

The prompt-injection hardening (OVN-006) is verified structurally: the fence
neutralises escape attempts, the directive is present at every prompt site, and
a coverage guard prevents regression. What is NOT verified is how a given model
behaves when a document actually contains an injection payload.

**Why blocked.** That requires spending real model budget across several
providers and prompts, and `derive_fields` — the most exposed path — is
deliberately disabled in production by the data-residency gate, so it cannot be
exercised there at all.

**What is needed.** A decision to spend model budget on an adversarial-document
test corpus in a non-production environment.

## BLK-4 — one flaky test, cause not established

`rls-cross-tenant › owner (A) can read their own application` failed once in
eight full-suite runs and could not be reproduced in six isolated runs. See
OVN-009. Not blocking CI, which runs those suites in a dedicated job where they
are stable.
