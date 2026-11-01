# VisaAI — Authentication Security Audit (Wave 1)

**Scope:** Authentication only (login, signup, session/token handling, MFA, lockout/brute-force,
password policy, anonymous/guest sessions, OAuth, reset/verification tokens). Authorization/IDOR
is explicitly out of scope (owned by another agent).

**Method:** Static source review (grep + read) of `apps/api/src/modules/auth`,
`apps/api/src/modules/iam`, `apps/web/lib/supabase`, `apps/web/proxy.ts`, all web auth pages,
`supabase/config.toml`, and `packages/types`. No live requests were made against any environment.
Every claim below is backed by `path:line` evidence with quoted code. Read-only — no files were
modified.

**Auditor:** Security Engineer (defensive audit, authorized by repo owner)
**Date:** 2026-08-16

---

## AUTH SURFACE INVENTORY

| Surface | Type | Guard / Protection | Notes |
|---|---|---|---|
| `POST /auth/lockout-status` | API (NestJS, `SecurityController`) | None (public), `@Throttle 10/min` | **Never called by the web app** — dead control (SEC-1001) |
| `POST /auth/record-login` | API (NestJS, `SecurityController`) | None (public), `@Throttle 5/min` | **Never called by the web app**; unauthenticated write of arbitrary `login_history`/`auth_audit_log` rows (SEC-1001, SEC-1002) |
| `GET /me` | API (`MeController`) | `JwtGuard` + `@AllowAnonymous` | Correct — guest identity only, no elevated data |
| `GET/PATCH /me/language` | API (`MeController`) | `JwtGuard` + `@AllowAnonymous` | OK |
| `GET/PATCH /me/profile` | API (`ProfileController`) | `JwtGuard` | OK |
| `GET /me/login-history` | API (`ProfileController`) | `JwtGuard` | Scoped to caller's own `user_id`; the underlying table is effectively never populated (SEC-1006) |
| `GET /me/mfa` | API (`MfaController`) | `JwtGuard` | OK |
| `POST /me/mfa/event` | API (`MfaController`) | `JwtGuard` | Correctly wired from `mfa-section.tsx` |
| `POST /iam/users/:id/roles` (grant role, incl. `platform_admin`) | API (`IamController`) | `JwtGuard` + `PermissionsGuard` (`iam.roles.manage`) | No `@RequireMfa` step-up despite being the platform's highest-privilege action (SEC-1004) |
| `DELETE /iam/users/:id/roles/:roleKey` | API (`IamController`) | `JwtGuard` + `PermissionsGuard` | Same as above |
| `/login` (page) | Web, client component | Calls `supabase.auth.signInWithPassword()` directly | No app-level lockout consulted (SEC-1001); generic error message (anti-enumeration, good) |
| `/signup` (page) | Web, client component | Calls `supabase.auth.signUp()` directly | Surfaces raw Supabase error → account enumeration (SEC-1010) |
| `/forgot-password` (page) | Web, client component | `resetPasswordForEmail()` | Explicitly anti-enumeration (good — no finding) |
| `/reset-password` (page) | Web, client component | `updateUser({password})`, relies on an active/recovery session | Client-side length/complexity gating only (SEC-1003) |
| `/callback` (route handler) | Web, server route | `exchangeCodeForSession(code)` | `next` param validated by `resolveSafeNext` (open-redirect safe — good) |
| `proxy.ts` (Next middleware) | Web, edge | `getClaims()` / cookie presence | UX-level redirect only; correctly documented as non-authoritative |
| `(dashboard)/layout.tsx` | Web, server component | `supabase.auth.getUser()`, explicit `is_anonymous` check | Correctly blocks anonymous guests from the authenticated dashboard |
| `(admin)/layout.tsx`, `(consultant)/layout.tsx` | Web, server component | `requireRole()` → calls API `GET /me` | Correct — server-verified, not JWT-decoded client-side |
| MFA enrollment/verify/unenroll | Web, client (`mfa-section.tsx`) | Native Supabase TOTP | No `@RequireMfa` anywhere consumes the resulting `aal2` (SEC-1004) |
| Guest → permanent upgrade (`upgradeGuestEmail`, `linkOAuthIdentity`) | Web, client | Supabase `updateUser`/`linkIdentity` on same uid | No account-merge; correctly rejects on email collision |
| `TokenCache` (API, in-memory) | API internal | 30s TTL, keyed by SHA-256(token) | `invalidate()` never called from any logout/role-change path (SEC-1005) |

---

### SEC-1001
Title: App-level brute-force/lockout system is not wired into the real authentication path (dead control)
Severity: HIGH
Affected component: `apps/api/src/modules/iam/security.controller.ts`, `apps/web/app/[locale]/(auth)/login/page.tsx`
Affected profile(s): All (any user with a password-based account)
Affected page/API: `POST /auth/lockout-status`, `POST /auth/record-login`, `/login`
Description:
The API exposes `lockout-status` (pre-check) and `record-login` (post-check) endpoints whose
extensive code comments describe them as "the mitigation" for credential stuffing/brute force
(SEC-001). However, the actual sign-in call in the web app goes **directly** to Supabase's GoTrue
service from the browser (`supabase.auth.signInWithPassword`) and never calls either endpoint.
An exhaustive repo-wide grep for the endpoint paths and their client wrapper names confirms this:
no call site exists anywhere in `apps/web`.
Attack scenario: An attacker scripts requests directly against the Supabase Auth token endpoint
(the same one the browser calls) or replays `signInWithPassword` calls from any HTTP client. The
VisaAI application layer performs zero rate limiting or lockout on this path — the `account_lockouts`
table is never consulted before a real authentication attempt, and never updated after one, because
nothing in the shipped frontend calls these endpoints. The only brute-force protection actually in
effect is whatever GoTrue itself provides, which is not verifiable from this repository (self-hosted
production config lives on the VPS, outside this repo) and the code's own comments state
"platform CAPTCHA is off."
Business impact: Unlimited password-guessing / credential-stuffing attempts against real user
accounts (which hold passports, financial data, and immigration case files) with no
application-layer throttle, despite the codebase's own documentation asserting this protection
exists and is the "practical control."
Evidence:
- `apps/api/src/modules/iam/security.controller.ts:20-40` — comment block asserting record-login/lockout-status are the SEC-001 mitigation and describing the web app's expected call pattern ("the web app calls `lockout-status` before attempting sign-in and `record-login` with the outcome").
- `apps/web/app/[locale]/(auth)/login/page.tsx:33` — `const { error } = await signInWithPassword({ email, password })` — direct Supabase call, no lockout check before or reporting after.
- Repo-wide search performed: `grep -rn "auth/lockout-status\|auth/record-login\|lockoutStatus\|recordLogin" apps/web --include="*.ts" --include="*.tsx"` returns **zero** matches outside the API module itself.
- `apps/web/lib/auth/password-strength.ts:19-20` — `"platform CAPTCHA is off, so the practical control against credential stuffing was the per-email lockout alone."`
Root cause: The lockout system was built as a self-contained API feature but the corresponding frontend integration (pre-flight check + outcome reporting around the real Supabase sign-in call) was never implemented, so the control silently no-ops in production while the code and its comments assert it is active and load-bearing.
Remediation:
1. In `apps/web/app/[locale]/(auth)/login/page.tsx`, call `POST /auth/lockout-status` before invoking `signInWithPassword`, and block submission with the generic "too many attempts" message when `locked: true`.
2. After `signInWithPassword` resolves, call `POST /auth/record-login` with `{ email, success, userId: data?.user?.id }` so the lockout FSM in `iam.engine.ts` actually advances.
3. Apply the same pattern to any other password-entry surface (`auth-modal.tsx` email mode, if it ever supports password sign-in for existing accounts).
4. Independently, verify and harden GoTrue's own rate limiting on the self-hosted VPS (`GOTRUE_RATE_LIMIT_*` env vars) as defense-in-depth — do not rely on the app layer alone even after wiring it up (see SEC-1002 for why).
Suggested regression test: `apps/web/app/[locale]/(auth)/login/__tests__/login-lockout.test.tsx` — mock `fetch`/`signInWithPassword`, assert `lockout-status` is called before submit and `record-login` is called after, and that a `locked: true` response disables the submit button/blocks the call to Supabase entirely.
Confidence: CONFIRMED

---

### SEC-1002
Title: `POST /auth/record-login` is an unauthenticated forgery primitive for the auth audit trail, and self-defeats the lockout it is meant to enforce
Severity: HIGH
Affected component: `apps/api/src/modules/iam/security.controller.ts`, `security.service.ts`, `iam.repository.impl.ts`, `iam.dto.ts`
Affected profile(s): All (any user's `login_history`/`auth_audit_log` can be targeted)
Affected page/API: `POST /auth/record-login`
Description:
`record-login` has no auth guard and accepts `{ email, success, userId? }` entirely from the
caller — `success` is never independently verified against a real Supabase authentication event.
Two distinct problems follow from this:
1. **Audit-trail forgery.** Any unauthenticated caller can insert arbitrary rows into
   `login_history` and `auth_audit_log` for **any** `userId`/`email` pair (no check that the
   `userId` actually belongs to the `email`). Since `GET /me/login-history` shows a user their own
   history scoped by `user_id`, an attacker can plant fabricated "successful login" entries
   attributed to a victim (e.g., from a suspicious IP) purely for social-engineering/panic value,
   or pollute the record during a real incident-response investigation.
2. **Self-resettable lockout.** `nextLockoutState()` resets `failed_count` to 0 and clears
   `locked_until` whenever `success` is `true` — and `success` is attacker-controlled. Even if
   SEC-1001 is fixed and this endpoint is wired into the real login flow, an attacker brute-forcing
   the real Supabase endpoint can simply interleave `POST /auth/record-login {email, success:true}`
   calls (rate-limited to 5/min, but that only limits how often the attacker can clear their own
   counter — not how often they can guess passwords against Supabase directly) to keep resetting
   their own `(email, ip)` lockout bucket indefinitely.
Attack scenario: `curl -X POST https://api.visaai.co/auth/record-login -d '{"email":"victim@example.com","success":true,"userId":"<victim-uuid>"}' -H 'Content-Type: application/json'` — inserts a forged successful-login audit row for the victim with the attacker's own IP/UA, with no authentication required.
Business impact: Undermines the integrity of the only audit trail this product has for account-access forensics; on an immigration platform, a plausible-looking forged login event could be used to alarm a victim, or to muddy an actual compromise timeline during incident response. Also nullifies the lockout mechanism's value even once wired up (SEC-1001).
Evidence:
- `apps/api/src/modules/iam/iam.dto.ts:72-76` — `export const RecordLoginDto = z.object({ email: z.string().email(), success: z.boolean(), userId: z.string().uuid().nullish() });` — `success` and `userId` are pure client input, no cross-check.
- `apps/api/src/modules/iam/security.controller.ts:57-73` — `@Post('record-login')` has no `@UseGuards`, only `@Throttle({ default: { limit: 5, ttl: 60_000 } })`.
- `apps/api/src/modules/iam/iam.engine.ts:110-122` — `nextLockoutState`: `if (success) { return { failed_count: 0, locked_until: null, ... } }` — unconditional reset driven by the caller-supplied boolean.
- `apps/api/src/modules/iam/iam.repository.impl.ts:483-493` — `recordLogin` inserts `user_id: rec.userId` directly with no ownership/email-match verification.
Root cause: Trusting a client-supplied `success` boolean and an unverified `userId` for a public, unauthenticated endpoint that writes to a security-sensitive audit table.
Remediation:
1. Do not accept `userId` from the client at all; resolve it server-side from `email` via `findUserIdByEmail` (already present in `iam.repository.impl.ts:472`) so a caller cannot attribute events to an arbitrary uid.
2. This endpoint fundamentally cannot verify `success` without seeing the real credential exchange. Two options: (a) move to a server-side auth proxy where the API itself performs the Supabase password check and reports the outcome authoritatively (larger change, also fixes SEC-1001 structurally), or (b) if client-reported outcome must remain, treat `record-login` failures as the only actionable signal for lockout purposes and require a short-lived, single-use, server-issued nonce (returned by `lockout-status`) that must be echoed back by `record-login`, so a bare `success:true` cannot be replayed without first having made a real pre-flight call tied to that attempt.
3. Regardless of (2), rate-limit `record-login` per (email) as well as per (ip) to bound the self-reset abuse pattern, and consider dropping the endpoint's ability to set `success:true` entirely (only failures need reporting for lockout purposes; successful sign-ins can be detected server-side via `GET /me`'s first-call-after-auth signal, as `MeController.trackIdentity` already approximates for analytics).
Suggested regression test: `apps/api/src/modules/iam/security.controller.spec.ts` — assert that posting `record-login` with a `userId` that does not match `email`'s real account either is rejected or is not persisted verbatim; assert that a `success:true` post from an IP with no prior `lockout-status`/failed-attempt correlation is not able to clear an existing lock for that `(email, ip)`.
Confidence: CONFIRMED

---

### SEC-1003
Title: Password strength policy (length + complexity) is enforced client-side only, with no server-side re-validation
Severity: MEDIUM
Affected component: `apps/web/lib/auth/password-strength.ts`, `apps/web/app/[locale]/(auth)/signup/page.tsx`, `apps/web/app/[locale]/(auth)/reset-password/page.tsx`, `apps/web/components/auth/auth-modal.tsx`
Affected profile(s): All (any new account or password change)
Affected page/API: `/signup`, `/reset-password`, guest-upgrade email/password form
Description:
`PASSWORD_MIN_LENGTH = 12` and the upper/lower/number/special-character checks in
`password-strength.ts` are implemented purely as a UI strength meter and an HTML `minLength`
attribute. Password creation/changes go straight to Supabase's `auth.signUp` / `auth.updateUser`
from the browser — there is no NestJS API endpoint in the path that could re-validate password
strength server-side. The only server-side enforcement is whatever Supabase/GoTrue's own
`minimum_password_length` and `password_requirements` project settings are. The repo's local
Supabase config declares `minimum_password_length = 6` and `password_requirements = ""` (no
complexity requirement) — six characters below, and structurally weaker than, what the UI
communicates to users. HTML `minLength` and client-side checks are trivially bypassed via
DevTools, a direct `fetch`/`curl` to GoTrue, or simply disabling JavaScript.
Attack scenario: An attacker (or a user via a compromised/modified client) calls
`supabase.auth.signUp({ email, password: "aaaaaa" })` directly, bypassing the 12-character/
complexity UI entirely; if production GoTrue's `minimum_password_length` is not independently
confirmed to be 12+ (the local `config.toml` in this repo says 6), a 6-character password with no
complexity requirement is accepted for an account holding passport and financial data.
Business impact: Weak, guessable passwords are possible for accounts on an immigration platform;
combined with SEC-1001 (no working brute-force protection on the real auth path), this widens the
credential-stuffing/brute-force attack surface materially.
Evidence:
- `apps/web/lib/auth/password-strength.ts:16-25` — `"AUTH-001: raised from 8 to 12 to match the Supabase project policy (password_min_length)."` `export const PASSWORD_MIN_LENGTH = 12;` — comment explicitly asserts a Supabase project-level policy this repo does not independently enforce or verify.
- `supabase/config.toml:188-190` — `minimum_password_length = 6` / `password_requirements = ""` (no complexity class required).
- `apps/web/lib/supabase/client.ts:90-98` — `signUp` calls `createClient().auth.signUp(...)` directly with no server-side pre-check.
- No API route in `apps/api/src/modules/**` performs password creation/validation — signup is 100% client→Supabase.
Root cause: Password policy lives only in the browser bundle; there is no trust boundary (server) that re-validates it, and the value asserted as matching "the Supabase project policy" is not actually configured to match in the config committed to this repo (production's true GoTrue setting is outside the repo and unverified here).
Remediation:
1. Confirm (and if necessary correct) the production self-hosted GoTrue's `GOTRUE_PASSWORD_MIN_LENGTH` / equivalent env var actually matches 12+ with a complexity class — this is an infrastructure-config check outside this repo, flagged here because the code's own comment claims parity that the committed config contradicts.
2. Update `supabase/config.toml` to `minimum_password_length = 12` and a `password_requirements` value (e.g. `lower_upper_letters_digits`) so the local/dev stack matches the intended policy and doesn't silently drift from production.
3. If any future server-side signup/password-change path is added (e.g., an admin-initiated reset), re-validate with `scorePassword`/equivalent logic server-side — never trust the client check alone.
Suggested regression test: An integration test against a local Supabase stack (`supabase/tests/` or equivalent) asserting `auth.signUp` with a 6-character password is rejected by GoTrue itself, not just by the UI.
Confidence: CONFIRMED (client-only enforcement is proven from source); the production-parity claim is PLAUSIBLE — flagged because the repo's own committed config contradicts the code comment's assumption, and production's actual GoTrue setting could not be verified from this repository.

---

### SEC-1004
Title: MFA step-up enforcement (`@RequireMfa`/`MfaGuard`) is fully implemented but applied to zero endpoints
Severity: MEDIUM
Affected component: `apps/api/src/modules/auth/mfa.guard.ts`, `apps/api/src/modules/iam/iam.controller.ts`
Affected profile(s): Admin, consultant, and any user who has enrolled TOTP
Affected page/API: All API endpoints, notably `POST /iam/users/:id/roles`, `DELETE /iam/users/:id/roles/:roleKey`
Description:
`MfaGuard` exists specifically to require `aal2` (a TOTP factor satisfied this session) on
sensitive actions — its own doc comment gives "role grants, payouts, destructive ops" as the
motivating examples. A repo-wide search for `@RequireMfa()` usage on any controller/handler
returns zero results outside the guard's own definition and its unit test. This means that even a
user who has enrolled MFA gets no additional protection anywhere in the product: an attacker
holding a stolen/replayed `aal1` session token (password-only) can perform every action in the
system, including granting themselves (or another account) `platform_admin`/`super_admin` via
`POST /iam/users/:id/roles`, with no step-up challenge.
Attack scenario: An attacker who obtains a valid `aal1` bearer token (e.g., via XSS, a leaked
token, or a session left open on a shared device) for a user who holds `iam.roles.manage` can call
`POST /iam/users/:id/roles` to grant `platform_admin` to any account, including their own, without
ever needing to pass an MFA challenge — even though the platform believes MFA is protecting
exactly this class of action.
Business impact: MFA enrollment provides a false sense of security for both users and the
engineering team; the highest-privilege action in the RBAC system (granting `platform_admin`/
`super_admin`) has no step-up requirement despite the codebase explicitly building that capability.
Evidence:
- `apps/api/src/modules/auth/mfa.guard.ts:20-24` — `"Require a second factor (aal2) on a handler/controller — step-up auth for sensitive actions (e.g. role grants, payouts, destructive ops)."`
- `apps/api/src/modules/iam/iam.controller.ts:53-63` — `@Post('users/:id/roles') @RequirePermission('iam.roles.manage') grant(...)` — no `@RequireMfa()` decorator present.
- `grep -rn "@RequireMfa\|RequireMfa()" apps/api/src --include="*.ts" | grep -v ".spec."` returns matches only inside `jwt.guard.ts` comments and `mfa.guard.ts`'s own definition — no controller applies it.
Root cause: The step-up primitive was built but never adopted at any call site; there is no lint rule, checklist, or test asserting that sensitive-permission endpoints carry `@RequireMfa`.
Remediation:
1. Apply `@RequireMfa()` to `IamController.grant` and `IamController.revoke` (role grant/revoke) at minimum.
2. Extend to other high-impact actions as they're identified (payouts, destructive admin ops, financial operations) per the guard's own stated purpose.
3. Add a lightweight architecture test (e.g., iterate Nest route metadata in a spec) asserting that every handler decorated with `@RequirePermission('iam.roles.manage')` or similar high-privilege permissions also carries `@RequireMfa()`, so this doesn't silently regress again.
Suggested regression test: `apps/api/src/modules/iam/iam.controller.spec.ts` — assert `POST /iam/users/:id/roles` returns 403 with `code: 'mfa_required'` for a caller whose token has `aal: 'aal1'` and the target permission granted.
Confidence: CONFIRMED

---

### SEC-1005
Title: `TokenCache.invalidate()` is dead code — no logout/role-change path ever clears a cached identity, so a revoked or role-changed session can remain valid at the API for up to `TOKEN_CACHE_TTL_MS`
Severity: LOW
Affected component: `apps/api/src/modules/auth/token-cache.ts`, `apps/api/src/modules/auth/jwt.guard.ts`, `apps/web/app/api/auth/signout/route.ts`
Affected profile(s): All
Affected page/API: All authenticated API routes (post sign-out / role change / ban)
Description:
`JwtGuard` caches a validated identity for `TOKEN_CACHE_TTL_MS` (default 30s) to avoid a GoTrue
round-trip on every request — a documented, deliberate, and reasonably small trade-off. The class
exposes `invalidate(token)` specifically "for an explicit sign-out path to call," but no code in
the repository ever calls it: the only `invalidate(...)` call sites found belong to an unrelated
service (`risk-config.service.ts`). The web app's sign-out route (`/api/auth/signout`) only calls
Supabase's own `auth.signOut()`, which revokes the refresh token but never talks to the NestJS API
at all, so there is no mechanism by which the API's cache — or GoTrue's own access-token validity
— is shortened on logout, role change, or admin ban.
Attack scenario: Low-severity/marginal on its own (the window is bounded at 30s by design, and
this matches the documented trade-off) — but it does mean the safety valve the code comments
promise ("Set it to 0 to disable the cache outright if that is unacceptable... a 30-second cache
keeps GoTrue as the authority") is currently unreachable via any real event in the product; a
security-relevant sign-out, ban, or role downgrade takes up to the full TTL to be observed by the
API, with no faster path even though one was built for that purpose.
Business impact: Minor increase in the exposure window after a deliberate account
lockout/role-downgrade/logout action; mostly a "the safety net that was built is not connected"
finding rather than an actively dangerous one at the default 30s TTL.
Evidence:
- `apps/api/src/modules/auth/token-cache.ts:97-100` — `/** Drop a specific token — for an explicit sign-out path to call. */ invalidate(token: string): void { this.entries.delete(TokenCache.key(token)); }`
- `grep -rn "tokenCache.invalidate\|\.invalidate(" apps/api/src --include="*.ts"` — only hits in `apps/api/src/modules/vri/risk-config.service.ts:78,91`, an unrelated service.
- `apps/web/app/api/auth/signout/route.ts:1-8` — `await supabase.auth.signOut()` — no call to the NestJS API at all.
Root cause: The invalidation hook was designed but never connected to an actual sign-out/role-change trigger.
Remediation:
1. Add a `POST /auth/signout` (or reuse an existing authenticated route) on the NestJS API that the web app's sign-out flow calls before/alongside `supabase.auth.signOut()`, so `TokenCache.invalidate(token)` actually fires.
2. For role changes/bans performed via `IamController.grant/revoke`, consider invalidating the affected user's cache entries proactively (requires indexing the cache by user id, not just token hash, or accepting the bounded TTL as sufficient for that case specifically).
3. If wiring this up is not prioritized, remove the misleading comment/dead API so the code doesn't assert a safety net that isn't connected.
Suggested regression test: `apps/api/src/modules/auth/token-cache.spec.ts` (extend) plus an e2e test asserting a token used successfully, then invalidated via the sign-out path, is rejected on the very next request rather than only after TTL expiry.
Confidence: CONFIRMED

---

### SEC-1006
Title: Auth audit trail is largely non-functional — `logout`, `password_changed`, `password_reset_requested`, `email_verified`, and `account_unlocked` events are modeled but never recorded; `login_success`/`login_failure`/`account_locked` are only recorded via the dead endpoint from SEC-1001
Severity: LOW
Affected component: `apps/api/src/modules/iam/security.service.ts`, `packages/types/src/index.ts`, all web auth flows
Affected profile(s): All
Affected page/API: `GET /me/login-history`, `auth_audit_log` table generally
Description:
`AuthAuditEventType` defines nine event types intended to build a security-relevant history:
`login_success`, `login_failure`, `logout`, `password_reset_requested`, `password_changed`,
`email_verified`, `account_locked`, `account_unlocked`, plus role/org events. A repo-wide search
for each event type's string literal, outside of its type definition, shows:
- `mfa_enabled` / `mfa_disabled` — correctly recorded (`mfa-section.tsx` → `recordMfaEvent` → `POST /me/mfa/event`).
- `login_success` / `login_failure` / `account_locked` — only ever recorded inside
  `SecurityService.recordAttempt`, which is only reachable from `POST /auth/record-login` — a
  route the frontend never calls (SEC-1001).
- `logout`, `password_changed`, `password_reset_requested`, `email_verified`,
  `account_unlocked` — **no call site anywhere in the repository** records these, ever.
Attack scenario: N/A directly exploitable — this is a detective-control gap, not an access-control
bypass. It compounds SEC-1001/SEC-1002: an operator investigating a suspected account compromise
(e.g., "when did this password get changed, and did the user actually log out anywhere before the
suspicious activity?") has no data to consult for any of these events in `auth_audit_log`, and
`GET /me/login-history` will typically be empty even for actively-used accounts.
Business impact: Materially degrades incident-response capability on a platform handling
immigration case data — there is currently no way to answer "was this a legitimate password
change" or "did the account owner log out before this happened" from the data the product
collects, despite the schema being built for exactly that purpose.
Evidence:
- `packages/types/src/index.ts:1892-1907` — full `AuthAuditEventType` union including `'logout' | 'password_reset_requested' | 'password_changed' | 'email_verified' | ... | 'account_unlocked'`.
- `grep -rn "recordEvent(" apps/api/src --include="*.ts" | grep -v ".spec."` — only 3 call sites: `security.service.ts:92` and `:100` (both inside `recordAttempt`, reachable only via the dead `record-login` route) and `mfa.controller.ts:50` (the one correctly-wired path).
- `grep -rn "password_changed\|email_verified\|password_reset_requested\|account_unlocked" apps/api/src apps/web` — no hits outside the type definition file itself.
Root cause: Only the MFA event-reporting call site was completed end-to-end; the equivalent client-side "report this security event after the Supabase op completes" call was never added for logout, password change, password-reset request, or email verification.
Remediation:
1. Add a `POST /me/security-event` (or reuse the MFA event pattern per event type) call from: `apps/web/app/api/auth/signout/route.ts` (logout), `apps/web/app/[locale]/(auth)/reset-password/page.tsx` after a successful `updateUserPassword` (password_changed), `apps/web/app/[locale]/(auth)/forgot-password/page.tsx` after a successful `resetPasswordForEmail` (password_reset_requested).
2. For `email_verified`, use a Supabase auth webhook/DB trigger on `auth.users.email_confirmed_at` transitioning non-null, since the client may not be present at the moment confirmation completes (user clicks the email link, possibly on a different device).
3. Fix SEC-1001 first, since `login_success`/`login_failure`/`account_locked` depend on the same call path.
Suggested regression test: For each newly-wired event, an integration test asserting the corresponding row appears in `auth_audit_log` after the action (e.g., sign-out → `GET /me/login-history`-adjacent audit query shows a `logout` row for that user).
Confidence: CONFIRMED

---

### SEC-1007
Title: "Remember me" checkbox on the login page has no effect — session persistence is unconditional
Severity: LOW
Affected component: `apps/web/app/[locale]/(auth)/login/page.tsx`
Affected profile(s): All, particularly users on shared/public devices
Affected page/API: `/login`
Description:
The login form includes a "Remember me" checkbox (`checked={remember}` default `true`) and, on
submit, stores the choice: `localStorage.setItem('va.remember', String(remember))`. No other code
in the repository reads `va.remember`. The Supabase browser client (`createClient()` in
`apps/web/lib/supabase/client.ts`) is configured with default session persistence regardless of
this value, so unchecking "Remember me" has zero effect on how long the session survives browser
restarts.
Attack scenario: A user on a shared/public computer unchecks "Remember me" believing this reduces
their exposure if they forget to sign out, and closes the browser expecting the session not to
persist. The session persists exactly as if the box had been checked, leaving an active,
usable session on the shared device.
Business impact: Misleads users about the security posture of their own session on an immigration
platform handling sensitive personal documents; low severity because it requires a shared-device
scenario, but the control is presented to the user as functional when it is inert.
Evidence:
- `apps/web/app/[locale]/(auth)/login/page.tsx:31` — `localStorage.setItem('va.remember', String(remember))`
- `grep -rn "va.remember" apps/web --include="*.ts" --include="*.tsx"` — only the one write site; no read site anywhere.
- `apps/web/lib/supabase/client.ts:49-58` — `createBrowserClient(...)` has no conditional persistence option tied to this flag.
Root cause: The UI control was built but never wired to the Supabase client's session-persistence configuration.
Remediation: Either (a) wire `remember` into `createBrowserClient`'s `auth.persistSession`/storage
choice (e.g., use `sessionStorage`-backed cookie lifetime when unchecked, matching what the
checkbox promises), or (b) remove the checkbox if unconditional persistence is the intended
product behavior, so the UI doesn't promise a control that doesn't exist.
Suggested regression test: `apps/web/app/[locale]/(auth)/login/__tests__/remember-me.test.tsx` —
assert that submitting with `remember=false` results in a session that does not survive a
simulated new browser session (or, if the remediation is to remove the control, assert it is
gone).
Confidence: CONFIRMED

---

### SEC-1008
Title: Signup enumerates existing accounts, inconsistent with the anti-enumeration design used on login and forgot-password
Severity: MEDIUM
Affected component: `apps/web/app/[locale]/(auth)/signup/page.tsx`, `apps/web/components/auth/auth-modal.tsx`
Affected profile(s): All prospective/existing users
Affected page/API: `/signup`, guest-upgrade email form (`AuthModal`)
Description:
`/login` and `/forgot-password` are explicitly designed to avoid confirming whether an email is
registered (`/login` always shows a generic `invalidCredentials` message regardless of cause;
`/forgot-password`'s own comment states "Supabase does not error on unknown emails
(anti-enumeration)... always show the generic confirmation"). `/signup`, by contrast, surfaces
Supabase's raw error message to the user on failure
(`setError(error instanceof Error ? error.message : t('errSignupFailed'))`), and `AuthModal` goes
further, explicitly pattern-matching that message
(`/registered|already|exists|taken|in use/`) to branch the UI into a distinct "That email already
has an account" / "Log in to that account" state. For an already-confirmed account, Supabase's
`signUp` returns a distinguishable "already registered" error, which this code detects and surfaces
by design.
Attack scenario: An attacker submits a candidate email address to `/signup`; a response indicating
"That email already has an account" confirms the address is a registered VisaAI user, distinct
from an email that is not. This can be scripted to enumerate which email addresses belong to
VisaAI users.
Business impact: On an immigration-services platform, confirming that a specific email address is
a registered user is itself a mild privacy disclosure (it can reveal that a specific person is
using immigration/visa services), and is useful reconnaissance ahead of a targeted credential-
stuffing or phishing attempt against that specific account. Severity is tempered by the fact that
this endpoint is subject to whatever signup rate limiting Supabase/GoTrue applies (not verified in
this repo) and that this is a deliberate product UX decision (offering "log in instead") rather
than an oversight — but it is inconsistent with the anti-enumeration stance taken everywhere else
in the auth surface.
Evidence:
- `apps/web/app/[locale]/(auth)/signup/page.tsx:43-49` — `const { error } = await signUp({ email, password, fullName }); if (error) { setError(error instanceof Error ? error.message : t('errSignupFailed')) ... }`
- `apps/web/components/auth/auth-modal.tsx:120-132` — `if (/registered|already|exists|taken|in use/.test(msg)) { setCollision(true); setError('That email already has an account.') }`
- Contrast: `apps/web/app/[locale]/(auth)/forgot-password/page.tsx:26-27` — `"Supabase does not error on unknown emails (anti-enumeration). Only surface genuine transport failures; otherwise always show the generic confirmation."`
- Contrast: `apps/web/app/[locale]/(auth)/login/page.tsx:35-36` — `if (error) { setError(t('invalidCredentials')) ... }` — same message for every failure cause.
Root cause: Signup's error handling was implemented independently from login/forgot-password and was not held to the same anti-enumeration standard, likely because the "email already taken, log in instead" UX is genuinely useful and the tradeoff was made (implicitly) without being reconciled against the stricter posture elsewhere.
Remediation: This is a product tradeoff as much as a bug — options in order of strength: (1) Keep a generic response like forgot-password's ("Check your email to continue") that behaves identically whether or not the address is registered, and let a genuinely-existing user discover the collision only after clicking through and attempting sign-in (weakens UX, strongest against enumeration); or (2) if the current UX is intentional, rate-limit `/signup` submissions per-IP more aggressively than general traffic and monitor for enumeration-pattern traffic (many distinct emails, few complete signups) as a compensating control, and document this as an accepted, deliberate exception to the platform's anti-enumeration stance rather than an oversight.
Suggested regression test: N/A for "no behavior change" outcome if the team accepts the tradeoff; if remediated per option (1), add `apps/web/app/[locale]/(auth)/signup/__tests__/no-enumeration.test.tsx` asserting identical UI state for a registered vs. unregistered email.
Confidence: CONFIRMED

---

### SEC-1009
Title: Supabase session cookies used by the browser client are JS-readable (not HttpOnly) by architectural design
Severity: INFORMATIONAL
Affected component: `apps/web/lib/supabase/client.ts`, `apps/web/proxy.ts`
Affected profile(s): All
Affected page/API: All authenticated pages
Description:
`apps/web/lib/supabase/client.ts` uses `createBrowserClient` from `@supabase/ssr`, which persists
the Supabase session in cookies that the browser-side JS client must be able to read/write (so it
can call `supabase.auth.getSession()` and attach `Authorization: Bearer <token>` to API calls).
These cookies are therefore not `HttpOnly`, unlike a traditional server-only session cookie. This
is an inherent, documented trade-off of the `@supabase/ssr` cookie-based architecture (needed so
both `proxy.ts`/server components and the browser client can share one session), not a
misconfiguration introduced by this codebase — but it means a successful XSS anywhere in the
`apps/web` origin could read the session token directly from `document.cookie` rather than needing
a more roundabout exfiltration technique.
Attack scenario: N/A as a standalone finding — requires a separate XSS vulnerability (not found in
this authentication-focused pass) to be exploitable. Recorded for completeness per the audit's
explicit ask about cookie flags/token storage.
Business impact: Residual defense-in-depth gap that only matters in combination with an XSS bug
elsewhere in the app; not independently actionable.
Evidence:
- `apps/web/lib/supabase/client.ts:49-58` — `createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { lock: inMemoryLock } })` — standard `@supabase/ssr` browser client, JS-accessible cookie storage by design.
- `apps/web/proxy.ts:48-66` — server-side `createServerClient` reads/writes the same `sb-` prefixed cookies via `request.cookies`/`response.cookies`, confirming the shared, JS-writable cookie jar.
Root cause: Architectural necessity of the `@supabase/ssr` shared-cookie session model; not a code defect.
Remediation: No change recommended specific to this finding — mitigate the actual risk (XSS) through standard CSP/output-encoding hygiene elsewhere in the app (outside this audit's authentication scope). If a future architecture change is considered, a BFF (backend-for-frontend) pattern with HttpOnly-only cookies and no client-side Supabase SDK would remove this residual surface entirely, at significant cost to the current client-side auth architecture.
Suggested regression test: N/A (informational; no code defect to regress-test).
Confidence: CONFIRMED (architecture as described); no exploit path identified within this audit's scope.

---

## Summary of what was verified as NOT a finding (for completeness)

- `apps/web/lib/auth/safe-next.ts` — open-redirect protection on the OAuth/recovery `next` param is sound (blocks `//`, `/\`, `/%5C`, non-root-relative targets).
- `apps/web/app/callback/route.ts` — PKCE code exchange result (`error`) is checked and handled; previously-silent failures are fixed.
- `apps/web/app/[locale]/(dashboard)/layout.tsx` — correctly performs a real server-side `supabase.auth.getUser()` call (not client-decoded) and explicitly blocks anonymous/guest identities from the authenticated dashboard.
- `apps/web/lib/auth/require-role.ts` — server-side RBAC gate resolves role via `GET /me` (server, source of truth), never decodes the JWT client-side.
- `apps/api/src/modules/auth/jwt.guard.ts` — token signature/validity is verified via `supabase.admin.auth.getUser(token)`, a real network round-trip to GoTrue (not a local decode) on every non-cache-hit request; anonymous identities are fail-closed by default and require explicit `@AllowAnonymous`.
- `@AllowAnonymous` usage across `feature-flags`, `marketplace/discovery` (browse/detail/reviews-read only, not reviews-write), `intake`, `me`, and `analytics/collect|identify` is scoped consistently with the decorator's documented intent; sensitive controllers (`voice`, `consultations`, `feedback`) explicitly opt out with matching justification comments.
- `apps/web/lib/api/client.ts` — bearer tokens are always sent via the `Authorization` header, never as a URL/query parameter.
- `/forgot-password` — genuinely anti-enumeration (generic confirmation regardless of whether the email exists).
