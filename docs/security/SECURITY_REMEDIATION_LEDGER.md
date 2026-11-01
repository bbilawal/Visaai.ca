# VisaAI — Security Remediation Ledger

Master Security Audit, 2026-08-16. Branch `security/master-audit-2026-08-16`.
Starting commit `13815351`. Every fix below was retested; DB-layer fixes were
reproduced as a working exploit against a local copy of the production schema,
fixed, and re-run to confirm the attack now fails and legitimate flows still work.

Legend — Status: **FIXED** (code/migration + retest), **OPERATOR** (requires an
action only the operator can safely take — see `SECURITY_OPERATIONS_RUNBOOK.md`),
**ACCEPTED** (documented residual risk — see `SECURITY_REMAINING_RISKS.md`).

## CRITICAL

| ID | Title | Fix | Retest | Status |
|---|---|---|---|---|
| SEC-4090 | Consultant self-approves KYC / license / payouts and hijacks Stripe Connect payout account via RLS (direct PostgREST) | `20260816120000` trigger `sec_guard_consultant_profiles` pins verification/payout/rating/`stripe_connect_account_id` columns to service-role/admin | SQL regression PASS (attack blocked; owner content-edit still works) | FIXED |
| SEC-4091 | Consultation participant rewrites `user_id`/`application_id`/`meeting_url` (`WITH CHECK (true)`) | `20260816120000` re-scoped WITH CHECK + trigger `sec_guard_consultations` freezing identity cols, meeting_url provider allowlist | SQL regression PASS (hijack blocked; legit reschedule ALLOWED) | FIXED |
| SEC-9002 | Applicant fabricates a `{feature:prefill,status:complete}` payments row to unlock the paid feature free | `20260816120000` `payments` made owner-READ-ONLY | SQL regression PASS (insert denied by RLS) | FIXED |
| SEC-4094 / SEC-9001 | `applications.plan_tier` (drives PlanGuard entitlement) owner-writable → free expert tier | `20260816120000` trigger `sec_guard_applications` pins plan_tier/vri_score/status/… | SQL regression PASS (escalation blocked; own-row write ALLOWED) | FIXED |
| SEC-4001 | `audit_append()` SECURITY DEFINER RPC callable by anon/authenticated → forge chain-linked audit entries as any actor | `20260816120100` REVOKE + seed re-assert | RPC lockdown verified (permission denied) | FIXED |
| SEC-4002 | `field_provenance_create_version()` RPC → forge document-verification evidence | `20260816120100` REVOKE | verified | FIXED |
| SEC-4003 | `claim_outbox_batch()` RPC → cross-tenant PII read + delivery disruption | `20260816120100` REVOKE | SQL regression PASS (anon denied) | FIXED |
| SEC-3005 / SEC-3050 | Messaging `confirmAttachment`/`confirmVoice` trust a client `storagePath`, later signed with the service-role client → arbitrary cross-tenant document read | `assertPathOwnedBy` binds the path to the caller's own conversation folder | 3 jest regression tests PASS | FIXED |
| SEC-7002 | Self-hosted Postgres published on `0.0.0.0` (all immigration PII exposed) | `docker-compose.yml` bound to `127.0.0.1` | config review + parity with Kong bind | FIXED |
| SEC-5001 / SEC-5003 / SEC-5004 | Real, still-live credentials (OpenAI key, Upstash token, Supabase JWTs) in git history | cannot rotate from here | — | **OPERATOR** (rotate) |

## HIGH

| ID | Title | Fix | Status |
|---|---|---|---|
| SEC-4004 | `bump_delivery_attempt()` RPC tamper | `20260816120100` REVOKE | FIXED |
| SEC-4005 | `consume_review_credit()` RPC depletes another user's paid credits (trusts `p_user_id`) | `20260816120100` REVOKE (service-role only) | FIXED |
| SEC-1002 | Unauthenticated `POST /auth/record-login` forges login_history/audit rows and self-resets the lockout | success + userId now require a verified Supabase token; `userId` removed from DTO | FIXED |
| SEC-3004 | `organizations.plan` client-settable via self-service PATCH (any org creator is admin) → billing-tier self-upgrade | removed `plan` from `UpdateOrgDto` / service update | FIXED |
| SEC-6001 | Indirect prompt injection: OCR-derived profile → VRI visa-category prompt unfenced | `asUntrustedData` fence + directive | FIXED |
| SEC-6002 / SEC-6009 | `/visa/analyze` feeds notes/profile unfenced; no AI-cost throttle | fenced inputs + `@Throttle(10/min)` | FIXED |
| SEC-6003 | Document translation feeds raw OCR text unfenced | fenced | FIXED |
| SEC-6005 | Fence-coverage guard blind to non-LangChain prompt shapes | coverage spec extended with required-list | FIXED |
| SEC-8510 | Extension `onMessageExternal` trusts any externally_connectable origin (incl. shipped `localhost:3000`) + any `apiUrl` | sender-origin + apiUrl allowlist; build strips localhost in prod | FIXED |
| SEC-8001 | Submission client logs the extension hand-off token to the console in prod | log only a non-sensitive action label, dev-only | FIXED |
| SEC-8002 | Web tier ships no CSP / security headers | CSP + HSTS + nosniff + frame-ancestors none + Permissions-Policy via `next.config` | FIXED |
| SEC-7001 | nginx appends X-Forwarded-For → `trust proxy 1` reads a spoofable client IP (defeats throttle/lockout) | overwrite XFF with `$remote_addr` | FIXED |
| SEC-7004 | nginx hardening lived only in an unwired example (no headers/limits) | headers + `limit_req` + `server_tokens off`, `nginx -t` validated | FIXED (operator must install) |
| SEC-12003 | GDPR erasure only walked 2 storage levels; message/voice attachments survived | `purgeStorage` recurses the full tree | FIXED (+ regression test) |
| SEC-1001 | App-level brute-force lockout is dead — real login is client→Supabase, bypassing it | edge `/auth/` `limit_req` added; relies on Supabase's own auth throttling | ACCEPTED (architectural) |
| SEC-7003 | Every Supabase service DB role shares the `postgres` superuser password | infra `.env` — operator must set distinct passwords | **OPERATOR** |
| SEC-7009 | Self-hosted backups sit on the same host as the primary DB | off-host shipping — operator | **OPERATOR** |
| SEC-12001 | Storage served same-origin as the web app | separate storage domain — architectural; mitigated by CSP/nosniff/allowlisted upload types | ACCEPTED |
| SEC-6006 | Approval-prediction output guardrail not wired into VRI / `/visa/analyze` | prompts already forbid certainty + inputs now fenced; output-guardrail wiring deferred | ACCEPTED (hardening) |

## MEDIUM / LOW (fixed in this pass)

| ID | Title | Fix | Status |
|---|---|---|---|
| SEC-4092 | Anonymous read of internal pricing margin/COGS (`pricing_quotes`) | REVOKE select from anon + authenticated-only policy | FIXED |
| SEC-4093 | RLS infinite recursion `applications`↔`consultant_assignments` (fragile security + availability) | SECURITY DEFINER owner-lookup helper | FIXED (regression) |
| SEC-3040 | Unauthenticated marketplace listing had no row cap (scraping/DB-load) | `.limit(100)` | FIXED |
| SEC-3041 | AI endpoints share the generic global throttle | `/visa/analyze` throttle added (representative) | PARTIAL — see remaining risks |

Remaining MEDIUM/LOW items from the wave-1 reports that were not individually
code-fixed in this pass are triaged in `SECURITY_REMAINING_RISKS.md` with a
disposition and rationale, per the "fix CRITICAL/HIGH first" priority rule.

## Negative results (tested, NOT exploitable — recorded so they are not re-flagged)
- Fabricated `payments`/`subscriptions` rows do not grant entitlement: entitlement reads `subscriptions` (RLS-denied to owners) and `applications.plan_tier` (now trigger-pinned), never `payments`.
- SQLi / SSRF / path-traversal / command-injection / prototype-pollution / XXE: swept, none found outside already-defended paths (partner webhook SSRF defense verified sound).
- Service-role key: not present in any client bundle (web/mobile/extension) — verified.

## PROD APPLICATION STATUS (self-hosted VPS, applied 2026-08-20)

Applied to the live self-hosted stack (`selfhosted_*` on the VPS) and verified:

| Item | Prod status | Evidence |
|---|---|---|
| SEC-4090/4091/4092/4093/4094/9002 (RLS column hardening) | **APPLIED** as `supabase_admin` | migration COMMIT; prod security test **8/8 PASS** (txn rolled back); `sec_guard_*`=3 funcs present |
| SEC-4001–4005 (RPC lockdown) | **APPLIED** | 9 RPCs revoked from public/anon/authenticated; `rpc_still_anon=0` verified |
| SEC-7001 (nginx XFF overwrite) | **APPLIED** | site file now `X-Forwarded-For $remote_addr` ×4, 0 `$proxy_add_…`; `nginx -t` ok, reloaded |
| SEC-7004 (edge headers + server_tokens) | **APPLIED** | `/etc/nginx/conf.d/00-visaai-security.conf`; HSTS/nosniff/X-Frame-Options/Referrer/Permissions verified via curl |
| SEC-7002 (Postgres 0.0.0.0 exposure) | **STOPGAP available / durable pending** | host had ufw inactive + empty iptables; firewall DROP tested (rules active, internal health green) but auto-reverted by the 120s safety; durable fix = compose loopback bind (needs brief DB restart) |
| Fresh pre-change backup | **TAKEN** | `/root/sec-audit-backups/pre-sec-20260820T020555Z.dump` (1.04 MB) |

Pre-change safety: daily backups confirmed fresh (latest 2026-08-20 01:15) + an extra manual dump taken before any mutation. Prod uses role `supabase_admin` as the object owner (not `postgres`) — migrations must run as that role.

### Not yet applied to prod (require a maintenance window or operator 2FA)
- SEC-7002 durable (compose `127.0.0.1:54422:5432` + `docker compose up -d db`) — DB restart.
- App-port exposure 4000/3002 — bind api/web to 127.0.0.1 + restart (or persistent firewall).
- SEC-7003 (distinct DB-role passwords) — coordinated restart.
- Web CSP full deploy — web rebuild+restart (edge headers cover the gap now).
- SEC-5001/5003/5004 credential rotation — OpenAI/Upstash/Supabase dashboards + 2FA.
- Extension re-publish — Chrome Web Store + Google 2FA.
