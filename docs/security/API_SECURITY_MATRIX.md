# VisaAI — API Security Matrix

Master Security Audit, 2026-08-16. The full route × guard × ownership-check
matrix (~320 rows, one per controller route) was produced by the authorization
audit and lives at `docs/security/_wave1/authz-findings.md` ("ROUTE × GUARD ×
OWNERSHIP-CHECK MATRIX"). This file summarises it and records the API-security
posture per OWASP API Top 10.

## Enforcement summary (from the ~320-route enumeration)

- **Identity**: 1 global `JwtGuard` — every non-`@AllowAnonymous` route requires
  a Supabase-verified token. `@AllowAnonymous` usage is scoped and audited
  (intake, `/me`, marketplace listing, pre-auth security endpoints).
- **Ownership**: request paths use either `SupabaseService.forUser(token)` (RLS
  enforces owner/tenant) or the service-role client with an explicit
  `.eq('user_id', callerId)` filter. No unfiltered service-role read of an
  id-addressed resource was found.
- **Authorization**: `RolesGuard`/`PermissionsGuard`/`PlanGuard`/
  `ApplicationAccessGuard` applied where required; role derived from verified
  claim / DB, never request input.

## OWASP API Top 10 disposition

| Risk | Finding(s) | Status |
|---|---|---|
| API1 BOLA/IDOR | attachment storagePath (SEC-3005/3050); review app_id (SEC-2001) | FIXED; API layer otherwise clean |
| API2 Broken auth | record-login forgery/self-reset (SEC-1002); client-side lockout (SEC-1001) | FIXED; 1001 accepted |
| API3 Excessive data / property (mass assignment) | org plan (SEC-3004); RLS column writes (SEC-4090/91/94) | FIXED |
| API4 Resource consumption | unbounded listing (SEC-3040); AI cost (SEC-3041) | FIXED (listing + key AI routes); rest triaged |
| API5 BFLA | none at API layer | Verified clean |
| API6 Sensitive business flows | payments/entitlement self-grant | FIXED (webhook/service-role + triggers) |
| API7 SSRF | swept; only defended partner-webhook path makes user-URL requests | Clean |
| API8 Security misconfig | no global ValidationPipe (uses zod-per-route); 2 controllers unvalidated | zod convention; ConsultantController/AlertsController.update noted (triaged) |
| API9 Inventory mgmt | partner API versioned + OpenAI export | OK |
| API10 Unsafe consumption | LLM output never used as authz; fenced inputs | FIXED |

## Validation posture

No global `ValidationPipe`/`class-validator` — the codebase uses **zod per
route** (43 zod schema files). Gaps: `ConsultantController` (7 endpoints) and
`AlertsController.update()` (`patch: any`) lack runtime validation — triaged in
`SECURITY_REMAINING_RISKS.md`. Body-size cap: nginx `client_max_body_size 25m`
(Stripe raw body) + Express default; recommend an explicit smaller JSON cap on
non-webhook routes (triaged).

## CORS

`enableCors({ origin: WEB_URL || 'http://localhost:3000', credentials: true,
allowedHeaders: ['Content-Type','Authorization'] })` — single trusted origin, no
wildcard, credentials scoped. No reflection found.

## Error handling

`AllExceptionsFilter` normalises errors; no stack traces / DB error text / paths
leaked to clients in production (verified in api-validation audit).
