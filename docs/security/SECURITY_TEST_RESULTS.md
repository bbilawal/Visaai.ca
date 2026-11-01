# VisaAI — Security Test Results

Master Security Audit, 2026-08-16. All commands run in this engagement.

## Baseline vs. final

| | Baseline (`13815351`) | Final |
|---|---|---|
| API jest suites | 378 passed / 13 skipped | **379 passed / 13 skipped** |
| API jest tests | 2749 passed / 43 skipped | **2763 passed / 43 skipped** |
| New security regression tests | — | **+14** (jest) + 8 SQL assertions |
| Web build (`next build`) | — | **PASS** |
| nginx `-t` | — | **PASS** |
| `supabase db reset` (all migrations, from scratch) | — | **PASS** |

No failures; no tests skipped/deleted/weakened to pass.

## DAST — live exploit → fix → retest (local copy of prod schema)

Reproduced as working exploits, fixed, and re-run. `supabase/tests/security/
rls_column_hardening_test.sql` (8 assertions), all PASS on a from-scratch reset:

```
PASS SEC-4090 consultant cannot self-approve kyc/payouts/acct
PASS SEC-4091 participant cannot rewrite identity/meeting_url
PASS SEC-4091 participant CAN reschedule with a valid provider url   (legit flow preserved)
PASS SEC-9002 applicant cannot fabricate a paid prefill payment
PASS SEC-4094 applicant cannot self-upgrade plan_tier
PASS SEC-4093 applicant CAN write own non-system column (no recursion) (legit flow preserved)
PASS SEC-4092 anon cannot read pricing_quotes
PASS SEC-4003 anon cannot call claim_outbox_batch
```

RPC lockdown verified: `claim_outbox_batch`, `consume_review_credit`,
`field_provenance_create_version`, `bump_delivery_attempt`, `audit_append`,
`redeem_coupon` → `permission denied` for anon/authenticated; `service_role` only.

## New automated regression tests (jest)

| Test file | Guards |
|---|---|
| `test/security-record-login-auth.spec.ts` | SEC-1002 (4 tests) |
| `messaging-p2-attachment-service.spec.ts` (+3) | SEC-3050 cross-tenant / traversal |
| `privacy.service.spec.ts` (+1) | SEC-12003 deep-path erasure |
| `billing.service.characterization.spec.ts` (+1) | billing open-redirect origin check |
| `discovery.service.spec.ts` (+1) | SEC-2001 review app ownership |
| `shared/ai/prompt-injection-coverage.spec.ts` (extended) | SEC-6005 fence coverage |
| `supabase/tests/security/rls_column_hardening_test.sql` | SEC-4090/91/92/93/94/9002/4003 |

## Tenant-isolation suites (against a real Supabase)

RLS cross-tenant + messaging RLS + schema-hygiene suites run **not skipped**
against the reset stack: 12/12 sampled PASS. CI job `agent-tests.yml` runs the
full set and asserts no suite silently skips, and now also runs the SQL security
regression.

## SAST / SCA

- `scripts/check-vulnerable-deps.mjs` (reachability gate): **green** (0 flagged
  packages reachable from `apps/api`/`apps/web`).
- `pnpm audit` / osv-scanner: HIGH advisories confined to dev tooling + unshipped
  `apps/mobile`; non-reachable (see `SECURITY_REMAINING_RISKS.md`).
- Secret scan (working tree): 0 tracked secrets; git-history exposures documented
  for rotation.

## Manual/adversarial review
Second-pass review of the fixes (trigger role checks unforgeable; meeting_url
regex rejects look-alike hosts; attachment prefix server-derived; lockout keying
prevents victim-DoS; CSP/extension allowlists sound). No new open CRITICAL/HIGH.
