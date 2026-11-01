# VisaAI Web Frontend Security Audit — Wave 1

**Scope**: `apps/web` only (Next.js 16 App Router, ~58 pages under `app/[locale]/`, route groups
`(public)/(auth)/(onboarding)/(dashboard)/(consultant)/(admin)`, Supabase auth, `typedRoutes: true`,
`proxy.ts` as the Next 16 middleware). NestJS API internals and the database/RLS layer are explicitly
out of scope (owned by other audit agents) except where web-tier code touches them directly.

**Method**: static, read-only source review. No file was edited. Every claim below is evidence-backed
with `path:line`. Where I could not verify a runtime property (e.g. actual `Set-Cookie` headers served
by nginx in production, or the Chrome extension's `externally_connectable` manifest), I marked it
`UNVERIFIED` or scoped the claim to what the code shows.

**Branch at time of audit**: `security/master-audit-2026-08-16` (HEAD `1381535`).

---

## A. Page inventory

58 routes under `app/[locale]/` (route-group folders `()` are not part of the URL). Enforcement
column states the actual mechanism in code, not intent.

| Route (URL, locale prefix omitted) | Group | Auth required | Role | Enforced by |
|---|---|---|---|---|
| `/` | (dashboard) | Yes (non-anonymous) | any authenticated user | `(dashboard)/layout.tsx:9-16` session+`is_anonymous` check |
| `/become-a-consultant` | (dashboard) | Yes | user | same dashboard layout |
| `/billing` | (dashboard) | Yes | user | same |
| `/consultants` , `/consultants/[id]` | (dashboard) | Yes | user | same |
| `/developers` | (dashboard) | Yes | user | same |
| `/documents/[applicationId]` | (dashboard) | Yes | user | same + page-level `if (!user) redirect('/login')` (`(dashboard)/documents/[applicationId]/page.tsx:9-10`), data scoped by RLS via `lib/supabase/server.ts` |
| `/messages`, `/messages/[applicationId]` | (dashboard) | Yes | user | dashboard layout |
| `/my-applications`, `/my-applications/[id]` | (dashboard) | Yes | user | dashboard layout |
| `/narrative/[applicationId]` | (dashboard) | Yes | user | dashboard layout |
| `/organizations`, `/organizations/[id]` | (dashboard) | Yes | user | dashboard layout |
| `/prefill/[applicationId]` | (dashboard) | Yes | user | dashboard layout |
| `/profile` | (dashboard) | Yes | user | dashboard layout |
| `/readiness/[applicationId]` | (dashboard) | Yes | user | dashboard layout |
| `/submission/[applicationId]` | (dashboard) | Yes | user | dashboard layout |
| `/welcome`, `/welcome/profile`, `/welcome/application` | (onboarding) | Yes | user, not yet onboarded | `(onboarding)/layout.tsx:7-11` session check + `onboarded_at` redirect |
| `/applications/new` | (public) | No (guest-capable) | any / none | `(public)/layout.tsx` never redirects; `proxy.ts:112-113` whitelists it; sensitive sections client-blurred via `GatedRegion` (UI-only, documented as such) |
| `/intake/[applicationId]` | (public) | No (guest-capable) | any / none | same; data read is RLS-scoped (`(public)/intake/[applicationId]/page.tsx:12-18`) |
| `/login`, `/signup` | (auth) | No (public) | — | `proxy.ts:104,114-121`; permanent users bounced away at `proxy.ts:131` |
| `/forgot-password`, `/reset-password` | (auth) | No (public) | — | `proxy.ts:105-106,114-121` |
| `/admin`, `/admin/billing`, `/admin/coupons` | (admin) | Yes | **admin only** | `(admin)/layout.tsx:11` `requireRole(['admin'])` |
| `/analytics/ai\|alerts\|consultant\|executive\|financial\|journey\|visa`, `/analytics/reports`, `/analytics/reports/[id]/runs/[runId]` | (admin) | Yes | **admin only** | same, wrapped additionally by `(admin)/analytics/layout.tsx` (nav-only, does not weaken the parent gate) |
| `/applications`, `/applications/[id]` (admin view) | (admin) | Yes | **admin only** | same |
| `/assignments` | (admin) | Yes | **admin only** | same |
| `/audit` | (admin) | Yes | **admin only** | same |
| `/broadcasts` | (admin) | Yes | **admin only** | same |
| `/consultant-review` | (admin) | Yes | **admin only** | same |
| `/notification-ops`, `/notification-templates` | (admin) | Yes | **admin only** | same |
| `/users`, `/users/[id]` | (admin) | Yes | **admin only** | same |
| `/consultant/dashboard`, `/consultant/applications`, `/consultant/application/[id]`, `/consultant/payouts` | (consultant) | Yes | **consultant** (admin also allowed) | `(consultant)/layout.tsx:11` `requireRole(['consultant'])` |
| `/forbidden` | top-level | No (public, error page) | — | `proxy.ts:107-108,114-121` |
| `/invite/accept` | top-level | Yes (non-anonymous) | invited email holder | page-level `if (!user \|\| user.is_anonymous) redirect('/login')` (`app/[locale]/invite/accept/page.tsx:17-18`) — **not** in `proxy.ts`'s public list, so proxy also forces auth first (defense-in-depth, redundant but correct) |
| `/pricing` | top-level | No (public) | — | `proxy.ts:109-111,114-121` |
| `/privacy`, `/terms` | top-level | No (public) | — | `proxy.ts:107-108,114-121` |

**Row count: 58 pages**, matching the brief. All 58 resolve to one of: public-by-design, any-authenticated-user, or `requireRole()`-gated. No page was found with a data-fetching path that skips both the route-group layout guard and RLS.

`requireRole()` (`lib/auth/require-role.ts:14-33`) resolves role from `GET /me` on the NestJS API using the caller's own session token — **it never trusts a client-decoded JWT or app_metadata read in the browser**. `me.appRole === 'admin'` always passes every gate (line 30), matching the comment "admin also allowed" on the consultant layout.

`proxy.ts`'s matcher (`proxy.ts:136-153`) excludes only static assets (`_next/static`, `_next/image`, `favicon.ico`, `robots.txt`, `sitemap.xml`, `.well-known`, and image/zip extensions) — every actual page path is covered. The matcher itself does **not** do role-based gating; it only enforces "must be authenticated (including anonymous-guest) to reach a non-public path" and bounces permanent users off `/login`+`/signup`. Fine-grained role checks are correctly pushed down to route-group layouts, which is a sound split of responsibilities (coarse edge gate + precise server-rendered gate), not a gap.

---

## B. CSP / security headers — exact current configuration

**There is no Content-Security-Policy, and no security headers of any kind, set anywhere in `apps/web`.**

- `next.config.ts` (full file, `apps/web/next.config.ts:1-17`) contains no `headers()` function at all:
```ts
const nextConfig: NextConfig = {
  typedRoutes: true,
}
export default withNextIntl(nextConfig)
```
- `proxy.ts` (the Next 16 middleware) only ever touches `response.cookies` (`proxy.ts:56-63`, `proxy.ts:100`) — it never calls `response.headers.set(...)` for anything. Confirmed by grep: the only `NextResponse` call sites in the file are `NextResponse.next({ request })` (line 43), `handleI18n(request)` (line 44), and `NextResponse.redirect(...)` (line 99) — none attach headers.
- No `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Permissions-Policy`, or `Referrer-Policy` string appears anywhere in `apps/web`'s TypeScript/JS source (`grep -rn "Content-Security-Policy\|X-Frame-Options\|frame-ancestors\|Strict-Transport-Security\|X-Content-Type-Options\|Permissions-Policy"` returns zero matches outside `node_modules`).
- No `<meta http-equiv="Content-Security-Policy">` tag exists in `app/[locale]/layout.tsx` or any other layout.

Whether nginx on the VPS adds any of these headers in front of the Next.js origin is **UNVERIFIED** — no nginx config is present in this repo checkout under `infra/` that sets them, but that reverse-proxy layer is outside this repo/scope and I have no access to the live VPS config. Per the brief ("the web app is a separate origin — check it independently"), the finding stands on its own: the Next.js application itself ships zero header hardening. See SEC-8002.

---

## C. `NEXT_PUBLIC_*` inventory

11 distinct variables referenced in `apps/web` source (`grep -rhoE "NEXT_PUBLIC_[A-Z0-9_]+"`):

| Variable | Used at | Verdict |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `lib/supabase/client.ts:52`, `lib/supabase/server.ts:8`, `proxy.ts:49` | **Safe.** Project URL is meant to be public; access is governed by RLS + the anon key's restricted grants. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | same files | **Safe by design.** Supabase's anon key is meant to be shipped to browsers; it has no privileges beyond what RLS policies grant. `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_JWT_SECRET` (the actually dangerous keys) were grepped for across all of `apps/web`'s `.ts`/`.tsx` source and **zero references** were found — the service-role key is never imported into web code. |
| `NEXT_PUBLIC_API_URL` | `lib/api/client.ts:1`, `lib/socket.ts:15`, `hooks/use-application-stream.ts` (via `lib/sse-stream.ts:4`), many client components | **Safe.** Just the NestJS API's public base URL. |
| `NEXT_PUBLIC_SITE_URL` | `app/[locale]/layout.tsx:40`, `lib/supabase/client.ts:135`, `app/callback/route.ts:14`, `app/api/auth/signout/route.ts:7`, `lib/seo/structured-data.ts:13`, `app/sitemap.ts:13` | **Safe.** Public canonical origin, used for metadata/redirects. |
| `NEXT_PUBLIC_EXTENSION_ID` | `app/[locale]/(dashboard)/submission/[applicationId]/submission-client.tsx:36` | **Safe.** A Chrome extension ID is not a secret — it's required to be public for any page to message the extension via `chrome.runtime.sendMessage(extensionId, …)`, and Chrome's `externally_connectable` manifest restriction (in the extension, out of this audit's scope) is the actual access boundary, not secrecy of the ID. |
| `NEXT_PUBLIC_CHROME_WEB_STORE_URL` | same file, line 46 | **Safe.** Public marketing URL. |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `lib/notifications/push-manager.ts:25` | **Safe by design.** Web Push VAPID *public* keys are meant to be shipped to the browser (the private key stays server-side; not found referenced anywhere in `apps/web`). |
| `NEXT_PUBLIC_ANALYTICS_ENABLED` | `lib/analytics/client.ts:12` | **Safe.** Feature flag, boolean. |
| `NEXT_PUBLIC_ANALYTICS_MAX` | `lib/analytics/client.ts:14` | **Safe.** Numeric buffer-size tuning constant. |
| `NEXT_PUBLIC_ANALYTICS_URL` | `lib/analytics.ts:37` | **Safe.** Public collector endpoint URL. |
| `NEXT_PUBLIC_APP_VERSION` | referenced in source (build metadata) | **Safe.** Version string. |

**No `NEXT_PUBLIC_*` variable found carrying a secret, service-role key, admin token, or privileged credential.** The `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` name appears in `apps/web/.env.local` and `.env.local.example` but is **not referenced anywhere in `apps/web`'s actual source** (dead/unused var — the `stripe` npm package is also a declared dependency in `apps/web/package.json:28` but has zero import sites in the app; only `@stripe/stripe-js` (`package.json:17`, publishable-key client SDK) would be the appropriate one to use, and even that has no call sites found). Not a vulnerability — flagged as dead-code hygiene only.

See **SEC-8004** for a related but distinct finding: privileged *non*-public secrets living in `apps/web/.env.local` (not shipped to the browser, not committed to git, but co-located in the wrong app directory).

---

## Findings

### SEC-8001
Title: Automation hand-off token (drives government-portal auto-fill) is logged to the browser console in production
Severity: HIGH
Affected component: Chrome-extension hand-off bridge
Affected profile(s): any authenticated applicant using "Submit" with the VisaAI Chrome extension installed
Affected page/API: `/submission/[applicationId]` (`app/[locale]/(dashboard)/submission/[applicationId]/submission-client.tsx`)
Description: `handleLaunch()` calls `POST /automation/${applicationId}/session`, receives a fresh `{ sessionId, token }`, and hands `token` to the installed Chrome extension via `chrome.runtime.sendMessage`. The helper that performs this call, `sendToExtension()`, unconditionally logs the **entire message object — including the raw token** — to the browser console on both the success and error paths, with no `NODE_ENV`/production gate (contrast with `lib/analytics.ts:42`, which does gate its own `console.debug` behind `process.env.NODE_ENV !== 'production'`).
Attack scenario: The token is not exposed to a remote network attacker directly, but it lands in the authenticated user's own DevTools console, which is a well-established target for (a) "paste this into your console" social-engineering scams that specifically harvest exactly this kind of printed credential, (b) any third-party or malicious browser extension with console/devtools-adjacent permissions, (c) session-replay/support-screenshare tooling that captures console output, and (d) any future XSS on the page (see SEC-8002) reading `console` history via injected instrumentation. Anyone who obtains this token can drive the automation session for that application (`/automation/session/${sessionId}` is polled with it) — a bearer credential purpose-built to auto-fill the user's identity/passport data into a live government immigration portal.
Business impact: Compromise of one automation-session token yields control over the auto-fill/submission flow for one applicant's live government visa application, including exposure of the passport/identity data that flow carries. Given VisaAI's stated threat model (multi-tenant platform handling passports and identity documents), this is a direct hit on the platform's highest-sensitivity data path.
Evidence:
```ts
// app/[locale]/(dashboard)/submission/[applicationId]/submission-client.tsx:51-71
function sendToExtension<T>(message: unknown): Promise<T | null> {
  return new Promise((resolve) => {
    const runtime = window.chrome?.runtime
    if (!runtime || !EXTENSION_ID) return resolve(null)
    try {
      runtime.sendMessage(EXTENSION_ID, message, (response) => {
        // chrome.runtime.lastError fires when the extension isn't installed
        // (or doesn't allow this origin) — that's our "missing" signal.
        if (runtime.lastError) {
          console.warn('[VisaAI] extension sendMessage error:', runtime.lastError.message, 'for message:', message)
          return resolve(null)
        }
        console.debug('[VisaAI] extension response:', response, 'for message:', message)
        resolve((response as T) ?? null)
      })
    } catch (err) {
      console.error('[VisaAI] extension sendMessage threw:', err)
      resolve(null)
    }
  })
}
```
```ts
// app/[locale]/(dashboard)/submission/[applicationId]/submission-client.tsx:163-173
// Hand the token straight to the extension. The extension stores it and
// badges its toolbar icon — the user clicks the icon once to open the
// side panel, which auto-connects from the stored session. Chrome
// requires the side panel be opened by a direct user gesture inside the
// extension's context, which the toolbar click satisfies.
const handed = await sendToExtension<{ ok?: boolean; detail?: string }>({
  type: 'session',
  token: data.token,
  apiUrl,
  portalUrl: portalUrl.trim() || undefined,
})
```
Root cause: `sendToExtension`'s diagnostic logging prints its full `message` argument unconditionally instead of a redacted summary, and `handleLaunch` passes the live credential as a field of that same object.
Remediation: Never pass secrets through the object that gets logged — log a redacted view (e.g. `{ type: message.type }` or `{ ...message, token: message.token ? '[present]' : undefined }`), and gate any remaining diagnostic `console.*` calls behind a non-production check, matching the existing pattern in `lib/analytics.ts:42`.
Suggested regression test: a unit/DOM test that stubs `window.chrome.runtime.sendMessage`, spies on `console.debug`/`console.warn`, drives `handleLaunch()`, and asserts no logged argument contains the string equal to the token issued by the mocked `/automation/.../session` response.
Confidence: CONFIRMED

---

### SEC-8002
Title: No Content-Security-Policy or any other security headers are set at the Next.js web tier
Severity: HIGH
Affected component: `next.config.ts`, `proxy.ts` (entire web origin — every route)
Affected profile(s): all — anonymous, guest, applicant, consultant, admin
Affected page/API: every page served by `apps/web`
Description: Neither `next.config.ts` nor `proxy.ts` (the Next 16 middleware) sets `Content-Security-Policy`, `X-Frame-Options`/`frame-ancestors`, `X-Content-Type-Options`, `Strict-Transport-Security`, `Referrer-Policy`, or `Permissions-Policy`. See section B above for the full verification. This is a passports/identity-document platform shipping zero baseline header hardening from the application itself.
Attack scenario: (1) No CSP means there is no defense-in-depth against script injection — if any future code path (a new `dangerouslySetInnerHTML`, a compromised npm dependency, a reflected value rendered unsafely) introduces XSS, there is nothing to contain it: no `script-src` restriction, no `connect-src` allowlist to block exfiltration to an attacker origin. (2) No `frame-ancestors`/`X-Frame-Options` means any third-party site can embed VisaAI pages in an `<iframe>` for UI-redress/clickjacking. This sub-risk is **partially** mitigated today because the Supabase session cookie is `sameSite: 'lax'` (see SEC-8003) — Lax cookies are generally not sent on cross-site iframe subresource loads in current major browsers, so a naive "framed and already logged in" clickjack against sensitive actions is reduced — but this is an accidental, browser-implementation-dependent mitigation, not a policy the app controls, and it does not protect the logged-out/guest public funnel from UI redress at all.
Business impact: The absence of CSP is the single biggest amplifier of any other frontend finding in this report (SEC-8001's console-logged token, or any future XSS) — it is the safety net that is supposed to catch exactly that class of bug, and it does not exist.
Evidence:
```ts
// apps/web/next.config.ts (full file)
import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'
const withNextIntl = createNextIntlPlugin('./i18n/request.ts')
const nextConfig: NextConfig = {
  typedRoutes: true,
}
export default withNextIntl(nextConfig)
```
`proxy.ts` header-related calls, confirmed exhaustive by reading the whole file (`apps/web/proxy.ts:1-154`): only `response.cookies.set(...)` (lines 61-62), `response.cookies.getAll()` (line 100), `NextResponse.next({ request })` (line 43), `NextResponse.redirect(...)` (line 99) — no `.headers.set` call exists anywhere in the file.
Root cause: header hardening was never implemented at the Next.js layer; nothing in the repo compensates (no nginx config present in-repo either, though that layer is outside this audit's file scope).
Remediation: Add a `headers()` export to `next.config.ts` (or set headers in `proxy.ts` on the returned `response`) covering at minimum: `Content-Security-Policy` (start with a strict `default-src 'self'`, explicit `script-src`/`connect-src` allowlist for the API origin and analytics collector, `frame-ancestors 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security` (if not already set by nginx — verify with the infra owner first to avoid duplicate/conflicting headers).
Suggested regression test: an integration test (or the existing Playwright e2e suite) that requests a representative page and asserts the response includes `Content-Security-Policy` and `X-Frame-Options`/`frame-ancestors` headers.
Confidence: CONFIRMED (for the web-tier gap); UNVERIFIED whether nginx compensates at the reverse-proxy layer.

---

### SEC-8003
Title: Supabase session tokens are stored in non-`httpOnly`, script-writable cookies with no explicit `Secure` attribute set by the app
Severity: MEDIUM
Affected component: `lib/supabase/client.ts` (browser Supabase client) via `@supabase/ssr@^0.10.3`
Affected profile(s): all authenticated users (applicant, consultant, admin) and guests
Affected page/API: every page — session storage is global
Description: `createClient()` in `lib/supabase/client.ts:49-58` calls `createBrowserClient(url, anonKey, { auth: { lock: inMemoryLock } })` with **no `cookieOptions` override**. `@supabase/ssr`'s browser client defaults to storing the session (access + refresh tokens) via `document.cookie`, using `DEFAULT_COOKIE_OPTIONS = { path: '/', sameSite: 'lax', httpOnly: false, maxAge: 400 days }` (verified directly in the installed package). `httpOnly: false` is intrinsic to this approach — client JS must be able to write the cookie for the SPA auth flow to work — but it means the session is exactly as reachable by any script running on the page as `localStorage` would be. No `secure` attribute is set by the app either, so nothing in the web code itself forces the cookie off plain HTTP.
Attack scenario: This is not itself an exploitable bug — it requires another vulnerability (XSS) to matter. But combined with SEC-8002 (no CSP to contain such a bug), it means any future XSS anywhere on the site is a full session takeover via `document.cookie`, not a contained information leak. This is exactly the well-known "cookie-as-storage" trade-off `@supabase/ssr` makes for SPA/SSR interop, and it raises the stakes of keeping the XSS surface at zero.
Business impact: Amplifies the severity of any future XSS finding from "annoying" to "full account/session compromise," on a platform whose sessions gate access to passport and identity-document data.
Evidence:
```ts
// apps/web/lib/supabase/client.ts:49-58
export function createClient() {
  if (!supabaseClient) {
    supabaseClient = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { lock: inMemoryLock } }
    )
  }
  return supabaseClient
}
```
```js
// apps/web/node_modules/@supabase/ssr/dist/module/utils/constants.js:1-8
export const DEFAULT_COOKIE_OPTIONS = {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 400 * 24 * 60 * 60,
};
```
```js
// apps/web/node_modules/@supabase/ssr/dist/module/createBrowserClient.js:18-21
const { storage } = createStorageFromOptions({
    ...options,
    cookieEncoding: options?.cookieEncoding ?? "base64url",
}, false); // falls through to documentCookieSetAll when no `cookies` option is passed
```
Root cause: default library behavior, not overridden by the app; this is a reasonable default for the SPA + SSR architecture in use, but it was not explicitly reviewed/hardened (e.g. no `cookieOptions: { secure: true }` set even though the app is HTTPS-only in production per `CLAUDE.md`).
Remediation: Pass `cookieOptions: { secure: true, sameSite: 'lax' }` explicitly to `createBrowserClient` (and the matching server-side clients in `lib/supabase/server.ts` / `proxy.ts`) so the intent is enforced in code rather than relying on the library default; treat XSS-prevention (CSP, no `dangerouslySetInnerHTML` with untrusted input) as the primary control since `httpOnly` cannot be added without breaking the client SDK's ability to read its own session.
Suggested regression test: N/A (config verification) — add a lint/CI check that greps for `createBrowserClient(` and fails if `cookieOptions` is absent, or a runtime assertion in a smoke test that inspects `document.cookie` flags via a headless browser.
Confidence: CONFIRMED

---

### SEC-8004
Title: Privileged non-public secrets (service-role key, JWT secret, Stripe secret, OpenAI key, Redis token) are colocated in `apps/web/.env.local`, sourced from a template that mixes API-only secrets into the web app's example file
Severity: LOW
Affected component: local/VPS environment files, not the shipped browser bundle
Affected profile(s): N/A (not a runtime/browser exposure)
Affected page/API: N/A
Description: `apps/web/.env.local` (gitignored, confirmed untracked — `git ls-files | grep -i env` only returns `.env.example` files) declares, among the expected `NEXT_PUBLIC_*` vars, the following **non-public** variable names: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `UPSTASH_REDIS_REST_TOKEN`, `PORT`, `WEB_URL`, `REDIS_URL` — none of which are referenced anywhere in `apps/web`'s source (confirmed: `grep -rn "SERVICE_ROLE\|service_role\|JWT_SECRET"` across `apps/web` returns zero hits, and none of these names appear in the `NEXT_PUBLIC_*` grep results in section C). These are `apps/api`-only concerns per `CLAUDE.md`. The apparent source is `apps/web/.env.local.example`, which itself mixes API secrets and web vars:
```
# apps/web environment template — PLACEHOLDERS ONLY. Never put real secrets here.
...
STRIPE_SECRET_KEY=sk_test_<your-stripe-secret-key>
STRIPE_WEBHOOK_SECRET=whsec_<your-webhook-secret>
OPENAI_API_KEY=sk-proj-<your-openai-key>
PORT=4000
WEB_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:4000
UPSTASH_REDIS_REST_URL=https://<your-upstash-endpoint>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<your-upstash-token>
REDIS_URL=redis://localhost:6379
NEXT_PUBLIC_EXTENSION_ID=<your-extension-id>
```
Attack scenario: Not directly exploitable from the browser — Next.js only inlines `NEXT_PUBLIC_*` vars into the client bundle, and none of these are so prefixed, so they never reach the browser. The risk is blast-radius/hygiene: a file that shouldn't need service-role/JWT/payment/AI-provider secrets to run the web app now does, increasing the number of places a real production secret could leak from (backups, `zip`/tarball of `apps/web`, accidental `git add -f`, screen-share during a support session, a future build-tooling change that globs `.env*`). I did **not** read the actual values in `.env.local` and cannot confirm whether they are live production secrets or placeholders — flagged as `UNVERIFIED` for value sensitivity, `CONFIRMED` for the structural issue (wrong-app colocation + a misleading template).
Business impact: Low as currently configured (not committed, not consumed by web code, not browser-exposed), but represents unnecessary secret sprawl for a platform where a leaked `SUPABASE_SERVICE_ROLE_KEY` would bypass RLS entirely across all tenants.
Evidence:
```
# apps/web/.env.local — variable NAMES only (values redacted/not read):
NEXT_PUBLIC_API_URL=
NEXT_PUBLIC_EXTENSION_ID=
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
OPENAI_API_KEY=
PORT=
REDIS_URL=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SUPABASE_JWT_SECRET=
SUPABASE_SERVICE_ROLE_KEY=
UPSTASH_REDIS_REST_TOKEN=
UPSTASH_REDIS_REST_URL=
WEB_URL=
```
Root cause: `apps/web/.env.local.example` (the template developers copy from) itself mixes `apps/api`-only secrets into the web app's example file.
Remediation: Split the example file so `apps/web/.env.local.example` only lists vars `apps/web` actually reads (the 11 `NEXT_PUBLIC_*` ones); move `SUPABASE_SERVICE_ROLE_KEY`/`SUPABASE_JWT_SECRET`/`STRIPE_SECRET_KEY`/`OPENAI_API_KEY`/`UPSTASH_*`/`REDIS_URL`/`PORT` into `apps/api/.env.example` only (per repo convention already stated in root `CLAUDE.md`); audit whether the real values currently in `apps/web/.env.local` are live production secrets and, if so, rotate and remove them from that file.
Suggested regression test: a CI check (or a one-off script) that fails if `apps/web/.env.local.example` contains any var name not read by `apps/web` source.
Confidence: CONFIRMED (structural issue) / UNVERIFIED (whether current values are live secrets — not read, per redaction instruction)

---

### SEC-8005
Title: Backend-supplied official-form/document URLs are rendered as `<a href>` without a scheme check in two components, inconsistent with the app's own established pattern elsewhere
Severity: LOW
Affected component: document checklist UI
Affected profile(s): applicant
Affected page/API: `/documents/[applicationId]` (`official-forms.tsx`, `official-documents.tsx`)
Description: `readiness-client.tsx` and `lib/form-link.ts` both explicitly distrust externally/AI-sourced URLs before using them for navigation — `readiness-client.tsx:440` gates rendering an `<a href>` behind `/^https?:\/\//i.test(s.official_source)` (falling back to plain text otherwise), and `form-link.ts:7-11` documents, in its own comment, that "the AI-suggested `source_url` is intentionally NOT used for navigation: those model-generated links are frequently stale/hallucinated." `official-forms.tsx` and `official-documents.tsx` do not apply the same guard: they render `form.officialUrl` / `tpl.officialUrl` directly as `href` with no scheme validation.
Attack scenario: If `officialUrl` for a given form/document template were ever populated from a less-trusted path (a bug in the template-cache pipeline, a compromised admin session writing a template, or the field being widened to accept AI-suggested content in the future), a value like `javascript:...` in that field would execute in the page's origin when the link is clicked — a self-XSS/trust-boundary gap. Today this depends entirely on the API/template-cache only ever returning `http(s)` URLs, which is outside this audit's scope to verify.
Business impact: Low today (requires an already-compromised or misbehaving backend data source to trigger), but it is the one place in the reviewed href-rendering code where the app's own established "don't trust source URLs" pattern was not applied consistently.
Evidence:
```tsx
// app/[locale]/(dashboard)/documents/[applicationId]/official-forms.tsx:174-181
<a
  fallbackUrl={form.officialUrl}
  ...
  href={form.officialUrl ?? '#'}
  target="_blank"
  rel="noopener noreferrer"
```
```tsx
// app/[locale]/(dashboard)/documents/[applicationId]/official-documents.tsx:184-191
<a
  fallbackUrl={tpl.officialUrl}
  ...
  href={tpl.officialUrl}
  target="_blank"
  rel="noopener noreferrer"
```
Compare with the guarded pattern already in the codebase:
```tsx
// app/[locale]/(dashboard)/readiness/[applicationId]/readiness-client.tsx:440-451
{/^https?:\/\//i.test(s.official_source) ? (
  <a href={s.official_source} target="_blank" rel="noopener noreferrer" ...>
    {s.official_source}
  </a>
) : (
  s.official_source
)}
```
Root cause: the URL-trust guard pattern established in `form-link.ts` / `readiness-client.tsx` was not applied to `official-forms.tsx` / `official-documents.tsx`.
Remediation: Apply the same `/^https?:\/\//i.test(url)` guard (or route through `lib/form-link.ts`'s `getFormHref`) before using `officialUrl`/`tpl.officialUrl` as an `href` in these two components.
Suggested regression test: a component test that renders `OfficialForms`/`OfficialDocuments` with `officialUrl: "javascript:alert(1)"` and asserts the rendered anchor's `href` is not that value (either stripped, or the link falls back to plain text).
Confidence: PLAUSIBLE (code pattern confirmed; real-world reachability of an unsafe scheme in this field is unverified — API/template-cache is out of scope)

---

### SEC-8006
Title: `/api/auth/signout` has no CSRF protection
Severity: LOW
Affected component: `app/api/auth/signout/route.ts`
Affected profile(s): any authenticated user
Affected page/API: `POST /api/auth/signout`
Description: The signout route handler performs `supabase.auth.signOut()` on any `POST` request with no token/origin check, relying entirely on the ambient session cookie. Because the Supabase session cookie is `sameSite: 'lax'` (see SEC-8003) and this is a state-changing `POST`, most modern browsers already withhold the cookie on a cross-site form/fetch `POST`, which limits practical exploitability — but the endpoint itself has no explicit CSRF defense (no origin/referer check, no anti-CSRF token) if that cookie attribute were ever changed.
Attack scenario: A third-party page that gets a victim's browser to `POST` to `https://visaai.co/api/auth/signout` could force a logout if `sameSite` protection were weakened or bypassed by a browser quirk. Impact is limited to a forced logout/nuisance (no data disclosure or mutation beyond ending the session) since the handler does nothing but sign out.
Business impact: Low — nuisance-level (forced logout), not a data-confidentiality or integrity issue.
Evidence:
```ts
// apps/web/app/api/auth/signout/route.ts (full file)
import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'))
}
```
Root cause: no explicit CSRF check; relies implicitly on cookie `SameSite` behavior.
Remediation: Given the low impact, explicit CSRF tokens are likely not worth the complexity here; at minimum confirm (and pin, via SEC-8003's remediation) that the session cookie stays `sameSite: 'lax'` or stricter so the existing implicit protection doesn't silently regress.
Suggested regression test: N/A / low priority.
Confidence: CONFIRMED

---

## Areas reviewed with no findings (stated explicitly per the brief's "no padding" instruction)

- **XSS**: only three `dangerouslySetInnerHTML` call sites in the whole app, all in `app/[locale]/layout.tsx:98-112` (two JSON-LD blocks built from build-time-constant object literals in `lib/seo/structured-data.ts`, and a build-time-constant `THEME_INIT_SCRIPT` string in `components/providers/theme-provider.tsx:54`) — none take runtime user input. No `innerHTML`, `document.write`, `eval`, or `new Function` found anywhere in app source. No markdown/HTML-rendering library (`react-markdown`, `marked`, `remark`, `rehype-raw`, etc.) is a dependency. AI-generated chat content (`intake-chat-client.tsx:163`), narrative text (`narrative-client.tsx:214`, via `<pre>`), and message bodies (`conversation-thread.tsx:415,719`) are all rendered as plain JSX text interpolation (React-escaped). No SVG-upload path exists (accepted upload types are `.jpg,.jpeg,.png,.heic,.pdf` in `documents-client.tsx:65` and `application/pdf,image/png,image/jpeg,image/webp,image/heic` in `attachment-uploader.tsx:47` — no `image/svg+xml`).
- **Authorization decided client-side**: the one client-side gating pattern found, `GatedRegion`/`AuthGateProvider` (`components/auth/gated-region.tsx`, `components/auth/auth-gate-provider.tsx`), is explicitly self-documented in code as "UI ONLY — never a security boundary" and only blurs static workflow-step copy (`intake-chat-client.tsx:351-364`), never real data. All actual server components fetch via RLS-scoped Supabase clients or forward the caller's own bearer token to the API (`lib/api/server.ts:8-15`); no service-role/admin client is used anywhere in `apps/web`.
- **Server actions**: only one exists (`app/actions/set-locale.ts`) and it only writes a non-sensitive locale-preference cookie after validating against a fixed enum (`isLocale`) — no auth-sensitive action is exposed as a server action.
- **Open redirect**: `resolveSafeNext()` (`lib/auth/safe-next.ts:7-17`) blocks protocol-relative, backslash-smuggled, and absolute-URL redirect targets; used consistently by `app/callback/route.ts:13`. `router.push()` call sites all use hardcoded internal paths or values that never originate from an untrusted URL param.
- **OAuth error rendering**: provider-supplied `error_description` is explicitly sanitized (`lib/auth/oauth-error.ts:90-100`, strips `<`/`>` and control chars, caps length) before being rendered as plain text (`components/auth/oauth-error-alert.tsx:41-43`).
- **Reverse tabnabbing**: every `target="_blank"` anchor found in the app (10 call sites, all external-link cases) pairs it with `rel="noopener noreferrer"`.
- **Source maps / debug surfaces**: `productionBrowserSourceMaps` is not set in `next.config.ts` (Next.js default is `false` — no source maps shipped). No `/api/debug`, test, or Storybook route exists under `app/`.
- **Third-party scripts**: no external `<script src="https://...">`, no `next/script` usage, no CDN references, no `<iframe>` embedding third-party content anywhere in `apps/web`.
- **postMessage**: no `window.addEventListener('message', ...)` listener exists anywhere in the app (the one `postMessage` hit found is an unrelated API client function name, `lib/api/messaging-client.ts`, not `window.postMessage`).
- **Token-in-URL / socket auth**: the SSE stream (`lib/sse-stream.ts:38-44`) and Socket.IO client (`lib/socket.ts:19-22`) both pass the bearer token via `Authorization` header / the `auth` handshake payload respectively — never as a URL query string, so tokens do not land in server access logs or `Referer` headers via these channels.
- **PII in analytics**: `lib/analytics/client.ts` states an explicit "props may only contain ids, enums, and paths — never names, emails, free-text" policy in its header comment, and every call site reviewed (`intake-chat-client.tsx`, `login/page.tsx`, `auth-modal.tsx`, `auth-gate-provider.tsx`) only passes `applicationId`/enums, consistent with that policy. `AnalyticsProvider`'s `page.viewed` event sends only `pathname`, not the full URL/query string.
- **localStorage/sessionStorage**: every use found is non-PII (theme preference, a "remember me" boolean, a pending-signup flag, an anonymous analytics ID, dashboard-shell UI layout prefs). No document/passport data or tokens found cached there.
- **File upload client-side validation**: present as expected (`MAX_FILE_SIZE_BYTES`/`ACCEPTED_TYPES` in `documents-client.tsx:65-68`, size check in `attachment-uploader.tsx:25`) — this is UI-only by nature; server-side re-validation is the API team's responsibility to confirm (out of this audit's scope).

---

## Summary

- Page inventory: **58 rows** (matches brief).
- CSP: **does not exist** at the web tier (`next.config.ts` / `proxy.ts`); nginx-layer compensation is UNVERIFIED from this repo.
- Findings by severity: **CRITICAL: 0 · HIGH: 2 · MEDIUM: 1 · LOW: 3** (6 total).
  - SEC-8001 (HIGH): Automation hand-off token logged to browser console in production.
  - SEC-8002 (HIGH): No CSP / security headers anywhere at the web tier.
  - SEC-8003 (MEDIUM): Session tokens in non-httpOnly cookies, no explicit `Secure` set by app code.
  - SEC-8004 (LOW): Privileged API-only secrets colocated in `apps/web/.env.local` via a misleading template.
  - SEC-8005 (LOW): Two components skip the app's own established URL-scheme-validation pattern for backend-supplied links.
  - SEC-8006 (LOW): `/api/auth/signout` has no explicit CSRF defense (low impact, implicit `SameSite=Lax` mitigation).
