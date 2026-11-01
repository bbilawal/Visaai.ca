# VisaAI — Project State

> Created 2026-08-05 during the Task 9 completion gate. This file did not exist
> before; the gate expected it. It is a snapshot of *delivery* state — the
> authoritative module roadmap remains `VISAAIDocs/roadmap/MASTER-ROADMAP.md`
> and the per-module tracker `VISAAIDocs/roadmap/PROGRESS.md`.

## Naming caveat

The "Task N" numbering used in recent work (Task 9 = mobile, Task 10 = voice
assistant) **does not appear anywhere in the repository's roadmap.** The roadmap
tracks modules M1–M8 plus platform workstreams. Both vocabularies are in use;
this file maps between them where it can, and flags where it cannot.

## Surfaces

| Surface | State | Notes |
|---|---|---|
| `apps/api` — NestJS | **Live** | 46 modules; 293 suites / 1435 tests green; `nest build` clean |
| `apps/web` — Next.js 16 | **Live** | Typecheck clean; 157 unit tests green |
| `apps/extension` — Chrome MV3 | Live | Portal auto-fill + full submission flow |
| ~~`apps/sidecar` — Electron~~ | **Removed 2026-06-02** | Deleted in `369607e`; the extension took over the whole flow. This table listed it as "Live" until the 2026-08-06 audit — corrected as ARCH-001 |
| `apps/mobile` — Expo/RN | **Code-complete, not shipped** | Bundles for both platforms; never compiled to a binary or run on a device |
| `packages/types` | Live | Shared contracts; now builds via a `prepare` script so clean checkouts work |

## Mobile (Task 9) — status

**CONDITIONAL GO, 68/100.** Full detail: `VISAAIDocs/mobile/task-09-completion-report.md`.

- Verified: `expo export` produces iOS (4.9 MB) and Android (5.2 MB) bundles;
  `expo prebuild` generates valid native projects; 179 mobile tests, typecheck
  and lint clean.
- Ten independent review agents initially returned FAIL/NO-GO. Ten Critical and
  ~16 High findings were fixed and re-verified, including a bundle-breaking
  Metro config, a remote DoS in the booking API, four wrong API contracts, and
  the absence of crash reporting and an error boundary.
- Not done: no native binary, no device run, no store accounts, push never
  delivered end-to-end, payment-policy decision open.

## Voice assistant (Task 10) — status

**CONDITIONAL GO, 74/100.** Detail: `VISAAIDocs/voice/task-10-completion-report.md`.

- Built: socket.io `/voice` transport (ADR 0001), provider-neutral STT/TTS with
  mock + OpenAI adapters and fallback, consent gating, PII redaction,
  prompt-injection and regulated-advice refusal, 10 cost limits, RLS-scoped case
  context, consultant escalation, mobile voice screen, and a 14-case evaluation
  suite that runs in CI.
- Reuses `AiService`, `AiUsageMeter`, `GuardrailsService` and the consultations
  API rather than duplicating them.
- 124 voice tests; API suite 1559 passing.
- **Not done:** no device run, no streaming transcription, no summarisation, no
  audit-event wiring, no web interface, `fr`/`es` unevaluated.

## Partner API platform (Task 11) — status

**CONDITIONAL GO, 76/100.** Detail: `VISAAIDocs/partner-api/task-11-completion-report.md`.

- Built: OAuth 2.0 (client credentials + authorization code with PKCE), API
  keys with rotation, scopes narrowed at every layer, per-application rate
  limits and quotas, idempotency, cursor pagination, a partner-specific error
  envelope, signed webhooks with retries/DLQ/replay/secret rotation, a
  structurally isolated sandbox, an OpenAPI 3.1 document generated from code
  and drift-tested, `@visaai/partner-sdk`, and a `/developers` portal.
- Reuses `organizations`/`organization_members` as the tenant model, the IAM
  permission catalog, `FieldCryptoService`, BullMQ and `auth_audit_log`.
- 401 partner tests + 39 SDK tests; API suite 1960 passing.
- **Authorization note:** partner traffic carries no user JWT, so RLS is NOT
  the boundary for it — `PartnerAuthGuard` plus explicit filters are. RLS on the
  partner tables protects the portal path.
- **Not done:** no producer emits partner events yet (webhooks work but nothing
  fires them), no integration test against a real database, no end-to-end HTTP
  test, portal never rendered, DNS-rebinding SSRF gap accepted.

## Design system (Task 12) — status

**CONDITIONAL GO, 71/100.** Detail: `VISAAIDocs/design-system/task-12-completion-report.md`.

- Audit first: the Monad system is coherent but was inconsistently applied, so
  it was corrected rather than replaced (20 files changed, not 156).
- Built: a semantic token layer over the literal palette, complete token-only
  dark mode (system preference + explicit override + persistence + no flash),
  named type/motion/z-index scales, 67 contrast tests, 17 visual-regression
  baselines and a 39-test design-system e2e suite.
- **Fixed two pre-existing blockers Task 12 did not create:** `next build`
  failed outright (client modules imported `next/headers` via `serverApi`), and
  Playwright's browser was never installed, so the repo's e2e and axe suites
  had never actually executed.
- Accessibility: axe went from violations on **all 7** public routes to **0**,
  in both themes. Four Critical contrast findings fixed, including one web had
  been shipping since mobile reported it in Task 9.
- **Not done:** mobile dark mode, authenticated-portal coverage, any
  screen-reader pass, ~27 of the ~40 listed components, Lighthouse budgets,
  journey optimization (§5).

## Production infrastructure (Task 13) — status

**CONDITIONAL GO, 62/100.** Detail: `VISAAIDocs/infrastructure/task-13-completion-report.md`.

- Task 13 specified AWS/Kubernetes/Terraform. The approved architecture is a
  single Hostinger VPS, and the task's own conflict clause applies:
  **ADR 0002** records the decision to build for the real platform rather than
  a duplicate one.
- Built: environment isolation enforced at boot (25 tests + a CI boot-refusal
  assertion), `infra/scripts/` preflight + smoke-test + DR rehearsal, a CI
  `infra` job (ShellCheck, SBOM), and 14 documents.
- **DR rehearsal passes:** all 88 migrations rebuild the full schema (128
  tables, 125 RLS, 140 policies) on bare Postgres 17 in 8 seconds.
- **CRITICAL FINDING — the production database has no backup.** Supabase
  `plan: free`, `pitr_enabled: false`, `backups: []`. RPO is total loss for
  immigration applications, documents, payments and audit chains. Fix: $25/month.
- Two more High findings: **0 of 88 migrations are transactional** (a
  mid-migration failure leaves an unrecoverable partial state), and the
  database is in **us-east-1** while the API enforces regional residency.

## Production database

Supabase `ujxzxefvtaoxiydbdrhb`. All August migrations applied **and recorded**:

| Version | Contents |
|---|---|
| `20260805000000` | Hot-path FK indexes (10) |
| `20260805010000` | `privacy_requests` (GDPR/PIPEDA) |
| `20260805020000` | `device_push_tokens` (native push) |
| `20260805030000` | Consultations INSERT policy + overlap exclusion constraint |
| `20260805040000` | `messages.client_id` (send idempotency) |
| `20260805050000` | Voice assistant: sessions, transcript turns, consents |
| `20260806000000` | Partner API platform: 13 tables, usage RPC, partner permissions |

Waves 1–2 had been applied earlier but never recorded in
`supabase_migrations.schema_migrations`; that is now corrected, so
`supabase db push` will not attempt to re-run them.

### Migration ledger reconciled, 2026-08-06

**The recording gap had recurred.** A ledger-vs-repo diff found **9 further
migrations applied on production but never recorded** — the payments
sub-projects and the whole analytics platform:

```
20260705000000_sp1_payment_foundation   20260706020000_analytics_foundation
20260705010000_sp2_subscriptions        20260709010000_kpi_rollups
20260705020000_sp3_onetime_payments     20260709020000_analytics_reports
20260706000000_sp4_payouts_tax          20260709030000_analytics_alerts
20260706010000_sp5_financial_ops
```

`supabase db push` would have tried to re-run all nine against an
already-migrated schema, and none of them are transactional.

**Verified before recording, not assumed.** Every object each migration
declares was parsed out of the SQL and diffed against the live catalogs:
26 tables, 239 columns, 13 indexes, 20 policies, 5 functions, 3 triggers —
**0 missing**. Plus a targeted check of what a regex cannot see:
`analytics_event_stream` is genuinely `relkind='p'` with its 11 declared
columns and 3 live partitions; `ensure_month_partition` and
`is_analytics_admin` both exist; **RLS is enabled on all 26 tables** (the
`rls_off` probe returned `[]`).

All 9 are now recorded with names. The ledger holds **91 rows** and the only
repo-vs-ledger gap is the two Task 15 migrations, which are genuinely
unapplied. **`supabase db push` is safe again.**

| Still unapplied | Why |
|---|---|
| `20260806130000_feature_flags_and_beta_cohorts` | Blocked on BLK-1 — applying schema to a database with zero backups |
| `20260806140000_beta_feedback` | Same |

## Beta + launch readiness (Tasks 15 & 16) — status

**Task 15: NO-GO — beta blocked on BLK-1/2/3. Repository preparation complete.**
**Task 16: NO-GO.** Detail:
`VISAAIDocs/beta-launch/task-15-completion-report.md`,
`VISAAIDocs/public-launch/task-16-completion-report.md`.

- The closed beta was **not started** and the public launch was **not
  performed**. Nothing was deployed, submitted to a store, announced, sold, or
  acquired. No beta or launch metric is reported, because none exists.
- **BLK-1 re-verified live on 2026-08-06** against the Supabase Management API:
  org `dcrzcbgxdtoolnkuxrpz` is on `"plan": "free"`, project
  `ujxzxefvtaoxiydbdrhb` has `pitr_enabled: false` and `backups: []`.
  Production still has **no database backup of any kind**. BLK-2 and BLK-3
  likewise unchanged (`SENTRY_DSN` is still unset).
- **Two systems were built** because the completion gates required working
  mechanisms, not documents:
  - **Feature flags** (`apps/api/src/modules/feature-flags/`, migration
    `20260806130000`) — code-declared registry, deterministic and monotonic
    percentage bucketing, cohort/role targeting, kill switches with a mandatory
    reason and full audit, an env escape hatch that works when Supabase is down,
    a `@RequireFlag` route guard applied to the five charge-creating billing
    routes, and web + mobile clients. 52 tests.
  - **Beta feedback** (`apps/api/src/modules/feedback/`, migration
    `20260806140000`) — allowlisted device metadata, server-built context,
    consent-gated screenshots in a private bucket, triage lifecycle behind
    `support.access`. 19 tests.
- **Correction to Task 14:** its go/no-go checklist recorded *"Feature flags
  work ✅ — flag system present, `flags:sync` in web"*. `flags:sync` copies
  **country-flag SVGs** from `flag-icons`; no feature-flag system existed
  anywhere. `VISAAIDocs/public-launch/go-no-go-checklist.md` and `ROLLBACK-PLAN.md` §4 are
  corrected.
- **Both new migrations are unapplied**, deliberately: applying to production
  while it has no backup is the exact risk BLK-1 describes.
- 32 documents added under `docs/beta-launch/`, `docs/public-launch/`,
  `docs/growth/`, `docs/ai/`, `docs/operations/`, `docs/roadmap/`.

## Known platform-level risks

1. **Tenant-isolation tests do not run in CI.** The 11 RLS / cross-tenant suites
   self-skip without Supabase credentials and are counted as green. Task 14
   found a **live** cross-tenant leak on production (SEC-22) that local analysis
   structurally could not find — so a green pipeline does not mean tenant
   isolation was checked. Highest-value CI gap in the repository.
2. **`apps/web` has two sub-AA colour tokens** (see the technical-debt register).
3. **`apps/api` has 81 pre-existing type errors in spec files**, invisible to
   `nest build`.
4. Deployment is still manual SSH to a Hostinger VPS; `git push` does not deploy.

## Immediate next actions

Ordered by what unblocks the most. The first item is the most upstream thing in
the entire product.

1. **Upgrade Supabase to Pro + enable PITR (~$25/month), then evidence a
   restore.** Closes BLK-1. Unblocks applying migrations → the closed beta →
   the public launch → every piece of evidence the Q3/Q4 roadmap depends on.
   This is a purchase, not an engineering task.
2. **Set `SENTRY_DSN` and configure alerting to a named recipient** (BLK-3, ~3h).
3. **Execute the deploy *and* rollback runbook once, end to end, with timings**
   (BLK-2, ~4h).
4. Apply migrations `20260806130000` and `20260806140000` — **after** step 1.
5. Wire Supabase credentials into CI so the RLS suites actually execute.
6. Produce real mobile builds (EAS or local with Xcode / JDK 17) and verify on
   hardware.
7. Resolve the store payment-policy question (IAP vs. external Stripe) before
   any submission.
8. Fill in names against the roles in
   `VISAAIDocs/beta-launch/beta-support-runbook.md` and
   `VISAAIDocs/public-launch/launch-command-center.md`.
9. **Rotate the Supabase management token** — it has now been pasted into chat
   across three sessions.

## Task 10 (voice assistant) readiness

Dependencies exist and are documented; see the completion report. Blocking
caveat: the mobile app has not been executed on a device, so anything built on
top of it inherits unverified ground.
