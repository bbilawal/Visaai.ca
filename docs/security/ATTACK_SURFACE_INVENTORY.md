# VisaAI — Attack Surface Inventory

Master Security Audit, 2026-08-16. Enumerated from source, not assumed.

## Applications / surfaces

| Surface | Entry | Auth | Status |
|---|---|---|---|
| `apps/web` (Next.js 16, 15 locales, ~58 pages) | `visaai.co` :3002 | Supabase | Live |
| `apps/api` (NestJS 11, 54 modules, 70 controllers, **319 routes**) | `api.visaai.co` :4000 | Supabase JWT via JwtGuard | Live |
| `apps/extension` (Chrome MV3) | Web Store | web-session handoff | Live |
| `apps/mobile` (Expo RN) | — | Supabase | Code-complete, not shipped |
| `packages/partner-sdk` + partner API | npm / `api.visaai.co` | partner API key (hashed, timing-safe) | Live |
| `apps/sidecar` | — | — | Removed (`369607e`); dead |

## API routes (methods)

148 GET, 131 POST, 17 PATCH, 15 DELETE, 8 PUT = **319** across 70 controllers.
Full route × guard × ownership matrix: `API_SECURITY_MATRIX.md` (feeds from the
authz audit's ~320-row table in `_wave1/authz-findings.md`).

Guards in force: `JwtGuard` (global identity), `RolesGuard`, `PermissionsGuard`
(IAM), `OwnerOrAdminGuard`, `ApplicationAccessGuard`, `PlanGuard`, `MfaGuard`
(built, opt-in), `PartnerAuthGuard`, `FeatureFlagGuard`, `ThrottlerGuard`
(global) + per-route `@Throttle` on auth, partner-oauth, analytics, and (new)
`/visa/analyze`, `narrative/generate`, `vri/calculate`, `messaging/ai-draft`.

## Database (Supabase Postgres)

- **135 tables** (migrations) / 143 (local backup snapshot); **100% RLS-enabled**.
- 34 RLS-enabled tables with zero policies = intentional service-role-only (verified), except three previously reachable via unrevoked RPCs (now REVOKEd).
- Sensitive columns: `users`(email, nationality, stripe_customer_id), `applications`(plan_tier, destination_*), `consultant_profiles`(kyc_status, license_*, stripe_connect_account_id, payouts_enabled), `payments`, `consultations`(meeting_url), `pricing_quotes`(gross_margin, total_cogs), `auth_audit_log`, `login_history`, `audit_events`, `field_provenance`.
- SECURITY DEFINER functions: RLS helpers keep `authenticated` EXECUTE (needed); mutation/sensitive RPCs REVOKEd to `service_role` only (SEC-4001–4005).

## Storage buckets

`documents` (identity docs), `feedback`, `form-templates`, `document-templates`
— **all `public=false`**, path-scoped or service-role. Object key scheme
`userId/applicationId/[messages/conversationId/]<file>`; message-attachment
confirm now binds the path to the caller's folder (SEC-3050).

## Integrations (trust boundaries)

Stripe + Stripe Connect (webhooks signature-verified, raw body); Azure Document
Intelligence (in-region OCR); OpenAI (LLM); SMTP/email; Sentry (`sendDefaultPii:
false`); Expo push; government portals (via extension, human-locked submission).

## Env vars / secrets

121 `process.env.*` reads across apps. Client-exposed prefixes: `NEXT_PUBLIC_*`
(web) and `EXPO_PUBLIC_*` (mobile) — audited, no server secret behind a public
prefix. Server secrets: `SUPABASE_SECRET_KEY`, Stripe secret + webhook secrets,
OpenAI key, Upstash token, `SENTRY_DSN`. Rotation list: `SECURITY_REMAINING_RISKS.md`.

## Roles / tenancy

6 roles: applicant, consultant, support_agent, org_admin, platform_admin,
super_admin (mapped to legacy admin|consultant|user). Tenancy: per-user
(`auth.uid()`) and per-org (`organizations`/members). Matrix: `RBAC_SECURITY_MATRIX.md`.

## Background / async

Payout sweep, dunning, notification outbox + delivery, reminder log, KPI rollups,
form/document template refresh sweeps, stale-anonymous cleanup (pg_cron),
analytics event stream (monthly partitions). Outbox/delivery RPCs now service-role only.
