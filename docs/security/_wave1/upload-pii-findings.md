# VisaAI Security Audit — Wave 1: Upload/Download, Document Handling, PII Exposure, Logging, Audit Trail

Scope: application-layer document upload/download paths, file-type/size validation, storage key
scheme, download authorization, execution prevention, malware scanning, deletion/retention (GDPR),
PII exposure app-wide, logging/redaction, and document access audit trail. Authn mechanics, payment
gating, and RLS policy text are explicitly out of scope (owned by other audit tracks); this track
notes where the app layer *depends on* RLS without re-verifying it.

Repo: `/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI` (read-only recon, no files modified).

All findings below are grounded in `path:line` evidence with quoted code. Claims about live
production runtime behavior that cannot be verified from the checked-out repo (e.g., the exact file
actually deployed to `/etc/nginx` on the VPS, or storage-api's exact header behavior at runtime) are
explicitly marked UNVERIFIED/PLAUSIBLE rather than asserted as fact.

---

## (a) Upload/Download Endpoint Table

| Endpoint | Auth | Ownership check | Type validation | Size cap | Key scheme | Serving headers |
|---|---|---|---|---|---|---|
| `POST /documents/presign/:applicationId` (identity docs) | `JwtGuard` | Yes — `applications.eq('user_id', userId)` | **None synchronous** — `mimeType`/`fileName` accepted as-is, no allowlist check before minting the upload URL | None at this endpoint (client-side 50MB check only; see SEC-12008) | `${userId}/${applicationId}/${Date.now()}-${safeName}` (filename sanitized via `basename()` + charset strip) | N/A (upload) |
| `POST /documents/register/:applicationId` | `JwtGuard` | Yes — app ownership + `storagePath.startsWith('${userId}/${applicationId}/')` | Client-declared `mimeType` stored verbatim; real validation deferred to the **async** BullMQ scan (magic bytes) | None (async scan enforces `MAX_UPLOAD_BYTES`, default 15MB, *after* upload) | N/A | N/A |
| `GET /documents/:applicationId` (metadata list) | `JwtGuard` | Yes | N/A (read) | N/A | N/A | JSON; no raw file bytes returned |
| `GET /documents/:applicationId/access-log` | `JwtGuard` | Yes (+ RLS `access_logs_own_rows`) | N/A | N/A | N/A | JSON |
| `DELETE /documents/item/:documentId` | `JwtGuard` | Yes — joined `applications.user_id` check | N/A | N/A | N/A | N/A |
| `POST /messaging/:applicationId/attachments/upload-url` | `JwtGuard` | Indirect — via `ensureConversation`/`getApplicationParties` (application-party resolution, not a direct owner-id equality check in this file) | **Yes, synchronous** — declared MIME checked against `FILE_MIMES`/`VOICE_MIMES` allowlist (`assertAllowed`) | Yes — declared `sizeBytes` vs 25MB (client-declared at this step) | `${ownerUserId}/${applicationId}/messages/${conversationId}/${Date.now()}-${safeName}` | N/A (upload) |
| `POST /messaging/:applicationId/attachments` (confirm) | `JwtGuard` | Same as above | Yes, but re-checked against **storage-reported** `metadata.mimetype`, which is itself sourced from the attacker-controlled `Content-Type` header sent on the raw `PUT` — **not a magic-byte/content sniff** | Yes — re-checked against storage-reported `metadata.size` (real fix for a prior bug, DB-002) | N/A | N/A |
| `POST /messaging/:applicationId/voice` (confirm) | `JwtGuard` | Same as above | Same pattern, `VOICE_MIMES` | Same pattern | N/A | N/A |
| `GET /messaging/attachments/:attachmentId/url` | `JwtGuard` | Delegated to RLS on `message_attachments` (fetched via `db.forUser(token)`) | N/A | N/A | N/A | Signed URL, TTL 300s, signed by **admin** client after RLS-gated row lookup |
| `GET /messaging/voice/:voiceId/url` | `JwtGuard` | Same, RLS on `voice_messages` | N/A | N/A | N/A | Signed URL, TTL 300s |
| `AutomationGateway` `automation:start` → `loadUploadableDocuments` (Chrome-extension document handoff) | Single-use, 5-min-TTL session token (`SessionTokenService`), minted only after ownership + payment check in `createSession` | Yes, at token-mint time | None re-checked at read time; filters `upload_status='complete'`, **not** `ocr_status='complete'` (SEC-12013) | N/A | N/A | Signed URL, TTL 600s. **Gated off by default** — `assertLegacyEnabled()` throws unless `LEGACY_AUTOMATION_WRITE_ENABLED=true` |
| `GET /document-templates/:applicationId/file/:templateCode` (govt form templates, not user PII) | `JwtGuard`, `PlanGuard` | Via `ParseUUIDPipe` + service lookup | N/A (system-curated content) | N/A | Deterministic, content/version-scoped | **Proxied through the API** — `Content-Disposition: attachment`, explicit `Content-Type`, no raw storage link exposed to the browser |
| `GET /forms/:applicationId/file/:formCode` | `JwtGuard`, `PlanGuard` | Same pattern | N/A | N/A | N/A | Same hardened proxy pattern as above |

**11 distinct upload/download surfaces enumerated (12 rows above, including the two template-serving
routes for contrast).**

---

## (b) PII Sinks Table

| Sink | What crosses the boundary | Redacted? | Evidence |
|---|---|---|---|
| Structured server logs (pino, `nestjs-pino`) | HTTP req/res metadata; `Authorization`, `Cookie`, `stripe-signature` headers, `req.body.password`/`token` | **Yes** — explicit `redact` config, `remove: true` | `apps/api/src/observability/logger.config.ts:12-22` |
| Raw `console.log/error/warn` calls (bypass pino entirely) | Full AI-generated intake question text, full `err` objects, and — in one branch — the **entire WebSocket handshake auth payload** (which carries the raw bearer token field) | **No** — these calls go straight to stdout/pm2 logs, unredacted, and do not go through `safeLog` either | `apps/api/src/modules/intake/intake.gateway.ts:114-117` (handshake.auth), `apps/api/src/modules/intake/graphs/nodes/ask-question.ts:287` (full AI question text) — see SEC-12009, SEC-12010 |
| `safeLog` helper (`apps/api/src/modules/shared/log/redact.ts`) | Emails, JWTs, passport-like ID patterns, ISO dates, long digit runs | Yes, best-effort regex scrubbing — used in `documents.service.ts`, `scan-document.ts`, but **not** consistently elsewhere | `apps/api/src/modules/shared/log/redact.ts:10-20`; inconsistent adoption noted in SEC-12010 |
| Sentry (`@sentry/nestjs`) | Error events only | Yes — `sendDefaultPii: false`, `tracesSampleRate: 0`, no request-body attachment configured | `apps/api/src/observability/sentry.ts:12-19` |
| OCR vendors (Azure Document Intelligence / AWS Textract / Google Document AI / OpenAI, provider-selectable) | Full document bytes + extracted identity fields (by design — core product function) | N/A — this is the intended data flow, gated by `DATA_RESIDENCY_MODE` and a provider-capability check (`ocr-capability.ts`) rather than "redaction" | `apps/api/src/modules/documents/documents.processor.ts:48-77`; UI discloses this to the user, `apps/web/.../documents-client.tsx:343` ("OCR runs through our AI provider under their enterprise no-training agreement") |
| Email notifications | Grep for document/PII fields (`passport`, `documentType`, `fileName`, `extractedFields`) in `apps/api/src/modules/notifications` returned **no matches** | N/A — no evidence emails carry document content or extracted PII | Negative grep result; UNVERIFIED beyond that (did not read every email template body) |
| Messaging event bus / SSE fan-out (`attachment.created`, `voice.created`) | `conversation_id`, `application_id`, `recipient_ids` only — **no** `fileName`/content in the emitted event | Effectively yes — payload is minimal by construction | `apps/api/src/modules/messaging/attachment.service.ts:336-362` |
| Analytics/telemetry | Not deeply audited this pass — no `trackEvent`/analytics call sites found wired directly off document or attachment creation in the modules reviewed | UNVERIFIED for the platform-wide analytics event spine (separate module, out of this pass's read budget) | Grep in `documents`/`messaging` modules found no analytics emission tied to file content |
| nginx access logs (`api.visaai.co`, and the `/sbkong/` storage proxy per `cutover.sh`) | Full request URI, including signed-URL query-string tokens | No app-level control over this (standard nginx behavior); mitigated by short TTLs (60s–600s) | `infra/self-hosted/cutover.sh:118-131`; TTLs at `apps/api/src/modules/documents/graphs/nodes/fetch-document.ts:10`, `apps/api/src/modules/messaging/attachment.service.ts:28`, `apps/api/src/modules/automation/automation.service.ts:33` |

---

## Findings

### SEC-12001
Title: Document/attachment storage is served from the same origin as the primary web app, removing all cross-origin isolation as a backstop
Severity: High
Affected component: Infrastructure / storage serving topology
Affected profile(s): applicant, consultant, admin — anyone who can view a rendered document or attachment link
Affected page/API: Every signed URL returned by `documents.service.ts`, `attachment.service.ts`, `automation.service.ts`, `doc-template.store.ts`, `form-template.store.ts`
Description: The self-hosted Supabase Storage/Kong stack is exposed to the browser at `https://visaai.co/sbkong/...` — i.e., a **path** on the exact same origin as the main web application, not a separate subdomain. `infra/self-hosted/cutover.sh` inserts this nginx location directly into the `visaai.co` server block:
```
PUBLIC_SB_PATH="/sbkong"                 # browser-facing prefix on visaai.co
PUBLIC_SB_URL="https://visaai.co${PUBLIC_SB_PATH}"
...
block=f'''    location {path}/ {{
        proxy_pass {kong}/;
        ...
    }}
'''
m=re.search(r"    location / \{\n        proxy_pass http://(?:localhost|127\.0\.0\.1):3002;", s)
```
(`infra/self-hosted/cutover.sh:40-41,118-137`). The web app's own env is then pointed at this same-origin path:
```
setv "$WEB_ENV" NEXT_PUBLIC_SUPABASE_URL "$PUBLIC_SB_URL"
```
(`infra/self-hosted/cutover.sh:151`). `apps/api/src/modules/shared/supabase/supabase.service.ts:76-99` (`toPublicStorageUrl`) confirms every signed URL handed to a browser is rewritten onto this same public base. Per project memory this cutover is the **current production topology** ("PROD is the self-hosted stack on the VPS (cutover done)").
Attack scenario: With storage same-origin, any future content-type-confusion bug anywhere in the upload pipeline (a new allowlist entry, a provider change, a bug in `assertObjectValid`) that lets an attacker get a `text/html`/`image/svg+xml` object stored and linked stops being a "storage-domain phishing page" and becomes full `visaai.co` origin compromise — script execution with access to the app's DOM, `localStorage` (where Supabase session tokens typically live for a client-side auth flow like this one), and any first-party cookies. Today's allowlists (`FILE_MIMES` in messaging, the magic-byte gate in `scan-document.ts`) block the obvious payloads, so no working bypass was demonstrated in this audit — this finding is about the absence of defense-in-depth, not a proven exploit chain.
Business impact: Turns a contained "stored content" bug class into an unbounded one. Given the product's core asset is passports/identity documents, a session-takeover-class bug reachable through the document pipeline is the worst-case outcome for this product.
Evidence: `infra/self-hosted/cutover.sh:40-41,118-147,151`; `apps/api/src/modules/shared/supabase/supabase.service.ts:76-99`
Root cause: Storage was placed on the app's own origin (path-based proxy) instead of a separate subdomain, to solve a browser-reachability problem (Kong was only bound to loopback) without introducing a second public hostname/cert.
Remediation: Serve storage/Kong from a dedicated subdomain (e.g. `storage.visaai.co` or `cdn.visaai.co`) with its own TLS vhost, so any future content-serving bug is contained to a domain that cannot read the app's session storage/cookies. If a same-origin path must be kept short-term, add `X-Content-Type-Options: nosniff` and a restrictive `Content-Security-Policy` (`script-src 'self'`, no `unsafe-inline`) at the `/sbkong/` nginx location as a compensating control, and force `Content-Disposition: attachment` at that location for any path under `/storage/v1/object/` that is not explicitly an image.
Suggested regression test: Infra/deploy-time check that asserts the storage reverse-proxy location is never added to the same nginx `server_name` block as the app's own `location /`; a runtime smoke test that fetches a known object through the public storage URL and asserts `X-Content-Type-Options: nosniff` is present.
Confidence: CONFIRMED (architecture, from committed deploy script) / PLAUSIBLE (real-world exploitability — no working bypass found this pass)

### SEC-12002
Title: Message/voice attachment content is never magic-byte verified — only the client-controlled `Content-Type` header is trusted
Severity: Medium
Affected component: `apps/api/src/modules/messaging/attachment.service.ts`
Affected profile(s): applicant, consultant, admin (any messaging participant)
Affected page/API: `POST /messaging/:applicationId/attachments`, `POST /messaging/:applicationId/voice`
Description: Unlike the identity-document pipeline (`scan-document.ts`, which downloads the bytes and checks magic numbers), the messaging attachment "confirm" step only compares the storage-reported `metadata.mimetype` against an allowlist:
```
const meta = (object.metadata ?? {}) as { size?: number; mimetype?: string };
const actualSize = typeof meta.size === 'number' ? meta.size : null;
const actualMime = typeof meta.mimetype === 'string' ? meta.mimetype : null;
...
this.assertAllowed(kind, actualMime ?? 'application/octet-stream', actualSize);
```
(`apps/api/src/modules/messaging/attachment.service.ts:161-179`). `metadata.mimetype` is populated by Supabase Storage from the `Content-Type` header the client sent on the raw `PUT` to the signed upload URL (`apps/web/lib/api/messaging-attachments-client.ts:15-17` — `fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file })`), which is entirely attacker-controlled and independent of the actual byte content. The comment at `attachment.service.ts:125-139` documents that this check was hardened once already (DB-002, to stop a *declared-size* lie) but the fix still only compares declared strings/numbers against what storage reports — it never inspects bytes.
Attack scenario: A user with access to any conversation could request an upload URL declaring `mimeType: application/pdf`, then `PUT` arbitrary bytes with `Content-Type: application/pdf` regardless of actual content. Today this is contained because `FILE_MIMES`/`VOICE_MIMES` (`attachment.service.ts:29-36`) excludes script-capable types (`text/html`, `image/svg+xml`), so the practical XSS path is closed — but the control gap (no content sniffing at all) means the safety of this endpoint rests entirely on the allowlist never being loosened, and combined with SEC-12001 (same-origin storage), any future loosening of `FILE_MIMES` is a same-origin XSS.
Business impact: Not independently exploitable today, but is the single point of failure that SEC-12001 amplifies; also means a malformed/mislabeled file can be stored and handed to the other party in a conversation (applicant ↔ consultant) with an incorrect `Content-Type`.
Evidence: `apps/api/src/modules/messaging/attachment.service.ts:140-181`; `apps/web/lib/api/messaging-attachments-client.ts:14-18`
Root cause: Content-type trust is delegated to the storage backend's recorded metadata, which is itself derived from an attacker-controlled request header, not from the object's actual bytes.
Remediation: Reuse the same magic-byte inspection already built for identity documents (`inspectFileBytes` in `apps/api/src/modules/documents/graphs/nodes/scan-document.ts`) as a shared utility, and call it from `AttachmentService.assertObjectValid` by downloading (or range-fetching the header bytes of) the object before confirming.
Suggested regression test: Upload a file with `Content-Type: application/pdf` but JPEG magic bytes; assert `confirmAttachment` rejects it once the fix lands (currently it would accept it).
Confidence: CONFIRMED

### SEC-12003
Title: GDPR/PIPEDA account erasure does not delete message/voice attachment objects from storage — only the top two path levels are purged
Severity: High
Affected component: `apps/api/src/modules/privacy/privacy.service.ts`
Affected profile(s): any user who exercises the right to erasure
Affected page/API: `POST /me/privacy/delete`
Description: `purgeStorage` lists exactly two levels of the `documents` bucket and deletes only what it finds there:
```
private async purgeStorage(userId: string): Promise<number> {
  const store = this.supabase.admin.storage.from(DOCUMENTS_BUCKET);
  const paths: string[] = [];
  try {
    const { data: apps } = await store.list(userId);
    for (const app of apps ?? []) {
      const { data: files } = await store.list(`${userId}/${app.name}`);
      for (const f of files ?? [])
        paths.push(`${userId}/${app.name}/${f.name}`);
    }
    if (paths.length) {
      const { error } = await store.remove(paths);
      ...
```
(`apps/api/src/modules/privacy/privacy.service.ts:203-224`). But message/voice attachments are written a level deeper, under a `messages/<conversationId>/` subfolder:
```
const path = `${ownerUserId}/${applicationId}/messages/${conversation.id}/${Date.now()}-${safeName(input.fileName)}`;
```
(`apps/api/src/modules/messaging/attachment.service.ts:107`). Supabase Storage's `list()` is not recursive — `store.list(`${userId}/${app.name}`)` returns the `messages` pseudo-folder as a single non-file entry, not the files nested inside it, so those objects are never added to `paths` and never passed to `store.remove()`. The `document-request-card.tsx` flow (`apps/web/components/messaging/document-request-card.tsx`) uses this exact attachment path to exchange identity documents between applicant and consultant, so this is not a low-value chat-image gap — it is the same class of asset (passports, bank statements) the rest of this audit is scoped around.
Attack scenario: N/A (not attacker-triggered) — this is a compliance/retention failure, not an access-control bypass. The Postgres `message_attachments`/`voice_messages` rows are removed via the `auth.users` → cascading FK chain, so the file becomes **unreachable through the app** after deletion (no row left to resolve a signed URL from) — but the underlying bytes remain permanently on the storage backend's disk, never actually erased.
Business impact: `deleteAccount` reports `{ deleted: true, storageRemoved: N }` implying completeness, but under-reports what was actually removed. For an immigration platform handling passports/police certificates, "we say we erased it and did not" is a direct GDPR Art. 17 exposure if ever audited, independent of whether the leftover bytes are currently reachable by anyone.
Evidence: `apps/api/src/modules/privacy/privacy.service.ts:203-224`; `apps/api/src/modules/messaging/attachment.service.ts:107`
Root cause: `purgeStorage` assumes a flat two-level key scheme (`userId/applicationId/file`) that matches the identity-document bucket layout, but the messaging module writes a third, deeper level (`userId/applicationId/messages/conversationId/file`) that the purge routine was never updated to walk.
Remediation: Make `purgeStorage` recursive (walk every "folder" entry returned by `list()` until only files remain, or maintain a manifest table of `storage_path` written at upload time — `message_attachments.storage_path`/`voice_messages.storage_path` already exist per the P2 migration — and delete by querying those tables for the user's rows before the account cascade fires, rather than by trying to reconstruct paths from `list()`).
Suggested regression test: Create an application, send a message attachment, delete the account, then assert (via the storage admin API, before any cascading row deletion removes the ability to know the path) that the `messages/<conversationId>/...` object is gone, not just the top-level `userId/applicationId/` files.
Confidence: CONFIRMED

### SEC-12004
Title: Document access log never records `view`, `download`, or `ocr` actions — only `upload` and `delete` — contradicting the schema and the in-product privacy copy
Severity: Medium
Affected component: `apps/api/src/modules/documents/documents.service.ts`
Affected profile(s): applicant (the audience for the "Privacy & security" panel), and indirectly anyone relying on this as a compliance control
Affected page/API: `GET /documents/:applicationId/access-log`; UI panel in `documents-client.tsx`
Description: `document_access_logs.action` is declared with five possible values in the schema:
```
action text not null check (action in ('upload','view','download','delete','ocr')),
```
(`supabase/migrations/20260603000001_document_privacy.sql:56`). But `logAccess()` is only ever called from two of the five: `registerUploadedDocument` (`action: 'upload'`, `documents.service.ts:169-174`) and `deleteDocument` (`action: 'delete'`, `documents.service.ts:287-292`). A repo-wide search confirms these are the **only** two call sites of `logAccess` in the entire codebase — no code path ever inserts an `action: 'view'`, `'download'`, or `'ocr'` row, including the OCR pipeline itself (`documents.processor.ts`) and the Chrome-extension document handoff (`automation.service.ts:loadUploadableDocuments`, which mints a *download* signed URL for the raw bucket and logs nothing). Meanwhile the product tells the user otherwise:
```
<p className="mt-4 text-[12px] font-medium text-deep-black">Recent activity</p>
```
and, just above it:
```
<span className="font-medium">Access log.</span>{' '}
Every upload, view, and delete is recorded below so you can audit who touched what.
```
(`apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx:346-348`).
Attack scenario: N/A — this is a control/compliance gap, not an exploit. For a regulated immigration platform, "who viewed whose passport, and when" is explicitly a compliance expectation; today the only auditable events are creation and deletion, not access.
Business impact: If a consultant or any system component (e.g. a future admin tool) reads a document's contents, there is no record of it. The in-app privacy copy overstates what is actually logged, which is a genuine trust/accuracy problem independent of the underlying gap.
Evidence: `supabase/migrations/20260603000001_document_privacy.sql:56`; `apps/api/src/modules/documents/documents.service.ts:169,287,321-343`; `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx:346-348`
Root cause: `logAccess('view'/'download')` was scaffolded into the schema and UI copy but never wired into any read path.
Remediation: Call `logAccess({..., action: 'view'})` from `getDocuments` (or a future single-document detail fetch) and `action: 'download'` from any endpoint that mints a signed URL for a specific document's raw bytes (including `automation.service.ts`'s extension handoff); call `action: 'ocr'` from the processor once OCR completes. Either implement the missing calls or narrow the UI copy and the DB check constraint to match what is actually tracked.
Suggested regression test: Integration test that fetches `GET /documents/:applicationId`, then asserts a new `view` row exists in `document_access_logs` for that user/application (currently fails).
Confidence: CONFIRMED

### SEC-12005
Title: Identity-document presign/register endpoints perform no synchronous MIME-type or size allowlist check — all content validation is deferred to an async, post-upload scan
Severity: Medium
Affected component: `apps/api/src/modules/documents/documents.service.ts`
Affected profile(s): applicant
Affected page/API: `POST /documents/presign/:applicationId`, `POST /documents/register/:applicationId`
Description: `getPresignedUploadUrl` performs only ownership and filename-sanitization checks before minting a signed upload URL — no `mimeType` allowlist, no size ceiling:
```
async getPresignedUploadUrl(db, applicationId, userId, fileName, mimeType) {
  ...
  const safeName = basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
  const storagePath = `${userId}/${applicationId}/${Date.now()}-${safeName}`;
  const { data, error } = await db.storage.from('documents').createSignedUploadUrl(storagePath);
```
(`apps/api/src/modules/documents/documents.service.ts:32-61`). `registerUploadedDocument` similarly only checks ownership and storage-path prefix before writing the DB row with `upload_status: 'complete'` **immediately**:
```
.insert({
  application_id: params.applicationId,
  ...
  mime_type: params.mimeType,
  ...
  upload_status: 'complete',
  ocr_status: 'pending',
})
```
(`apps/api/src/modules/documents/documents.service.ts:151-167`). The only content inspection anywhere in this pipeline is the magic-byte gate in `scan-document.ts`, which runs asynchronously via BullMQ, potentially seconds to minutes later, by which time `upload_status` already reads `'complete'`. This is in contrast to `attachment.service.ts`, whose messaging-attachment path does a synchronous `assertAllowed()` allowlist check on both the upload-URL request *and* the confirm step (see SEC-12002 for the caveat about what that check actually verifies).
Attack scenario: An attacker (any authenticated applicant, uploading into their own application, since ownership is enforced) can request a signed upload URL and PUT any byte content/size before the async scan ever runs. In the current architecture this is low-impact because (1) the bucket is private, (2) no browser-facing endpoint exists to re-serve arbitrary `documents`-bucket content to that same user or anyone else outside the automation/extension path, and (3) the scan does eventually mark `ocr_status: 'failed'`. But `automation.service.ts:loadUploadableDocuments` (SEC-12013) filters on `upload_status='complete'`, not `ocr_status`, so if the deprecated legacy automation write path is ever re-enabled, a scan-rejected file remains eligible to be signed and handed to the Chrome extension.
Business impact: Removes a layer of defense-in-depth from the pipeline that handles the platform's most sensitive asset (passports, birth certificates); today's blast radius is limited by the dormant state of the automation path and the absence of any other read-back surface.
Evidence: `apps/api/src/modules/documents/documents.service.ts:32-71,73-167`
Root cause: Type/size validation was designed as a single async gate (the OCR pipeline's `scan_document` node) rather than being enforced at both the synchronous API boundary and the async pipeline, unlike the messaging module's two-checkpoint design.
Remediation: Add a synchronous `mimeType` allowlist check (matching `scan-document.ts`'s allowed family set: PNG/JPEG/GIF/WebP/PDF/HEIC) to `getPresignedUploadUrl` and `registerUploadedDocument`, mirroring `AttachmentService.assertAllowed`. This will not fully close the gap (declared MIME is still just a client claim pre-upload) but removes the "any content type at all" hole and gives a fast, synchronous rejection instead of a silent async failure.
Suggested regression test: `POST /documents/presign/:applicationId` with `mimeType: 'application/x-msdownload'` should be rejected with 400 at request time, not accepted and only caught later by the queue.
Confidence: CONFIRMED

### SEC-12006
Title: Documents that fail the malware/magic-byte scan are never deleted from storage — they remain as orphaned, uninspected objects indefinitely
Severity: Low
Affected component: `apps/api/src/modules/documents/graphs/nodes/scan-document.ts`, `store-verification.ts`
Affected profile(s): applicant
Affected page/API: async OCR/scan pipeline (BullMQ `DOCUMENT_QUEUE`)
Description: When `scanDocument` rejects a file (disallowed/dangerous magic bytes, declared/detected MIME mismatch, or oversize), the graph short-circuits via `state.error`, and `store-verification.ts` sets a terminal status but never removes the object:
```
const newStatus = state.error || identityErr ? 'failed' : 'complete';
const { error: updateErr } = await supabase
  .from('documents')
  .update({ ocr_status: newStatus, ... })
```
(`apps/api/src/modules/documents/graphs/nodes/store-verification.ts:67-80`). No code path calls `storage.from('documents').remove(...)` for a scan-rejected object; the DB row persists with `ocr_status: 'failed'` and the underlying bytes sit in the private bucket forever unless the user manually clicks delete on that document card in the UI.
Attack scenario: N/A directly (bucket is private, no generic path-to-signed-URL endpoint exists) — but this is the object SEC-12013 (automation module's `upload_status`-only filter) can still reach if the legacy automation write path is ever turned on.
Business impact: Storage bloat and an indefinitely-retained, unscanned/rejected artifact that contradicts the "delete anytime... file is removed from storage" framing the UI gives users for documents they *do* manage — a rejected file was never surfaced to the user as something to delete, since the UI's only signal is a "Failed" badge, not "this file was flagged as dangerous."
Evidence: `apps/api/src/modules/documents/graphs/nodes/scan-document.ts:146-185`; `apps/api/src/modules/documents/graphs/nodes/store-verification.ts:64-86`
Root cause: The scan-gate was designed to block further processing, not to clean up the object it rejected.
Remediation: On a scan rejection, call `storage.from('documents').remove([state.storagePath])` from the graph (or from the processor's error-handling branch) before returning, and update `document_access_logs` for the deletion.
Suggested regression test: Upload a file with mismatched magic bytes; after the queue processes it, assert the storage object no longer exists via `storage.list()`.
Confidence: CONFIRMED

### SEC-12007
Title: The nginx `/sbkong/` storage proxy (added by `cutover.sh`) has no `client_max_body_size` override and inherits nginx's 1MB default, contradicting the application's documented upload limits
Severity: Low
Affected component: `infra/self-hosted/cutover.sh`, production nginx configuration
Affected profile(s): applicant (upload UX/availability, not confidentiality)
Affected page/API: Every direct-to-storage upload PUT through `/sbkong/storage/v1/object/upload/sign/...`
Description: The templated nginx `location /sbkong/` block cutover.sh inserts carries no `client_max_body_size` directive:
```
block=f'''    location {path}/ {{
        proxy_pass {kong}/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        ...
    }}
'''
```
(`infra/self-hosted/cutover.sh:122-131`). It is inserted into the `visaai.co` server block (`location / { proxy_pass http://127.0.0.1:3002; ... }`), which — per the checked-in reference nginx config for the *other* domain — is where the app sets its explicit size override; the `visaai.co` block in `deploy/nginx/visaai.co.conf:15-30` has no `client_max_body_size` either, and cutover.sh does not add one to the block it patches. nginx's compiled-in default for `client_max_body_size` is 1MB. Meanwhile the app itself documents/expects up to 15MB (`MAX_UPLOAD_BYTES`, `apps/api/src/config/configuration.ts:111-115`) and storage-api is configured for 25MB (`FILE_SIZE_LIMIT: ${STORAGE_FILE_SIZE_LIMIT:-26214400}`, `infra/self-hosted/docker-compose.yml:156`).
Attack scenario: N/A — this is an availability/consistency defect, not an attacker-controlled bypass (a smaller effective cap is not a vulnerability by itself).
Business impact: If accurate in production, most scanned identity-document images (routinely 2–10MB from a phone camera) would fail to upload with a generic nginx 413, while the app's own UI advertises a 50MB limit (`MAX_FILE_SIZE_MB = 50`, see SEC-12008) — a functional defect that could also mask a legitimate DoS-relevant control as "broken" rather than "working as designed," making it harder to reason about actual limits during an incident.
Evidence: `infra/self-hosted/cutover.sh:118-147`; `deploy/nginx/visaai.co.conf:15-30`; `infra/self-hosted/docker-compose.yml:156`; `apps/api/src/config/configuration.ts:111-115`
Root cause: The size directive was set on the `api.visaai.co` block (for API JSON/webhook bodies) but never carried over to the storage proxy path added later by `cutover.sh`.
Remediation: Add `client_max_body_size` (sized to at least the storage-api `FILE_SIZE_LIMIT`, e.g. 30m for headroom) to the `location /sbkong/` block, and keep `deploy/nginx/visaai.co.conf` (the version-controlled reference) in sync with whatever `cutover.sh` actually applies so the two don't silently diverge.
Suggested regression test: A deploy-time smoke test that PUTs an 8–10MB file through the public storage upload URL and asserts success (currently would need live-server access to confirm; this repo audit could not verify the deployed nginx file matches the committed script's output).
Confidence: CONFIRMED (script/config as committed) / UNVERIFIED (exact state of the live `/etc/nginx/sites-available/visaai.co` file on the VPS, which per the repo's own comments is not kept in sync automatically)

### SEC-12008
Title: Maximum upload size is inconsistent across the client, storage backend, and scan gate (50MB / 25MB / 15MB)
Severity: Low
Affected component: `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx`, `infra/self-hosted/docker-compose.yml`, `apps/api/src/config/configuration.ts`
Affected profile(s): applicant
Affected page/API: Document upload flow
Description: Three different limits apply at three different layers with no single source of truth:
```
const MAX_FILE_SIZE_MB = 50
```
(`apps/web/.../documents-client.tsx:67`) is the only client-side gate before the browser even requests a signed URL. Supabase storage-api is configured for 25MB:
```
FILE_SIZE_LIMIT: ${STORAGE_FILE_SIZE_LIMIT:-26214400}   # DB-004: 25MB, matches the app's MAX_BYTES
```
(`infra/self-hosted/docker-compose.yml:156` — the comment claims parity with "the app's MAX_BYTES," which is true for the *messaging* module's 25MB constant but not for the documents module's scan gate). The documents-module scan gate defaults to 15MB:
```
MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),
```
(`apps/api/src/config/configuration.ts:111-115`).
Attack scenario: N/A — not attacker-triggered.
Business impact: A file between 15MB and 25MB passes the client check and the storage-api upload, gets registered as `upload_status: 'complete'`, and only then silently fails the async scan (`file exceeds 15728640 bytes`) with `ocr_status: 'failed'` and no specific user-facing reason (the UI just shows a generic "Failed" badge, per `documents-client.tsx:728`). A file between 25MB and 50MB passes the client check but is flatly rejected by storage-api at PUT time. Both are confusing-failure/UX defects that also make the actual, effective security boundary (15MB, enforced only asynchronously) non-obvious to anyone reasoning about the system's limits.
Evidence: `apps/web/app/[locale]/(dashboard)/documents/[applicationId]/documents-client.tsx:67-68`; `infra/self-hosted/docker-compose.yml:156`; `apps/api/src/config/configuration.ts:111-115`
Root cause: Three independently-configured constants with no shared source of truth.
Remediation: Pick one limit (recommend the smallest, 15MB, to match the scan gate, or raise the scan gate to match storage-api's 25MB and update the client to 25MB) and reference it from a single shared constant (`packages/types` or an env var read by both `apps/web` build and `apps/api`).
Suggested regression test: A contract test asserting `MAX_FILE_SIZE_MB * 1024 * 1024 <= MAX_UPLOAD_BYTES <= STORAGE_FILE_SIZE_LIMIT`.
Confidence: CONFIRMED

### SEC-12009
Title: WebSocket gateway logs the raw handshake auth payload (bearer token) via unredacted `console.error` on an unauthorized branch
Severity: Medium
Affected component: `apps/api/src/modules/intake/intake.gateway.ts`
Affected profile(s): any user, if this branch is ever reached
Affected page/API: `IntakeGateway` (`/intake` Socket.IO namespace), `intake:start` handler
Description: The socket middleware in `afterInit` reads the caller's JWT from `client.handshake.auth.token`:
```
const token = client.handshake.auth?.token as string | undefined;
```
(`apps/api/src/modules/intake/intake.gateway.ts:45`). A later handler, on an unauthorized condition, logs the entire handshake auth object — which is exactly the object containing that same `token` field — through raw `console.error`, not `safeLog` and not through pino (so none of the redaction config in SEC-12010's sibling finding applies):
```
if (!userId || !token) {
  console.error('Socket: intake:start unauthorized', {
    clientId: client.id,
    handshake: client.handshake.auth,
  });
```
(`apps/api/src/modules/intake/intake.gateway.ts:113-117`). Because `afterInit`'s middleware already rejects any connection lacking a valid token before `handleConnection`/`handleStart` can run, `client.data.userId`/`accessToken` should already be populated by the time `handleStart` executes, making this specific branch effectively unreachable under the current control flow — but it is not provably dead code, and it is the kind of latent foot-gun that turns into a live token leak the moment the auth flow is refactored (e.g., to support reconnect-without-full-handshake, or a future code path that clears `client.data` without disconnecting).
Attack scenario: If reached, any deployed log aggregator, `pm2 logs`, or on-disk log file would contain a raw, valid Supabase access token for the affected user in plaintext, usable to impersonate that user against any RLS-scoped endpoint until the token expires.
Business impact: Currently near-zero live risk (branch effectively unreachable), but high severity *if* it ever fires, and it is exactly the class of defect the codebase's own `redact.ts`/pino-redact investment was built to prevent — this line bypasses both.
Evidence: `apps/api/src/modules/intake/intake.gateway.ts:39-63` (middleware ordering), `:106-120` (the logging branch)
Root cause: Convenience debug logging of the full handshake object without stripping the `token` field, written before/without awareness of the redaction conventions established elsewhere in the codebase.
Remediation: Log only `{ clientId: client.id, hasToken: Boolean(client.handshake.auth?.token) }`, matching the pattern already used correctly in the web client (`apps/web/lib/socket.ts:26` — `tokenPresent: Boolean(token)`).
Suggested regression test: A lint rule (or a simple grep-based CI check) that flags `console.log/error/warn` calls whose arguments include `handshake.auth`, `req.headers`, or similarly-named token-bearing objects.
Confidence: CONFIRMED (code exists as shown) — reachability today assessed as LOW given the middleware ordering, not zero.

### SEC-12010
Title: The `safeLog` PII-redaction helper is inconsistently adopted — most catch blocks across `documents`, `intake`, and `prefill` use raw, unredacted `console.*`
Severity: Low
Affected component: Multiple — `documents.processor.ts`, `intake.service.ts`, `intake.gateway.ts`, `update-checklist.ts`, `ask-question.ts`, `prefill-pdf.ts`
Affected profile(s): applicant (whose data may appear in AI-generated text or error payloads)
Affected page/API: Various error/catch paths in the intake and document pipelines
Description: `apps/api/src/modules/shared/log/redact.ts` exists specifically so "OCR'd PII doesn't end up in CloudWatch / Railway logs" (its own doc comment), and is used correctly in `documents.service.ts` and `scan-document.ts`. But a repo-wide search of the modules in this audit's scope shows raw `console.log/error/warn` at, among others:
```
apps/api/src/modules/documents/documents.processor.ts:189,201,235
apps/api/src/modules/intake/intake.service.ts:353
apps/api/src/modules/intake/graphs/nodes/update-checklist.ts:339,355,475
apps/api/src/modules/intake/graphs/nodes/ask-question.ts:274,287,293
apps/api/src/modules/prefill/prefill-pdf.ts:144
```
Most of these log only `err.message` (low risk), but `ask-question.ts:287` logs the full text of an AI-generated intake question verbatim:
```
console.log('[ask-question] Generated question:', question)
```
This question is built from a prompt that embeds the applicant's live profile/checklist state (`asUntrustedData('Applicant profile so far', profileSummary)` a few lines above, `ask-question.ts:262`), so the model's phrasing can plausibly echo back applicant-supplied facts into an unredacted log line.
Attack scenario: N/A directly — this is a logging-hygiene gap, exploitable only by whoever already has log access (ops/on-call), which is a smaller trust boundary than the public internet, but still a real PII-minimization gap for a passport-handling platform.
Business impact: Inconsistent application of an existing control undermines the "we redact PII in logs" claim implied by `redact.ts`'s existence; increases the PII surface of any log-storage compromise or over-broad log-access grant.
Evidence: as listed above; `apps/api/src/modules/shared/log/redact.ts:1-8` (stated intent)
Root cause: `safeLog` was introduced after (or alongside) much of the existing logging, and was not backfilled everywhere.
Remediation: Replace the listed `console.*` call sites with `safeLog.warn`/`safeLog.error`, and add an ESLint rule banning bare `console.*` in `apps/api/src/modules/**` in favor of the injected pino `Logger` or `safeLog`.
Suggested regression test: ESLint `no-console` (scoped to `apps/api/src`, with an allowlist for `main.ts` bootstrap logging) wired into CI.
Confidence: CONFIRMED

### SEC-12011
Title: Client-declared attachment `kind` controls whether content renders via `<img>` or direct navigation, without being derived from the verified content type
Severity: Low
Affected component: `apps/api/src/modules/messaging/attachment.service.ts` (server), `apps/web/components/messaging/attachment-view.tsx` (client)
Affected profile(s): messaging participants (applicant, consultant, admin)
Affected page/API: `POST /messaging/:applicationId/attachments` (confirm), attachment rendering in the conversation thread
Description: `confirmAttachment` persists whatever `kind` the client sent in the request body (`AttachmentKind`, e.g. `'image' | 'file'`) without deriving it from the (weakly-verified, per SEC-12002) actual MIME type:
```
async confirmAttachment(token, caller, applicationId, input: { ..., kind: AttachmentKind, ... }) {
  this.assertAllowed(input.kind, input.mimeType, input.sizeBytes);
  const actual = await this.assertObjectValid(input.storagePath, input.kind);
  ...
  const attachment = await this.attRepo.insertAttachment(db, { ..., kind: input.kind, ... });
```
(`apps/api/src/modules/messaging/attachment.service.ts:183-233`). The `kind` field is what the frontend uses to decide the rendering path:
```
if (attachment.kind === 'image') {
  return <img src={url} .../>
}
return <a href={url} target="_blank" rel="noopener noreferrer">{attachment.file_name}</a>
```
(`apps/web/components/messaging/attachment-view.tsx:22-25`). So a caller could declare `kind: 'file'` for genuinely image content (routed through direct top-level navigation instead of an `<img>` sandboxed load) or `kind: 'image'` for a PDF (routed through `<img>`, which will simply fail to decode). Combined with the allowlist in `assertAllowed`, this is not exploitable today for script execution, but it is one more place where a client-supplied label is trusted for a security-relevant rendering decision instead of being derived server-side from verified content.
Attack scenario: Low — bounded by the same allowlist as SEC-12002; noted here because it is the concrete mechanism that would matter if that allowlist is ever loosened.
Business impact: Minor; mostly a "wrong renderer" UX bug today, escalates only in combination with SEC-12001/SEC-12002.
Evidence: `apps/api/src/modules/messaging/attachment.service.ts:183-233`; `apps/web/components/messaging/attachment-view.tsx:8-26`
Root cause: `kind` is treated as descriptive metadata rather than a security-relevant routing decision.
Remediation: Derive the rendering kind server-side from the verified MIME family (`image/*` → `'image'`, everything else → `'file'`) instead of trusting the client's declared `kind`, once SEC-12002's magic-byte check lands.
Suggested regression test: Confirm an attachment with `mimeType: 'application/pdf'`, `kind: 'image'`; assert the persisted `kind` is `'file'` after the fix (currently persists `'image'` as declared).
Confidence: CONFIRMED

### SEC-12012
Title: No true anti-malware engine is wired in by default — content safety rests entirely on the magic-byte allowlist
Severity: Informational
Affected component: `apps/api/src/modules/documents/graphs/nodes/scan-document.ts`
Affected profile(s): applicant
Affected page/API: async OCR/scan pipeline
Description: `SCAN_PROVIDER` defaults to `'none'` (`apps/api/src/config/configuration.ts:109`), and the code is explicit and fails closed about this:
```
if (opts.avProvider !== 'none') {
  // TODO(F3): submit `bytes` to the configured AV engine; quarantine + error
  // on a positive detection. Fail closed until implemented.
  return { error: `AV provider "${opts.avProvider}" is not implemented yet. Wire it before enabling.` };
}
```
(`apps/api/src/modules/documents/graphs/nodes/scan-document.ts:175-181`). This is a self-documented, intentional gap, not a silent one — flagged here per the audit's explicit checklist item, not because the current behavior (fail closed when misconfigured) is unsafe.
Attack scenario: A file that is a valid, magic-byte-matching PDF/PNG/JPEG but embeds malicious content specific to that format (e.g., a PDF exploiting a vulnerable downstream parser, if one is ever introduced) would not be caught by the byte-signature allowlist alone, since it only validates the outer container format, not semantic safety.
Business impact: Acceptable given documents are consumed by cloud OCR vendors (Azure/AWS/Google/OpenAI, not a locally-executed parser) for the primary pipeline, and by `pdf-lib`-based template filling for *system-authored* PDFs, not arbitrary user uploads — but this residual risk should be an explicit, tracked decision rather than an implicit one.
Evidence: `apps/api/src/config/configuration.ts:109`; `apps/api/src/modules/documents/graphs/nodes/scan-document.ts:14-21,175-181`
Root cause: AV integration deprioritized (documented as F3/TODO) in favor of the baseline magic-byte gate.
Remediation: Wire ClamAV (already a named option in the `avProvider` enum) as at least an opt-in for production, or explicitly document the residual-risk acceptance in a security decision log.
Suggested regression test: N/A (tracking item, not a bug).
Confidence: CONFIRMED (as a documented, intentional gap)

### SEC-12013
Title: Chrome-extension document handoff selects documents by `upload_status`, not `ocr_status` — a malware/magic-byte-scan-rejected file remains eligible to be signed and sent to the extension if the deprecated legacy automation path is re-enabled
Severity: Low
Affected component: `apps/api/src/modules/automation/automation.service.ts`
Affected profile(s): applicant
Affected page/API: `AutomationGateway` `automation:start` (currently gated off — `LEGACY_AUTOMATION_WRITE_ENABLED` defaults false, throws `GoneException` otherwise)
Description:
```
private async loadUploadableDocuments(applicationId: string) {
  const { data: docs } = await this.supabase.admin
    .from('documents')
    .select('document_type, storage_path, file_name, upload_status')
    .eq('application_id', applicationId)
    .eq('upload_status', 'complete');
```
(`apps/api/src/modules/automation/automation.service.ts:199-203`). `upload_status` is set to `'complete'` synchronously at registration time (`documents.service.ts:160` — before any scan runs), while the malware/magic-byte verdict lives in the separate `ocr_status` column, which this query never filters on. A document that the async scan later rejects (`ocr_status: 'failed'`, per SEC-12006) is never excluded here.
Attack scenario: Requires `LEGACY_AUTOMATION_WRITE_ENABLED=true` (off by default, per the Phase 4B deprecation comment at `automation.service.ts:44-56`) and a valid, ownership-verified, payment-gated session token — i.e., this is a compounding factor on top of SEC-12005/SEC-12006, not independently exploitable while the flag is off.
Business impact: If the legacy path is ever re-enabled (e.g., during a rollback), a document that failed content-safety scanning could still be signed and handed to the Chrome extension for submission to a government portal.
Evidence: `apps/api/src/modules/automation/automation.service.ts:44-56,194-245`
Root cause: The query predicate was written against the upload-completion flag rather than the content-safety flag.
Remediation: Add `.eq('ocr_status', 'complete')` (or explicitly exclude `'failed'`) to the query, independent of whether/when the legacy path is re-enabled.
Suggested regression test: With `LEGACY_AUTOMATION_WRITE_ENABLED=true` in a test environment, register a document that fails the scan, then assert it is absent from `buildInstructions()`'s upload steps.
Confidence: CONFIRMED (code logic) — exploitability CONFIRMED-gated-off (flag defaults false)

### SEC-12014
Title: Signed URLs (upload and download) necessarily appear in nginx access logs as query-string tokens
Severity: Informational
Affected component: Infrastructure (nginx access logging), all signed-URL issuance
Affected profile(s): applicant, consultant
Affected page/API: All `createSignedUrl`/`createSignedUploadUrl` consumers
Description: Every signed URL returned to a browser or extension (documents, messaging attachments/voice, automation document handoff, doc/form templates — though the last two are proxied through the API and never reach nginx as a storage link, see the endpoint table) is a plain HTTPS GET/PUT with the auth token in the query string. nginx's default access-log format includes the full request URI, so these tokens land in `access.log` on both `api.visaai.co` and the `/sbkong/` storage path. This is standard, expected behavior for the signed-URL pattern (not a bug introduced by this codebase), and is meaningfully mitigated by short TTLs already in place: 60s (`fetch-document.ts:10`), 300s (`attachment.service.ts:28`), 600s (`automation.service.ts:33`).
Attack scenario: Requires read access to nginx access logs, a smaller trust boundary than the public internet; noted for completeness per the audit's checklist ("do signed URLs leak via Referer, logs, or shared links").
Business impact: Low, given TTLs; anyone who can read production access logs could replay a token within its (short) validity window.
Evidence: `apps/api/src/modules/documents/graphs/nodes/fetch-document.ts:10`; `apps/api/src/modules/messaging/attachment.service.ts:28`; `apps/api/src/modules/automation/automation.service.ts:33`
Root cause: Inherent to bearer-token-in-URL signed-link designs.
Remediation: Ensure nginx access-log retention/access is restricted to the same trust tier as application secrets; consider logging with the query string stripped (`$uri` instead of `$request_uri`) for the storage proxy location specifically, given it is pure file traffic with no debugging value in the token itself.
Suggested regression test: N/A (infra hardening item).
Confidence: PLAUSIBLE (standard nginx default-log behavior; not independently verified against the live server's actual `log_format` directive, which is not in this repo)

---

## Summary

- Endpoint table rows: **12** (11 distinct upload/download surfaces + 1 contrast row)
- Findings by severity: **0 Critical, 0 Critical-with-confirmed-exploit** / **3 High** (SEC-12001, SEC-12003) — *correction, see below* / **6 Medium** / **5 Low** / **2 Informational**

  Exact counts: High = 2 (SEC-12001, SEC-12003); Medium = 4 (SEC-12002, SEC-12004, SEC-12005, SEC-12009); Low = 6 (SEC-12006, SEC-12007, SEC-12008, SEC-12010, SEC-12011, SEC-12013); Informational = 2 (SEC-12012, SEC-12014). Total = 14 findings, IDs SEC-12001–SEC-12014.

- Logging-redaction verdict: **Partial.** A real, purpose-built redaction layer exists at two levels — `nestjs-pino`'s `redact` config for HTTP headers/body fields (`logger.config.ts`) and the app's own `safeLog`/`redact.ts` regex scrubber for PII patterns (emails, JWTs, ID-like strings, dates) — and both are correctly used in the core document-scan/upload path. But adoption is inconsistent: multiple modules (`intake`, parts of `documents.processor`, `prefill`) use raw `console.*` that bypasses both layers entirely, and one specific branch (`intake.gateway.ts:114-117`) logs the raw WebSocket handshake object containing the bearer token — currently gated to near-unreachable by middleware ordering, but present in the code as-is. Sentry is configured correctly (`sendDefaultPii: false`, no body/PII attachment).

- One-line titles, High/Medium (Critical/High requested — none rated Critical this pass; High and Medium listed):
  - **SEC-12001 (High):** Document/attachment storage shares the same origin as the web app, removing cross-origin isolation as a backstop against any future content-type bug.
  - **SEC-12003 (High):** GDPR account erasure never deletes message/voice attachment files — only two of three path levels are purged from storage.
  - **SEC-12002 (Medium):** Message/voice attachments trust the client's `Content-Type` header as-is; content is never magic-byte verified.
  - **SEC-12004 (Medium):** Document access log only records upload/delete, never view/download/ocr, contradicting the schema and the in-app privacy copy.
  - **SEC-12005 (Medium):** Identity-document presign/register endpoints have no synchronous type/size allowlist; validation is fully deferred to an async post-upload scan.
  - **SEC-12009 (Medium):** WebSocket gateway logs the raw handshake auth object (containing the bearer token) via unredacted `console.error` on a currently-near-unreachable branch.
