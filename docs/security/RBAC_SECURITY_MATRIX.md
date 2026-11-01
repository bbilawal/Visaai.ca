# VisaAI — RBAC Security Matrix

Master Security Audit, 2026-08-16. Roles discovered from
`apps/api/src/modules/iam/` (6-role catalogue → legacy admin|consultant|user).

## Roles

| Role | Source of truth | Legacy mapping |
|---|---|---|
| anonymous | no token / anonymous Supabase session | — |
| applicant (user) | `auth.users` + `user_roles` | user |
| consultant | `consultant_profiles` + `user_roles` | consultant |
| support_agent | `user_roles` | consultant/admin (perms) |
| org_admin | `organization_members.role` | user + org scope |
| platform_admin | `user_roles` + `app_metadata.role='admin'` | admin |
| super_admin | `user_roles` | admin |

Identity + role come only from the cryptographically verified Supabase JWT
(`JwtGuard` → `supabase.auth.getUser`) and server-side `user_roles`, never from a
request body/header (verified in the authz audit).

## Role × capability (enforcement point)

| Capability | anon | applicant | consultant | org_admin | platform/super_admin | Enforced by |
|---|---|---|---|---|---|---|
| Browse marketing / marketplace listing | ✅ | ✅ | ✅ | ✅ | ✅ | public; listing capped (SEC-3040) |
| Create/own application | ✅ (guest→upgrade) | ✅ own | assigned only | — | all | RLS `applications`, ApplicationAccessGuard |
| Read another user's application/docs | ❌ | ❌ | assigned/covering only | ❌ | ✅ | RLS + guards |
| Upload/download own documents | — | ✅ own | assigned | — | ✅ | storage path scope (SEC-3050) + RLS |
| Set `plan_tier` / entitlement | ❌ | ❌ (was ⚠️→fixed) | ❌ | ❌ | service-role only | trigger (SEC-4094) |
| Fabricate payment/subscription | ❌ | ❌ (was ⚠️→fixed) | ❌ | ❌ | webhook/service-role | RLS read-only (SEC-9002) |
| Self-approve KYC/license/payouts | ❌ | ❌ | ❌ (was ⚠️→fixed) | ❌ | admin/service-role | trigger (SEC-4090) |
| Set own payout Connect account | ❌ | ❌ | ❌ | ❌ | service-role (Stripe onboarding) | trigger (SEC-4090) |
| Rewrite a consultation | ❌ | participant, bounded | participant, bounded | ❌ | admin | policy+trigger (SEC-4091) |
| Change org `plan` | ❌ | ❌ | ❌ | ❌ (was ⚠️→fixed) | billing/service-role | DTO removed (SEC-3004) |
| Grant/revoke roles | ❌ | ❌ | ❌ | org-scope only | ✅ | PermissionsGuard; MFA recommended (SEC-1004) |
| Call audit/outbox/credit RPCs | ❌ | ❌ | ❌ | ❌ | service-role only | REVOKE (SEC-4001–4005) |
| Read internal margin/COGS | ❌ | ❌ | ❌ | ❌ | admin | REVOKE anon (SEC-4092) |
| Admin dashboards / financial-ops | ❌ | ❌ | ❌ | ❌ | ✅ | RolesGuard/PermissionsGuard |
| Partner API (tenant-scoped) | — | — | — | — | — (partner key) | PartnerAuthGuard, consent-scoped |

⚠️→fixed = was writable pre-audit, closed by this engagement.

## Multi-tenant isolation

- **User↔user**: `auth.uid()` in every owner policy; verified by the RLS
  cross-tenant jest suites (run against a real Supabase in CI) + the new
  `rls_column_hardening_test.sql`.
- **Org↔org**: org-scoped authz in `OrganizationsService` (`assertMember`/
  `assertAdmin`); `organizations.plan` no longer self-settable.
- **Partner↔tenant**: partner responses consent-scoped; suspend/status paths use
  a shared tenancy-check helper (fixed 2026-08-16, verified by clients audit).

## Verified negative (no vertical escalation found)
The authz audit enumerated all ~320 routes and found no BFLA/vertical-escalation
at the API layer (0 CRITICAL/HIGH). The exploitable escalations were all in the
RLS/RPC layer that the API delegates to via `forUser` — now closed.
