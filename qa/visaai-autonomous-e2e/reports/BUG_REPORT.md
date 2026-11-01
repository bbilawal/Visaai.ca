# Bug Report

_Generated 2026-08-12T23:20:12.640Z · git `256d3ab`_

| Severity | Found | Fixed | Escalated / open |
|---|---|---|---|
| P0 | 0 | 0 | 0 |
| P1 | 2 | 2 | 0 |
| P2 | 4 | 4 | 0 |
| P3 | 1 | 0 | 1 |

---

## BUG-001 — P1 — FIXED

**Documented local stack cannot start ANY application: supabase/config.toml ships enable_anonymous_sign_ins=false while the public funnel requires anonymous sign-in**

- **Environment:** local (supabase local stack + web:3100 + api:4100)
- **Country / category:** ALL / ALL
- **Scenario:** MTX-001-precheck
- **Steps:** 1. npx supabase start (repo config.toml) 2. boot api + web 3. open /en/applications/new 4. select Canada 5. click Start application
- **Expected:** Application is created and the user lands on /intake/<applicationId>
- **Actual:** Inline error 'Anonymous sign-ins are disabled'; console AuthApiError from signInAnonymously; no application created
- **Root cause:** apps/web/lib/supabase/client.ts ensureSession() calls auth.signInAnonymously() for the login-free public funnel, but supabase/config.toml sets enable_anonymous_sign_ins=false, so the repo's own documented local stack contradicts the product's primary entry point.
- **Evidence:** console: `signInAnonymously failed: AuthApiError: Anonymous sign-ins are disabled` · screenshot: `qa/visaai-autonomous-e2e/screenshots/BUG-001-anon-signin-disabled.png`
- **Fix FIX-001:** enable_anonymous_sign_ins = false -> true, with a comment explaining the public funnel depends on it and that guest uids remain subject to RLS
- **Files changed:** `supabase/config.toml`
- **Why this is not a security weakening:** Anonymous sign-in is a designed product capability (ensureSession/signInAnonymously powers the login-free funnel) and is already how production behaves; this only realigns the LOCAL dev stack config with the product. RLS policies are unchanged and still key off auth.uid(); the anonymous_users rate limit (30/hr/IP) is untouched.
- **Retest:** PASS — /en/applications/new + Canada + Start application now creates application 8646dfda-ecd0-4805-a50a-391c41505b21 and lands on /intake/<id> with the AI interview asking a Canada-specific first question
- **Regression:** pending

## BUG-002 — P2 — FIXED

**Public funnel fires three requests per page load that are guaranteed 403 for the guest identity it just created (/progress/:applicationId, /notifications/unread-count, /messaging/stream — the last of which retry-loops)**

- **Environment:** local (web:3100 / api:4100 / supabase local)
- **Country / category:** ALL / ALL
- **Scenario:** MTX-001..003
- **Steps:** 1. Start an application from /applications/new as a guest (anonymous session) 2. Land on /intake/<id> 3. Observe network + console
- **Expected:** The login-free funnel should not issue requests the guard is designed to reject; console stays clean for the primary journey
- **Actual:** 3x 403 per load: GET /progress/<applicationId>, GET /notifications/unread-count, GET /messaging/stream. Page still renders and the interview works.
- **Root cause:** JwtGuard is intentionally fail-closed for anonymous identities: a route is reachable by a guest only if it carries @AllowAnonymous (apps/api/src/modules/auth/jwt.guard.ts). ProgressController, notifications and messaging carry only @UseGuards(JwtGuard), so the guest session minted by the public funnel is rejected. The web client requests them unconditionally.
- **Impact:** Console/network noise on every public-funnel page load; wasted round trips; masks real errors during triage. No functional break observed — the stage bar and interview render regardless.
- **Remediation decision:** RESOLVED via option (b), the client-side fix the escalation identified as safe. Option (a) — adding @AllowAnonymous to /progress/:applicationId — stays rejected: it widens authorization on a deliberately fail-closed guard. No guard, route, RLS policy or server file was touched; the client now gates on a PERMANENT session (new isGuestSession predicate) instead of merely "a session exists", so it stops issuing requests whose rejection was already guaranteed. See FIX-003.
- **Evidence:** network: `qa/visaai-autonomous-e2e/network/MTX-001.json` · console: `qa/visaai-autonomous-e2e/console/MTX-001.log` · screenshot: `qa/visaai-autonomous-e2e/screenshots/MTX-001.png` · fix_verification: `qa/visaai-autonomous-e2e/evidence/BUG-002-verify.json (0 requests to all three routes, 0x403, 0 console errors over a 20 s guest dwell)` · fix_screenshot: `qa/visaai-autonomous-e2e/screenshots/BUG-002-verify.png`
- **Fix FIX-003:** Applied remediation (b), the client-side option the escalation identified as safe: new isGuestSession(session) predicate in lib/supabase/client.ts, and the three offending call sites now gate on a PERMANENT session instead of merely 'a session exists'. openSseStream returns before connecting (so the 403 can no longer feed its reconnect backoff), StageProgress skips GET /progress/:id, and NotificationBell skips both the 30 s unread poll and the panel fetch.
- **Files changed:** `apps/web/lib/supabase/client.ts`, `apps/web/lib/sse-stream.ts`, `apps/web/components/layout/stage-progress.tsx`, `apps/web/components/notifications/notification-bell.tsx`, `apps/web/lib/sse-stream.test.ts`, `apps/web/components/notifications/notification-bell.test.tsx`, `qa/visaai-autonomous-e2e/harness/verify-bug-002.mjs`
- **Why this is not a security weakening:** Nothing was granted. An authorization decision was neither moved nor relaxed — the client simply stops asking a question it already knows the answer to.
- **Retest:** PASS — qa/visaai-autonomous-e2e/harness/verify-bug-002.mjs drove the real public funnel as a guest (Canada -> /intake/4a237d0f-3cf1-4faf-aacf-b272c0c7e918) and dwelled 20 s: progress 0 requests, notifications/unread-count 0 requests, messaging/stream 0 requests, total 403s 0, console errors 0. Previously 3 offenders per load with the SSE one retry-looping.
- **Regression:** PASS — apps/web tsc --noEmit exit 0.

## CLASSIFIED-001 — NOT_A_DEFECT — CLOSED_TEST_ARTIFACT

**429 Too Many Requests on POST /analytics/collect**

- **Country / category:** — / —
- **Scenario:** —
- **Evidence:** `qa/visaai-autonomous-e2e/network/*.json`

## BUG-003 — P1 — FIXED

**A single transient failure of GET /countries permanently bricks the destination picker — the sole entry point to the entire product — with no retry path**

- **Environment:** local (web:3100 / api:4100)
- **Country / category:** ALL / ALL
- **Scenario:** SC-0004, SC-0005, SC-0006, SC-0008 (4 independent reproductions)
- **Steps:** 1. Open /applications/new 2. Let GET /countries fail once (transient network blip, API restart, brief 5xx, slow cold start) 3. Observe the destination combobox
- **Expected:** A transient fetch failure self-heals, or the user is given a way to retry without losing the page
- **Actual:** The combobox input renders permanently disabled. apps/web/components/ui/country-combobox.tsx:122 computes isDisabled = disabled || loading || !!error, and useSupportedCountries fetches exactly once on mount with no retry and no refetch. The user sees an error message, cannot type, cannot select, and cannot start an application. The only recovery is a manual full page reload.
- **Root cause:** apps/web/lib/use-supported-countries.ts runs a single fetch in a mount-effect and exposes no way to retry. Combined with the combobox disabling itself whenever `error` is truthy, one failed GET is a terminal state for the whole funnel.
- **Impact:** This is the ONLY entry point to VisaAI. Every user journey begins here. A blip that would normally cost a user one retry instead ends the session.
- **Evidence:** ledger: `state/scenario-ledger.jsonl SC-0004/0005/0006/0008` · dom: `<input disabled ... id="country">`
- **Fix FIX-002:** useSupportedCountries now retries a failed GET /countries with bounded backoff (500/1500/3500 ms) before surfacing any error, and exposes retry() so the UI has an escape hatch after retries are exhausted. Pending timers are cleared on unmount so a queued retry cannot fire against a dead component.
- **Files changed:** `apps/web/lib/use-supported-countries.ts`, `apps/web/lib/use-supported-countries.test.ts`
- **Retest:** PASS — 5/5 new tests green
- **Regression:** PASS — apps/web typecheck clean (tsc --noEmit exit 0); FULL web unit suite 278 tests / 59 files all passing (superset of the earlier lib-only run).

## CLASSIFIED-002 — NOT_A_DEFECT — CLOSED_INFRASTRUCTURE

**503 from local PostgREST on GET /rest/v1/checklist_items (3 scenarios: SC-0101, SC-0465, SC-0651)**

- **Country / category:** — / —
- **Scenario:** —
- **Evidence:** `docker logs supabase_rest_VisaAI; pg_indexes for checklist_items; qa/visaai-autonomous-e2e/network/SC-0101.json`

## CLASSIFIED-003 — P3 — CLOSED_INTENTIONAL_PATTERN

**React console warning: 'Encountered a script tag while rendering React component'**

- **Country / category:** — / —
- **Scenario:** —
- **Evidence:** `qa/visaai-autonomous-e2e/console/SC-0665.log; apps/web/app/[locale]/layout.tsx:98-112`

## FINDING-PRICING-001 — P2 — FIXED

**Public pricing page has no fallback path: it renders 'Live pricing is briefly unavailable' whenever the materialized pricing_quotes table is empty**

- **Country / category:** — / —
- **Scenario:** —
- **Steps:** 1. Start the API against a database whose pricing_quotes table is empty 2. Open /en/pricing
- **Expected:** Visitors see plan pricing, or pricing is computed on demand from the inputs that ARE present
- **Actual:** GET /pricing/quotes returns []; the page falls back to 'Live pricing is briefly unavailable. Start your free assessment and we will show your price.' No plan price is shown anywhere on the pricing page.
- **Root cause:** Prices are served exclusively from the materialized public.pricing_quotes table, populated only by the BullMQ PricingRecomputeProcessor. The INPUTS are all present and healthy (pricing_visa_tiers=14, pricing_constants=10, pricing_country_factors=18) — only the derived table is empty, and nothing recomputes it on read.
- **Impact:** The pricing page is a primary conversion surface. Any window where the recompute job has not run, has failed, or the table has been cleared leaves every visitor with no price at all. Verified on a freshly migrated database: inputs seeded, quotes=0, page degraded.
- **Evidence:** endpoint_before: `GET http://127.0.0.1:4100/pricing/quotes -> [] (pricing_quotes = 0 rows)` · endpoint_after: `GET http://127.0.0.1:4100/pricing/quotes -> 140 quotes, 10 visa types x 14 countries, pricing_quotes STILL 0 rows` · page_after: `/pricing renders 14 country tabs and 10 plan prices (149-699 USD); the "Live pricing is briefly unavailable" state no longer shows` · screenshot: `qa/visaai-autonomous-e2e/screenshots/PENDING-payments-pricing.png`
- **Fix FIX-004:** listPublicQuotes() now falls back to computing the sellable catalog on demand when the materialized pricing_quotes table is empty, instead of returning []. The membership rule (skip null-price corridors and lawyer_flag SKUs) was extracted into an exported isSellableCatalogEntry() type guard now used by BOTH the materializer and the fallback, so the two cannot price differently.
- **Files changed:** `apps/api/src/modules/pricing/pricing.service.ts`, `apps/api/src/modules/pricing/pricing-recompute.service.ts`, `apps/api/src/modules/pricing/pricing-quote-catalog-fallback.spec.ts`
- **Why this is not a security weakening:** No internal economics are exposed: the fallback returns the same margin/cogs/band-stripped PublicQuote shape as the cached path, asserted by a dedicated test. The checkout gate is a separate authoritative recompute and is unchanged.
- **Retest:** PASS — verified against the live local stack with pricing_quotes at 0 rows: GET /pricing/quotes returned 140 quotes across 10 visa types / 14 countries, keys limited to country_code/currency/gov_fee_note/price/visa_type; /pricing rendered the real grid (14 country tabs, 10 plan prices 149-699 USD) instead of the 'Live pricing is briefly unavailable' fallback.
- **Regression:** PASS — apps/api tsc --noEmit -p tsconfig.build.json exit 0.

## CLASSIFIED-004 — NOT_A_DEFECT — CLOSED_HARNESS_BUG

**Upload validation initially appeared broken — it was not**

- **Country / category:** — / —
- **Scenario:** —

## BUG-004 — P2 — FIXED

**The api test suite could not pass as a whole: jest's 5 000 ms default timeout is shorter than what several real-work suites need under full-suite parallelism, so a DIFFERENT test failed on each run**

- **Environment:** local (apps/api jest, full suite, 353 suites in parallel)
- **Country / category:** — / —
- **Scenario:** regression-gate: api_unit_integration
- **Steps:** 1. cd apps/api && npx jest   (full suite, no -t filter) 2. Note which test failed 3. Re-run and note that a different one fails
- **Expected:** A deterministic suite either passes or fails the same way twice
- **Actual:** Run 1 failed src/modules/partner/http-webhook.sender.spec.ts; run 2 failed test/security/secret-scan.spec.ts (a real defect, BUG-005); run 3 failed src/modules/forms/form-refresh.service.spec.ts 'processes forms sequentially'. Every timeout case reported 'Exceeded timeout of 5000 ms'. Each failing suite passed in isolation.
- **Root cause:** apps/api/package.json set no jest testTimeout, so the 5 000 ms default applied to suites that boot HTTP servers and simulate sequential government fetches. Under 353 parallel suites those exceed 5 s on a loaded machine. Separately, http-webhook.sender.spec.ts passed 5000 as the SENDER's own budget on a loopback round-trip, so even with a longer jest timeout the sender itself aborted and returned statusCode null.
- **Impact:** The required regression gate was permanently unreliable. A gate that fails differently every run gets read as noise, which is exactly how a genuine failure (BUG-005, a security check) sat unnoticed inside it.
- **Evidence:** run_1: `Test Suites: 2 failed … partner/http-webhook.sender.spec.ts` · run_2: `Test Suites: 1 failed … test/security/secret-scan.spec.ts` · run_3: `Test Suites: 1 failed … forms/form-refresh.service.spec.ts (Exceeded timeout of 5000 ms)` · run_4: `partner sender again, this time statusCode null — the sender's own 5 s budget, not jest's` · green_run: `api-jest exit 0 — 353 suites passed, 2460 tests, 43 skipped`
- **Fix FIX-005:** Set jest testTimeout to 30 000 ms in apps/api/package.json so the default budget fits the suites that do real work under parallelism, and replaced the literal 5000 the two socket-opening webhook cases handed the SENDER with a named SOCKET_BUDGET_MS = 30_000. The three cases that never open a socket (SSRF refusal, bad scheme, malformed url) keep their original value — the budget is irrelevant there.
- **Files changed:** `apps/api/package.json`, `apps/api/src/modules/partner/http-webhook.sender.spec.ts`
- **Why this is not a security weakening:** No test was disabled and no expectation was rewritten to match a bug. The suite went from 'fails somewhere different every run' to exit 0 with the same 2 460 assertions still enforced.
- **Retest:** PASS — apps/api full suite exit 0: 353 suites passed, 2460 tests passed, 43 skipped, 0 failed.
- **Regression:** PASS — apps/api tsc --noEmit -p tsconfig.build.json exit 0; CI=1 pnpm --filter api build exit 0.

## BUG-005 — P2 — FIXED

**The defensive secret scan failed on the secret scanner's own allowlist — a permanently red security gate**

- **Environment:** local (apps/api jest)
- **Country / category:** — / —
- **Scenario:** regression-gate: api_unit_integration
- **Steps:** 1. cd apps/api && npx jest test/security/secret-scan.spec.ts
- **Expected:** The scan passes, or names a file that genuinely holds a secret
- **Actual:** FAIL — offenders = ['.gitleaks.toml']. Deterministic, not flaky, and tracked since commit 6c2c14c.
- **Root cause:** .gitleaks.toml quotes the local Supabase demo anon/service keys so gitleaks will ALLOW them. The spec's EXEMPT list covered specs, /test/, docs/, *.md and workflows — the categories that 'legitimately mention these patterns' — but not the scanner config itself, so the scanner flagged the scanner.
- **Impact:** A security gate that always fails teaches everyone to ignore it. It also masked BUG-004's timeouts inside the same red suite.
- **Evidence:** offenders: `['.gitleaks.toml']` · lines: `.gitleaks.toml:23-24 — the iss:'supabase-demo' anon and service_role keys` · provenance: `git log -- .gitleaks.toml -> 6c2c14c 'audit: 16-phase audit, remediation and revalidation program'`
- **Fix FIX-006:** The scan now allowlists the local-demo TOKENS instead of exempting a file: stripLocalDemoJwts() parses each JWT payload it finds and neutralises only those whose claims carry iss === 'supabase-demo' (the keys `supabase start` prints on every machine). Everything else still trips the scan, in .gitleaks.toml or anywhere else.
- **Files changed:** `apps/api/test/security/secret-scan.spec.ts`
- **Why this is not a security weakening:** Coverage went UP, not down: previously any content in an exempt file was unscanned; now only two specific published tokens are recognised as non-secrets, and they are verified by decoding the payload rather than by string match. A malformed payload is treated as a finding, not as safe.
- **Retest:** PASS — 5/5 in the suite (was 3/4 with 1 failing).
- **Regression:** PASS — apps/api tsc --noEmit -p tsconfig.build.json exit 0.

