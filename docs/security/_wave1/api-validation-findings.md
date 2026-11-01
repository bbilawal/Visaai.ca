# API Input Validation, Injection, Resource Abuse, CORS, Error Handling — Findings

Scope: apps/api (NestJS 11), apps/web (Next.js) where relevant to these bug classes, supabase/migrations, deploy/nginx. Read-only audit, no files modified. Out of scope: authn, authz/IDOR, payments (owned by other audit agents) — noted only where an input-validation root cause has an authz-adjacent side effect.

ID block: SEC-3001–SEC-3999, allocated sequentially (SEC-3001–SEC-3017 used). Two parallel sub-agents were dispatched for the SSRF/path-traversal/command-injection/prototype-pollution cluster and the redirect/header-injection/resource-consumption/data-exposure cluster respectively; both, on review, either duplicated or drifted from their assigned scope, so **every finding below was directly investigated and verified by the lead agent** (read the actual source, not a sub-agent summary) rather than merged from delegated output. Sub-agent output was used only as a pointer to two leads that were then independently re-verified from source (the `storagePath` trust-boundary gap, folded into SEC-3005; and the unauthenticated/unbounded marketplace and AI-throttle observations, folded into SEC-3012/SEC-3013).

**Finding count by severity: 1 CRITICAL, 1 HIGH, 5 MEDIUM, 4 LOW, 6 checked-with-no-finding (positive controls, documented for completeness/audit-trail value).**

---

## Executive summary

**ValidationPipe verdict: ABSENT, and by design — REFUTED as a meaningful finding on its own.** `apps/api/src/main.ts` registers no global `ValidationPipe`; `app.module.ts` has no `APP_PIPE` provider. However, this codebase does **not** use `class-validator` decorators at all — confirmed zero files use `@IsString`/`@IsEmail`/`@IsUUID`/etc. The repository's explicit, documented convention (`apps/api/src/modules/admin/admin.dto.ts:3`: `// zod (repo convention — no global ValidationPipe / class-validator). Strict.`) is to validate with **zod schemas invoked manually per route** — either via `schema.safeParse(body)` inline, a local `parse(schema, body)` helper (e.g. `billing.controller.ts:37`, `partner-portal.controller.ts:31`), or the shared `parseBody()` helper in `apps/api/src/common/zod-body.ts`. A few controllers (`messaging.controller.ts`, `notifications.controller.ts`, `document-request.controller.ts`) use hand-written `if (...) throw new BadRequestException(...)` guards instead of zod, which is an equivalent but less consistent idiom.

The real finding is not "no ValidationPipe" — it's that **validation is 100% opt-in per handler with no enforcement mechanism**, so coverage is uneven. Two controllers (`ConsultantController`, `AlertsController`) were found with `@Body()` parameters that receive **zero runtime validation of any kind** — the declared TypeScript shape is erased at runtime and whatever the client sends reaches the service/DB layer unchecked. This is exactly the class of bug the codebase's own `zod-body.ts` comment documents as "API-002" (already fixed in some routes, not in these).

**Counts:**
- Controllers: **70** (`apps/api/src/**/*.controller.ts`, excluding specs)
- Total `@Body()` parameters across controllers: **123**
- Zod schema files (`import ... from 'zod'`): **43**
- Dedicated `*.dto.ts` files: **15**
- Files using `class-validator` decorators: **0**
- Controllers with `@Body()` and **zero** validation signal (no `parse`/`safeParse`/`parseBody`/`BadRequestException`/manual guard) after manual verification: **2 of 70** — `modules/consultant/consultant.controller.ts` (7 endpoints), `modules/analytics-alerts/alerts.controller.ts` (1 of 2 endpoints unvalidated, 1 partially validated). A third, `modules/documents/documents.controller.ts`, has one endpoint (`registerDocument`) with correct *ownership* validation but no *type* validation on `mimeType`/`fileName`.
  - Note: a coarse first-pass grep also flagged `alerts.controller.ts`, `analytics.controller.ts`, `documents.controller.ts` and `consultant.controller.ts`; manual review confirmed `analytics.controller.ts` is a false positive (validation happens one layer down, in `parseClientEvent()` via a zod `clientSchema.safeParse`) and further confirmed the other three by reading the code and the services they call.

**ThrottlerModule config (as configured):** `apps/api/src/app.module.ts`
```ts
ThrottlerModule.forRoot([
  {
    ttl: Number(process.env.THROTTLE_TTL_MS ?? 60_000),
    limit: Number(process.env.THROTTLE_LIMIT ?? 60),
  },
]),
```
Default: **60 requests / 60,000 ms per IP**, global (`APP_GUARD: ThrottlerGuard`), env-overridable. No override found in `.env.example` at either the repo root or `apps/api/.env.example` — UNVERIFIED whether the live VPS `.env` overrides it (not accessible from this audit).

`@SkipThrottle()` sites (all reviewed, all judged intentional/documented):
| Site | Justification found in code |
|---|---|
| `app.controller.ts:16` | Root/health-adjacent, trivial |
| `health.controller.ts:29` | Health check |
| `modules/documents/documents.controller.ts:65` (`GET :applicationId`) | Plain read, no comment given — see SEC-3007 note |
| `modules/messaging/messaging-sse.controller.ts:29` | Comment: "connections are capped (429 over the cap); the route is @SkipThrottle'd because that cap—" (own connection-count limiter substitutes for request-rate throttling) |
| `modules/billing/billing.controller.ts:176,193` (`/webhook`, `/webhook/connect`) | Stripe webhook delivery must never be rate-limited away; protected by signature verification, not throttling — standard practice |

`@Throttle()` per-route overrides (tighter than global default):
- `iam/security.controller.ts:46,57` — 10/min, 5/min (sensitive security-event endpoints)
- `partner/partner-oauth.controller.ts:84,139` — 20/min, 30/min
- `analytics/analytics.controller.ts:39,60` — 30/min on the unauthenticated `collect`/`identify` beacon endpoints (also capped server-side by `ANALYTICS_COLLECT_MAX_EVENTS`, default 50, at `analytics.controller.ts:46-47`)

**CORS (as configured), `apps/api/src/main.ts:35-40`:**
```ts
app.enableCors({
  origin: process.env.WEB_URL || 'http://localhost:3000',
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});
```
Single static origin from `WEB_URL`, not a wildcard, not an origin-reflecting function. `credentials: true` is only dangerous when paired with a wildcard/reflected origin — it is not here. No wildcard/reflection found anywhere in `deploy/nginx/visaai.co.conf` (pure `proxy_pass` reverse proxy, sets no `Access-Control-*` headers at all — confirmed by grep, no matches) or in `apps/web` (no `next.config.ts` `headers()` block setting CORS, no route handler setting `Access-Control-Allow-Origin`).

Three WebSocket gateways also set `cors`, decorator-time (`process.env.WEB_URL` read at class-decoration time, hence the `main.ts:1-4` comment about loading `.env` before any imports):
- `modules/intake/intake.gateway.ts:20-24` and `modules/voice/voice.gateway.ts:32-36` — mirror the HTTP CORS config exactly (`WEB_URL`, `credentials: true`). No issue.
- `modules/automation/automation.gateway.ts:22-23` — `cors: { origin: '*', credentials: false }`. This IS a wildcard, but `credentials: false` makes it spec-compliant (browsers reject `*` + credentials together, so this isn't the dangerous combination), and the code comment explains why: `// Clients are Chrome extensions (chrome-extension:// origin) — not WEB_URL, so origin cannot be restricted here. Security boundary is the single-use token (GETDEL, 5-min TTL) redeemed on connect, NOT CORS.` Verified in `handleConnection()` (`automation.gateway.ts:35-49`): the socket is disconnected unless `client.handshake.auth.token` redeems successfully via `SessionTokenService.redeem()`. This is a deliberate, defensible design (origin-based CORS cannot restrict a browser extension's background-page origin), not a misconfiguration. No finding.

**Verbose errors / `AllExceptionsFilter` (`apps/api/src/common/http-exception.filter.ts`):** reviewed in full. 5xx responses are hardcoded to the generic string `'Internal server error'` (line 45) regardless of the underlying exception; the real `exception.stack` is only sent to the server-side pino logger (`logger.error(...)`, line 78-81) and to Sentry (no-op unless `SENTRY_DSN` set), never to the client. 4xx responses forward `exception.getResponse()`'s message, which is by design (zod `.flatten()` / validation messages) — this is intentional client-facing detail, not a leak of internals. **No stack trace, DB error text, internal path, or PG error code leaks to the client in production.** This is a correctly implemented control — reported as checked, not a finding.

---

## Findings

### SEC-3001
Title: No enforced validation layer — coverage is 100% opt-in per route, with confirmed gaps
Severity: MEDIUM
Affected component: apps/api — framework-level (missing `APP_PIPE`/global validation gate)
Affected profile(s): all
Affected page/API: all `@Body()`/`@Query()` parameters across 70 controllers
Description: There is no global `ValidationPipe` (confirmed: not in `main.ts`, no `APP_PIPE` in `app.module.ts`) and no `class-validator` usage anywhere in the codebase (confirmed: 0 files use `@IsString`/`@IsEmail`/etc. decorators). Validation is instead performed manually, per-handler, using zod (`schema.safeParse`/`.parse`, a local `parse()` helper, or the shared `parseBody()` helper in `common/zod-body.ts`) or hand-written guard clauses. Because there is no single enforcement point, coverage depends entirely on each handler author remembering to call one of these — and two controllers do not (see SEC-3002, SEC-3003).
Attack scenario: A new or modified endpoint ships without a validation call. Malformed, wrong-typed, or excess-field request bodies reach the service/repository layer, where they either cause an unhandled exception surfaced as a generic 500 (denial-of-clean-error, not itself a breach) or — worse, as in SEC-3002/SEC-3003 — get written to the database or drive business logic unchecked.
Business impact: Ongoing risk of the same class of bug recurring as the API surface grows (70 controllers today, `CLAUDE.md` states 51 modules / 54,538 LOC and growing). No CI/lint gate currently catches a `@Body() body: any` slipping through review.
Evidence:
```
apps/api/src/main.ts — no `app.useGlobalPipes(new ValidationPipe(...))` anywhere in the file (full file read).
apps/api/src/app.module.ts — `providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }]` — no APP_PIPE.
apps/api/src/modules/admin/admin.dto.ts:3 — "// zod (repo convention — no global ValidationPipe / class-validator). Strict."
```
Root cause: Architectural choice (documented, intentional) to use zod instead of class-validator/ValidationPipe, without a compensating global enforcement mechanism (e.g. an interceptor that requires every `@Body()` parameter to have passed through a schema, or a lint rule banning bare `@Body() body: <interface>` / `@Body() body: any`).
Remediation: Either (a) add a lightweight custom `ZodValidationPipe` applied globally that requires each route to declare its schema via a decorator/metadata (fails closed if none is declared), or (b) add an ESLint rule / CI check that flags `@Body()` parameters typed as `any`, a bare TS `interface`, or `unknown` without a corresponding `.safeParse`/`.parse`/`parseBody(` call in the same method body. Fix the two confirmed gaps (SEC-3002, SEC-3003) regardless of which systemic fix is chosen.
Suggested regression test: A static-analysis test (e.g. a Jest test that greps compiled controller source for `@Body()` occurrences and asserts a validation call appears in the same handler) run in CI, so a future unvalidated endpoint fails the build.
Confidence: CONFIRMED

---

### SEC-3002
Title: ConsultantController — 7 endpoints accept `@Body()` with zero runtime validation
Severity: MEDIUM
Affected component: apps/api — `modules/consultant/consultant.controller.ts`
Affected profile(s): consultant, admin/owner (endpoints are role-gated, see below — this is a validation finding, not an authz finding)
Affected page/API: `POST /applications/:applicationId/consultant/assignments`, `/reassign`, `/fields/:fieldKey/review`, `/fields/:fieldKey/approve`, `/fields/:fieldKey/reject`, `/approve`, `/reject`, `/revoke`
Description: All seven `@Body()`-accepting handlers in this controller type the body as a bare TypeScript `interface` (`AssignBody`, `ValueHashBody`, `ReasonBody`, `RevokeBody` — declared lines 22-36) with an explicit code comment stating `// Request DTOs (plain shapes; the service performs all validation).` The service (`ConsultantApprovalService`) performs **authorization** checks (`assertAssigned`) and simple truthiness checks (`if (!reason?.trim())`) but never validates the *shape* of `body.consultantId`, `body.valueHash`, or — most notably — `body.scope` in the `revoke` handler, which is typed `ConsultantApprovalScope` (a 3-value union: `'field' | 'section' | 'application'`) but never checked against that enum at runtime.
Attack scenario: An authenticated consultant (role-gated, must also be the assigned consultant per `assertAssigned`) calls `POST /applications/:id/consultant/revoke` with `{"scope": "anything-not-in-the-enum", "reason": "x"}`. `revoke()` (`consultant.controller.ts:209-223`) passes `body.scope` straight through to `ConsultantApprovalService.revoke()` (`consultant-approval.service.ts:209-231`), which passes it straight into the `record()` call that persists the decision (ultimately written to the `consultant_approvals`/decision audit table). No 400 is ever raised; the out-of-enum value is durably stored in what is documented as an audit/compliance trail ("Every decision emits an audit event"). Similarly, `assign`/`reassign` pass `body.consultantId` with no type/format check — a missing or non-string value reaches `this.repo.insertAssignment(applicationId, consultantId)` and fails as an opaque DB-level error (generic 500 via `AllExceptionsFilter`) instead of a clean 400.
Business impact: (1) Data-integrity risk in the consultant-approval audit trail, which is explicitly described in the code as the "external authority gate" for the immigration-application review workflow — an unvalidated `scope` value could cause downstream rollup logic (`getApplicationApproval`) that pattern-matches on the 3 known scope values to silently mis-handle the record. (2) Poor API ergonomics (500s instead of 400s) for malformed input, which is itself the same "API-002" class of bug the codebase already fixed elsewhere via `zod-body.ts`.
Evidence:
```
apps/api/src/modules/consultant/consultant.controller.ts:21-36
// Request DTOs (plain shapes; the service performs all validation).
interface AssignBody {
  consultantId: string;
}
...
interface RevokeBody {
  scope: ConsultantApprovalScope;
  fieldKey?: string;
  section?: string;
  reason: string;
}

apps/api/src/modules/consultant/consultant.controller.ts:209-223
  @Post('revoke')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  revoke(
    @Param('applicationId') applicationId: string,
    @Body() body: RevokeBody,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.revoke(
      applicationId,
      user.id,
      { scope: body.scope, fieldKey: body.fieldKey, section: body.section },
      body.reason,
    );
  }

apps/api/src/modules/consultant/consultant-approval.service.ts:209-223 (revoke) — no validation of `target.scope` against the 3-value union before it is handed to `record()` and persisted.
```
Root cause: Handler-local decision to skip the zod pattern used elsewhere in the same module family (contrast with `admin/admin.dto.ts`'s `AssignConsultantDto = z.object({ consultantId: z.string().uuid() })`, which validates the *same* logical field correctly one module over).
Remediation: Add a zod schema per endpoint (`z.object({ consultantId: z.string().uuid() })`, `z.object({ valueHash: ... })`, `z.object({ reason: z.string().min(1) })`, `z.object({ scope: z.enum(['field','section','application']), fieldKey: z.string().optional(), section: z.string().optional(), reason: z.string().min(1) })`) and validate via `parseBody()`/`parse()` before calling the service, mirroring `admin.dto.ts`'s existing `AssignConsultantDto`.
Suggested regression test: `POST .../revoke` with `scope: "not-a-real-scope"` should return 400, not a stored record; `POST .../assignments` with `consultantId` omitted or non-UUID should return 400, not a 500.
Confidence: CONFIRMED

---

### SEC-3003
Title: AlertsController.update() accepts an untyped `any` patch with zero validation (admin-gated)
Severity: LOW
Affected component: apps/api — `modules/analytics-alerts/alerts.controller.ts`
Affected profile(s): admin only (`@RequireRole('admin')` at class level)
Affected page/API: `PATCH /analytics/alerts/:id`; secondarily `POST /analytics/alerts` (partially validated)
Description: `update()` takes `@Body() patch: any` and passes it directly to `this.repo.updateRule(id, patch)` with no validation call of any kind (`alerts.controller.ts:81-86`). The concrete repository implementation (`analytics-alerts.repository.impl.ts:100-114`) does allowlist which *keys* it copies into the DB update (`if (patch.name !== undefined) row.name = patch.name; ...`), so this is **not** a mass-assignment/column-injection bug — but it performs no *type* checking on the values it does copy: `patch.conditions`, `patch.query`, `patch.combine`, `patch.recipients`, `patch.notifyUserIds` are stored as-is into JSON/array columns with no shape validation, meaning a malformed `conditions` array can corrupt a live alert rule (silently breaking `AlertEvaluatorService.evaluate()` at evaluation time rather than failing the write with a 400). Separately, `create()` (`alerts.controller.ts:55-70`) does call a `private validate(body: any)` (lines 43-53), but it only checks `body.conditions` is a non-empty array and `body.metricKey` is a known metric — `body.name`, `body.combine`, `body.recipients`, `body.notifyUserIds`, `body.enabled` are all used unchecked.
Attack scenario: Limited — this whole controller is class-level gated to `admin` role. The realistic scenario is an admin (or an admin session compromised via a separate bug) submitting a malformed alert-rule patch that corrupts the alerting pipeline (e.g. `conditions: "not-an-array"` bypasses the `create()` check entirely on `update()` since `update()` has no check at all), degrading the analytics-alerts feature until manually fixed.
Business impact: Low — privileged-only surface, availability/correctness impact on the internal alerting feature rather than data exposure or privilege escalation.
Evidence:
```
apps/api/src/modules/analytics-alerts/alerts.controller.ts:81-86
  @Patch(':id')
  async update(@Param('id') id: string, @Body() patch: any) {
    const r = await this.repo.updateRule(id, patch);
    if (!r) throw new AlertNotFoundError(id);
    return r;
  }

apps/api/src/modules/analytics-alerts/analytics-alerts.repository.impl.ts:100-114
  async updateRule(id: string, patch: Partial<AlertRuleRow>): Promise<AlertRuleRow | null> {
    const row: any = { updated_at: new Date().toISOString() };
    if (patch.name !== undefined) row.name = patch.name;
    ...
    if (patch.conditions !== undefined) row.conditions = patch.conditions;
    ...
```
Root cause: `validate()` in the controller was written for `create()` only and never reused/extended for `update()`; no zod schema exists for either endpoint despite the rest of the analytics-alerts module (and sibling admin modules) using zod elsewhere in the codebase.
Remediation: Define a zod `AlertRulePatchDto` mirroring the repo's `Partial<Pick<AlertRuleRow, ...>>` type (name, metricKey, metric, query, conditions, combine, recipients, notifyUserIds, enabled) with per-field shape validation (conditions as a real `Condition[]` schema, recipients/notifyUserIds as string arrays), and validate both `create()` and `update()` bodies against it.
Suggested regression test: `PATCH /analytics/alerts/:id` with `{"conditions": "x"}` should return 400.
Confidence: CONFIRMED

---

### SEC-3004
Title: `organizations.plan` is directly client-settable via `PATCH /organizations/:id` (self-service org admin) — dormant billing-bypass landmine
Severity: HIGH
Affected component: apps/api — `modules/iam/organizations.controller.ts`, `organizations.service.ts`, `iam.dto.ts`, `iam.repository.impl.ts`
Affected profile(s): any authenticated user (any user can self-create an organization and thereby become its `org_admin`)
Affected page/API: `PATCH /organizations/:id`
Description: `UpdateOrgDto` (the zod schema gating this endpoint) explicitly whitelists `plan` as a client-settable field: `plan: z.string().min(1).max(40).optional()` (`iam.dto.ts:26`). The only authorization check before the write is `assertAdmin(caller, orgId)` (`organizations.service.ts:101`), which requires the caller be an **org-scoped `org_admin`** of *that specific org* — not a platform/billing admin. Any authenticated user can call `POST /organizations` to create an org, which automatically grants them `org_admin` on it (`organizations.service.ts:56-73`: `// Owner becomes an active org_admin member + holds the org-scoped org_admin role.`). They can then call `PATCH /organizations/:id` with `{"plan": "enterprise"}` (or any string up to 40 chars) and it is written directly to the `organizations.plan` column via `repo.updateOrganization(orgId, patch)` → `.update({ ...patch, updated_at: ... })` (`iam.repository.impl.ts:292-303`). This is exactly the pattern the audit brief calls out by name: a `plan`/`price`/`amount`-class field that "should be server-controlled" being accepted straight from the client.
Attack scenario: `POST /organizations {"name":"x"}` → caller becomes `org_admin` of the new org → `PATCH /organizations/:id {"plan":"enterprise"}` → 200, `organizations.plan = 'enterprise'` with no payment, Stripe interaction, or platform-admin approval anywhere in the path.
Business impact: **Currently limited but latent.** Grepped the entire `apps/api/src` tree for any read of `organizations.plan` used for entitlement/feature-gating (`get_advisors`-style search across `entitlement`, `billing`, `subscriptions`, and `iam` modules, plus a repo-wide search for `organizations').select` and `.plan ===`): **no code path currently reads `organizations.plan` back to gate any feature or entitlement.** Actual billing/entitlement gating in this codebase runs through the separate `subscriptions`/`billing` tables and Stripe webhooks (`subscriptions.repository.impl.ts:42`, `subscriptions.module.ts` — different `plan` field, on a different table, driven by Stripe metadata). So today this is a write to an inert column, not an active bypass. It becomes a full billing/entitlement bypass the moment any future feature reads `organizations.plan` for gating (a very natural thing to build given the column already exists and is named exactly for that purpose) — this is the kind of finding that looks harmless until it silently becomes CRITICAL. Recommend fixing before any org-level entitlement feature is built on top of this column, not after.
Evidence:
```
apps/api/src/modules/iam/iam.dto.ts:23-29
export const UpdateOrgDto = z
  .object({
    name: z.string().min(1).max(120).optional(),
    plan: z.string().min(1).max(40).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, { message: 'No fields to update' });

apps/api/src/modules/iam/organizations.controller.ts:63-72
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = UpdateOrgDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.orgs.update(this.caller(user), id, parsed.data);
  }

apps/api/src/modules/iam/organizations.service.ts:96-105
  async update(caller: OrgCaller, orgId: string, patch: Partial<Pick<Organization, 'name' | 'plan' | 'settings'>>): Promise<Organization> {
    await this.assertAdmin(caller, orgId);
    const org = await this.repo.updateOrganization(orgId, patch);
    ...

apps/api/src/modules/iam/organizations.service.ts:56-65 (org creation grants org_admin to the creator)
    await this.repo.addMember({ organizationId: org.id, userId: caller.id, role: 'org_admin', status: 'active' });

apps/api/src/modules/iam/iam.repository.impl.ts:292-303
  async updateOrganization(id: string, patch: Partial<Pick<Organization, 'name' | 'plan' | 'settings'>>): Promise<Organization | null> {
    const { data, error } = await this.db
      .from('organizations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      ...
```
Root cause: A billing-relevant field (`plan`) was included in the same generic "update your org" DTO/endpoint as genuinely user-owned settings (`name`, `settings`), gated only by org-scoped admin authorization instead of a platform-level/billing-owned authorization check.
Remediation: Remove `plan` from `UpdateOrgDto` and from `OrganizationsService.update()`'s accepted patch shape entirely. If organization-level plans are a real planned feature, expose plan changes only through a separate, platform-admin-gated or billing-webhook-driven code path (mirroring how `subscriptions`/`billing` already handle plan changes via Stripe), never through the generic self-service org-settings PATCH.
Suggested regression test: `PATCH /organizations/:id {"plan":"enterprise"}` called by that org's own `org_admin` (non-platform-admin) should be rejected (400/403), and a follow-up `GET /organizations/:id` should show the plan unchanged.
Confidence: CONFIRMED (mass-assignment vector and authorization gap); business impact is UNVERIFIED-as-currently-dormant (grep-based negative search for consumers of `organizations.plan`, not exhaustive against generated/dynamic queries).

---

### SEC-3005
Title: Messaging attachment "confirm" endpoints trust a client-supplied `storagePath` with no ownership check — cross-tenant document linking
Severity: CRITICAL
Affected component: apps/api — `modules/messaging/attachment.service.ts` (`confirmAttachment`, `confirmVoice`), reached via `modules/messaging/messaging-attachments.controller.ts`
Affected profile(s): any authenticated user with access to at least one conversation/application (users, consultants, admins)
Affected page/API: `POST /messaging/:applicationId/attachments` (confirm), `POST /messaging/:applicationId/voice` (confirm voice)
Description: The upload flow is two-step: (1) `POST /messaging/:applicationId/attachments/upload-url` generates a **server-derived** storage path scoped to the caller and application (`attachment.service.ts:107`: `` const path = `${ownerUserId}/${applicationId}/messages/${conversation.id}/${Date.now()}-${safeName(input.fileName)}` ``); (2) `POST /messaging/:applicationId/attachments` "confirms" the upload by taking a **client-supplied** `storagePath` in the request body and linking it to a new message/attachment row. The confirm step's only check, `assertObjectValid()` (`attachment.service.ts:140-181`), verifies the object **exists** in the storage bucket (`storage.from(BUCKET).list(folder, {search: name})`) and that its measured size/MIME satisfy limits — it never checks that `storagePath` starts with the calling user's own `${ownerUserId}/${applicationId}/` prefix, unlike the sibling `documents.service.ts` module which performs exactly that check for the equivalent operation: `apps/api/src/modules/documents/documents.service.ts:95-101` (`if (!params.storagePath.startsWith(\`${params.userId}/${params.applicationId}/\`)) throw new Error('Invalid storage path');`). The resulting `MessageAttachment`/`VoiceMessage` rows, including `storage_path`, are returned to clients via `.select('*')` (`attachment.repository.impl.ts:22-35`) and via the confirmed-present `storagePath`/`storage_path` fields on the shared types (`packages/types/src/index.ts:1636,1648,1684`), so any conversation participant (including consultants, who are legitimately reassigned across many different applicants over time — see `ConsultantController`/`AssignmentService`) can see the raw storage path of every attachment in any conversation they can view.
Attack scenario: A consultant (or any user) who has, at any point, legitimately viewed a conversation and its attachments (via `GET /messaging/:applicationId` or `GET /messaging/:applicationId/messages`) has the exact `storage_path` string for another applicant's private document. They call `POST /messaging/:otherApplicationId/attachments` (an application/conversation they *do* currently have legitimate access to) with `{"storagePath": "<harvested-path>", "fileName": "x", "mimeType": "...", "sizeBytes": N, "kind": "document"}`. `assertObjectValid()` confirms the object exists (it does — it's a real file, just not theirs) and the confirm succeeds, creating a **new** attachment row in the attacker's own conversation pointing at the victim's storage object. The attacker then calls `GET /messaging/attachments/:attachmentId/url` (`attachment.service.ts:302-311`, which signs and returns a download URL for `attachment.storage_path` with **no ownership check beyond "does this attachmentId resolve"**) and downloads the victim's private immigration document.
Business impact: Cross-tenant disclosure of applicants' private documents (passports, financial records, etc. — this is an immigration platform) via a confused-deputy path: the server treats a client-supplied storage identifier as proof of ownership instead of validating it was the path the server itself issued to that caller for that application. This is the same bug class explicitly named in the audit scope ("user-settable fields that should be server-controlled" — `storagePath` here is exactly such a field, and the codebase demonstrably knows the correct fix, having applied it in `documents.service.ts` but not in this sibling module.
Evidence:
```
apps/api/src/modules/messaging/messaging-attachments.controller.ts:64-98 (confirm/confirmVoice pass body.storagePath straight through with only presence/type checks, no ownership check)

apps/api/src/modules/messaging/attachment.service.ts:140-181 (assertObjectValid — existence + size/MIME only, no path-ownership check)
  private async assertObjectValid(storagePath: string, kind: AttachmentKind | 'voice'): Promise<{...}> {
    const slash = storagePath.lastIndexOf('/');
    const folder = storagePath.slice(0, slash);
    const name = storagePath.slice(slash + 1);
    const { data, error } = await this.supabase.admin.storage.from(BUCKET).list(folder, { search: name });
    ...
    const object = data?.find((o) => o.name === name);
    if (!object) { throw new BadRequestException('Uploaded object not found ...'); }
    ...

apps/api/src/modules/messaging/attachment.service.ts:183-199 (confirmAttachment — input.storagePath is the raw client value, used as-is)
  async confirmAttachment(token, caller, applicationId, input: { storagePath: string; ... }) {
    this.assertAllowed(input.kind, input.mimeType, input.sizeBytes);
    const actual = await this.assertObjectValid(input.storagePath, input.kind);
    ...
    const attachment = await this.attRepo.insertAttachment(db, { ..., storagePath: input.storagePath, ... });

apps/api/src/modules/messaging/attachment.service.ts:302-311 (download — no cross-check that the attachment's application matches anything beyond the caller being able to read the attachment row at all)
  async getDownloadUrl(token, _caller, attachmentId): Promise<{ url: string }> {
    const db = this.supabase.forUser(token);
    const attachment = await this.attRepo.getAttachment(db, attachmentId);
    if (!attachment) throw new NotFoundException('Attachment not found');
    return this.sign(attachment.storage_path);
  }

Contrast (the correct pattern, present elsewhere in the SAME codebase):
apps/api/src/modules/documents/documents.service.ts:93-101
  // Prevent registering a storage path belonging to another user/application.
  // Presigned paths are always `${userId}/${applicationId}/...`.
  if (!params.storagePath.startsWith(`${params.userId}/${params.applicationId}/`)) {
    throw new Error('Invalid storage path');
  }
```
Root cause: `attachment.service.ts`'s confirm path validates the storage object's *content* (size/MIME) but never its *provenance* (that it's the object the server itself issued a signed upload URL for, to this caller, for this application) — an input-trust-boundary omission. Overlaps with IDOR/authz scope (flagging for cross-reference with the authz audit agent) but the root cause is a missing server-side check on a client-supplied identifier that should never have been trusted as-is.
Remediation: In `confirmAttachment`/`confirmVoice`, before calling `assertObjectValid`, enforce the same prefix check `documents.service.ts` already uses: `storagePath.startsWith(\`${ownerUserId}/${applicationId}/messages/\`)` (resolve `ownerUserId` the same way `createUploadUrl` does, via `resolveTarget`). Reject with 403/400 otherwise. Consider additionally binding the signed-upload response's path server-side (store the issued path keyed by a one-time confirm token) rather than re-trusting whatever the client echoes back.
Suggested regression test: Create two applications/conversations as two different users. Upload a real attachment under application A. As the user of application B, call `POST /messaging/:applicationB/attachments` with A's real `storagePath` — expect 403/400, and expect no attachment row created in B pointing at A's storage object.
Confidence: CONFIRMED

---

### SEC-3006
Title: Admin user search builds a Supabase `.or()` PostgREST filter string from user input with incomplete sanitization
Severity: MEDIUM
Affected component: apps/api — `modules/admin/admin-users.service.ts`
Affected profile(s): admin (endpoint is admin-gated; the finding is about the query-construction pattern, not unauthenticated access)
Affected page/API: `GET /admin/users?q=...` (via `ListUsersQueryDto`/`ListUsersV2Dto`)
Description: `listUsers()` builds a raw PostgREST OR-filter string by directly interpolating user-controlled search input: `` query.or(`email.ilike.%${needle}%,full_name.ilike.%${needle}%`) `` (`admin-users.service.ts:260`). `.or()` is a known Supabase/PostgREST injection vector because it takes a raw filter-language string, not parameterized arguments (unlike `.eq()`/`.ilike()` called directly). The code does apply a partial sanitizer immediately before — `` const needle = params.q.replace(/[%,]/g, ' ') `` (line 259) — which strips the two characters most immediately useful for breaking out of the intended two-clause OR (comma, which separates PostgREST filter clauses; percent, the ILIKE wildcard). It does **not** strip parentheses (used for PostgREST logical grouping, e.g. `and(...)`/`or(...)` nesting), periods (the `column.operator.value` clause separator), asterisks, or backslashes. This query runs against `this.db`, and the surrounding class is the admin-users service reached only via the admin-gated controller — but confirm whether `this.db` here is the service-role client (bypassing RLS) — UNVERIFIED from this file alone whether RLS would provide a second layer of containment even if the filter were manipulated.
Attack scenario: An admin-role account (or a lower-privileged account if an authz bug elsewhere lets a non-admin reach this endpoint — out of this agent's scope to verify) supplies a crafted `q` value containing parentheses or additional `column.operator.value` clauses (dots are not stripped) attempting to alter the filter's logical structure — e.g. attempting to widen the match beyond `email`/`full_name` to an unintended column, or to cause a malformed filter that surfaces a PostgREST error revealing schema information. The comma/percent strip blocks the most direct exploitation (adding a new top-level OR clause or escaping the ILIKE value), but the sanitization is a blocklist, not a parser, and blocklists are inherently fragile against characters the author didn't think to test (e.g. `()`. `.`).
Business impact: Bounded by (a) admin-only access to this endpoint and (b) the comma/percent strip closing the most obvious exploit path. Residual risk is filter-logic manipulation via the un-stripped characters, which was not further exploited/proven in this read-only audit (no `(`/`.`-based bypass was constructed and tested against a live PostgREST instance) — reported as a fragile pattern that should be replaced, not a proven data-exfiltration path.
Evidence:
```
apps/api/src/modules/admin/admin-users.service.ts:255-261
    let query = this.db
      .from('users')
      .select('id,email,full_name,status,created_at', { count: 'exact' });
    if (params.q) {
      const needle = params.q.replace(/[%,]/g, ' ');
      query = query.or(`email.ilike.%${needle}%,full_name.ilike.%${needle}%`);
    }
```
This is the **only** `.or(` call found in `apps/api/src` (repo-wide grep for `.or(\`` and `.or('` across all non-spec `.ts` files returned this single match).
Root cause: Raw string interpolation into a PostgREST filter-language sink, mitigated with an incomplete blocklist instead of using the query builder's parameterized per-column methods.
Remediation: Replace the single `.or()` call with two separate `.ilike()` calls combined via Supabase's documented `or()` **with explicit column-scoped syntax** or, more robustly, issue two queries (or one query with a properly library-escaped filter — check `@supabase/postgrest-js` for an official escape helper) — or simplest: keep two `.ilike()` calls unioned in application code rather than building a raw filter string at all.
Suggested regression test: `GET /admin/users?q=%29%2Cid.neq.` (URL-decoded: `),id.neq.`) and similar parenthesis/dot payloads should either be safely treated as literal search text (matching nothing) or rejected with 400 — not alter the query's logical structure. Add this as a fixture in the admin-users test suite.
Confidence: PLAUSIBLE (sanitization gap is CONFIRMED by reading the code; exploitability of the specific un-stripped characters against PostgREST's `.or()` grammar was not proven end-to-end in this audit — would need a running instance to confirm which characters actually break clause boundaries)

---

### SEC-3007
Title: `documents.controller.ts` `registerDocument` — no type/format validation on `mimeType`/`fileName` (ownership check is present and correct)
Severity: LOW
Affected component: apps/api — `modules/documents/documents.controller.ts`, `documents.service.ts`
Affected profile(s): authenticated users
Affected page/API: `POST /documents/register/:applicationId`
Description: `registerDocument()` types its body as a bare TS interface (`{ storagePath: string; mimeType: string; fileName: string; checklistItemId?: string }`) with no validation call, then passes the fields straight to `docs.registerUploadedDocument()`. Unlike SEC-3005, this handler's `storagePath` **is** correctly ownership-checked server-side (`documents.service.ts:95-101`, `startsWith(\`${userId}/${applicationId}/\`)`), so this is not an access-control finding — it's a narrower robustness gap: `mimeType` and `fileName` are never checked to actually be strings before being stored (`file_name`, `mime_type` columns) or processed (`inferDocumentType(params.fileName)` calls `.toLowerCase()` on it, `documents.service.ts:360`, which throws a `TypeError` if `fileName` isn't a string, surfacing as a generic 500 rather than a clean 400).
Attack scenario: A client sends `fileName: {}` or `fileName: 123` — `inferDocumentType()` throws, `AllExceptionsFilter` catches it and returns a generic 500. No security impact beyond noisy errors/logs; the presign endpoint (`getPresignedUrl`, same controller) is unaffected since it separately sanitizes via `basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_')` (`documents.service.ts:53`).
Business impact: Minor — availability/UX (500 instead of 400), not a data or access-control issue.
Evidence:
```
apps/api/src/modules/documents/documents.controller.ts:41-62 (no validation call before docs.registerUploadedDocument)
apps/api/src/modules/documents/documents.service.ts:108 — let documentType = inferDocumentType(params.fileName);
apps/api/src/modules/documents/documents.service.ts:356-361 — export function inferDocumentType(fileName: string): string { ... const name = fileName.toLowerCase().replace(...); ... }
```
Root cause: Same systemic gap as SEC-3001 — no validation call on this handler.
Remediation: Add a small zod schema (`z.object({ storagePath: z.string().min(1), mimeType: z.string().min(1), fileName: z.string().min(1), checklistItemId: z.string().uuid().optional() })`) validated before the service call.
Suggested regression test: `POST /documents/register/:applicationId` with `fileName: 123` should return 400.
Confidence: CONFIRMED

---

### SEC-3008
Title: SQL injection via dynamic `EXECUTE` in migrations — checked, none found (positive control)
Severity: N/A (no finding)
Affected component: supabase/migrations
Description: Searched all `supabase/migrations/*.sql` for dynamic `EXECUTE` statements. Two files matched a naive grep for the literal string "EXECUTE" — both were false positives (the enum values `'EXECUTED'` and `'EXECUTION_READY'` in `20260606000000_verification_enums.sql` and `20260606000003_field_verifications.sql`, not SQL `EXECUTE` statements). A precise regex for actual PL/pgSQL `EXECUTE format(...)`/`EXECUTE '...'` statements found exactly one real dynamic-SQL site, and it is implemented correctly:
```
supabase/migrations/20260806100000_security_audit_db_hardening.sql:61-82
create or replace function public.ensure_month_partition(p_month date)
...
  part text := 'analytics_event_stream_' || to_char(start_ts, 'YYYYMM');
begin
  execute format(
    'create table if not exists public.%I partition of public.analytics_event_stream
       for values from (%L) to (%L)',
    part, start_ts, end_ts
  );
  execute format('alter table public.%I enable row level security', part);
end;
$$;
revoke all on function public.ensure_month_partition(date) from public, anon, authenticated;
```
Uses `format(..., %I, ...)` for the identifier (partition table name, itself derived from a `date` parameter via `to_char`, not raw user text) and `%L` for literals, `security definer` with `set search_path = public, pg_temp` pinned, and is `revoke all`'d from `public`/`anon`/`authenticated` — correct hardening. Also checked all `.rpc()` call sites in `apps/api/src` (7 found: `discounts.repository.impl.ts:71`, `subscription-credits.service.ts:46`, `partner.repository.impl.ts:682`, `provenance.repository.impl.ts:48`, `outbox.repository.impl.ts:8`, `notification-delivery.repository.impl.ts:81`, `supabase-warehouse.provider.ts:63`) — all call static, hardcoded function-name string literals with parameterized argument objects; none build the function name or a raw SQL fragment from user input.
Confidence: CONFIRMED (checked, no finding)

---

### SEC-3009
Title: Government portal / document-fetch SSRF surface — checked, structurally mitigated (architecture note, informs SEC-302x)
Severity: N/A (context/positive finding, not a vulnerability)
Affected component: apps/api — `modules/portal-fill/*`, `modules/documents/graphs/nodes/fetch-document.ts`
Description: Two areas named in the audit brief as classic SSRF candidates were checked directly:
1. **`modules/portal-fill/`** (government portal integration): contains no `fetch`/`axios`/`http.request`/`https.request` calls at all (`portal-fill.module.ts`, `write-plan.builder.ts`, `write-intent.signer.ts`, `portal-fill-orchestrator.ts`, `field-executor.port.ts` — grepped, zero matches). This matches the documented architecture in the repo's root `CLAUDE.md` ("The Electron `sidecar/` app was removed... The Chrome extension now handles the full submission flow against the user's own portal tab") — the API server itself never makes an outbound HTTP request to a government portal; that happens client-side, in the user's own browser, via the Chrome extension. There is no server-side SSRF surface here by construction.
2. **`modules/documents/graphs/nodes/fetch-document.ts`**: fetches `data.signedUrl`, a URL the server **itself generated** via `supabase.storage.from('documents').createSignedUrl(state.storagePath, 60)` — not a user-supplied URL. `state.storagePath` traces back through the same document-registration path already reviewed under SEC-3007, which is ownership-checked. Not user-URL-controlled; no SSRF here.
This is provided as supporting context for the parallel SSRF sweep (SEC-302x range) rather than a full replacement for it — OCR provider clients (`openai-ocr.provider.ts`, `azure-document-intelligence.provider.ts`) and other `fetch`/`axios` call sites outside these two areas were left to that sweep.
Confidence: CONFIRMED for the two areas checked directly.

---

### SEC-3010
Title: OAuth/auth callback open-redirect surface — checked, correctly mitigated (positive finding)
Severity: N/A (no finding)
Affected component: apps/web — `app/callback/route.ts`, `lib/auth/safe-next.ts`
Description: The one place in `apps/web` that takes a client-supplied redirect target and issues an HTTP redirect with it is the Supabase OAuth/magic-link callback, `app/callback/route.ts:13,41`: `const next = resolveSafeNext(searchParams.get('next')); ... return NextResponse.redirect(\`${redirectUrl}${next}\`)`. `resolveSafeNext()` (`lib/auth/safe-next.ts`) is a small, deliberately strict allowlist-style sanitizer:
```
apps/web/lib/auth/safe-next.ts
export function resolveSafeNext(param: string | null | undefined): string {
  if (!param) return '/'
  if (!param.startsWith('/')) return '/'
  if (
    param.startsWith('//') ||
    param.startsWith('/\\') ||
    param.startsWith('/%5C') ||
    param.startsWith('/%5c')
  ) return '/'
  return param
}
```
This correctly rejects the standard open-redirect bypasses: absolute URLs (must start with `/`), protocol-relative URLs (`//evil.com`, which browsers treat as same-scheme absolute), and backslash-based scheme smuggling (`/\evil.com`, and its raw/lowercase percent-encoded forms `/%5C`, `/%5c` — some browsers normalize a leading `\` to `/` and would otherwise treat `/\evil.com` as `//evil.com`). A repo-wide search confirmed `resolveSafeNext` is the *only* handler of a redirect-target query param in `apps/web` (grep for `next`/`redirect`/`returnTo`/`callbackUrl` reads across `app/**/*.tsx` turned up only unrelated local variables named `next`/`redirect` with no query-param or HTTP-redirect involvement). `app/api/auth/signout/route.ts:7` redirects to a hardcoded `/login` path, not a user-controlled target.

Also checked the partner-facing OAuth 2.0 `redirect_uri` handling (`apps/api/src/modules/partner/partner-oauth.service.ts`), a classic open-redirect/authorization-code-interception vector in any OAuth authorization server: `redirect_uri` must exactly match a pre-registered URI on the client application (`application.redirect_uris.includes(redirectUri)`, line 141) before an authorization code is issued, and the token-exchange step separately re-verifies the redirect_uri used matches the one recorded when the code was issued (`stored.redirect_uri !== redirectUri`, line 250) — both are standard, correct RFC 6749 §10.6 mitigations. No finding.
Confidence: CONFIRMED (checked, no finding)

### SEC-3011
Title: Several list endpoints default (but don't cap) `?limit=`; impact is low because they're self- or admin-scoped
Severity: LOW
Affected component: apps/api — `modules/iam/profile.controller.ts` (`login-history`), `modules/feedback/feedback.controller.ts` (`GET /feedback/mine`), `modules/feature-flags/feature-flags.admin.controller.ts` (`GET .../history`), `modules/notifications/ops/notification-ops.controller.ts` (`GET .../failed`)
Affected profile(s): any authenticated user (first two), platform admin (last two)
Affected page/API: `GET /me/login-history?limit=`, `GET /feedback/mine?limit=`, `GET /admin/feature-flags/history?limit=`, `GET /admin/notification-ops/failed?limit=`
Description: Each parses `?limit=` as `const n = limit ? Number(limit) : <default>` and passes `n` straight to the service/query layer with no upper bound — contrast with `notifications.controller.ts`'s own `clampLimit()` helper (`Math.max(1, Math.min(50, n))`, used correctly for `GET /notifications`) and `messaging.service.ts`'s `listOlderMessages()` (`Math.min(limit, 100)`), which show the codebase knows this pattern elsewhere. None of the four sites found here apply it.
Attack scenario: A caller sends `?limit=999999999`. For `login-history` and `feedback/mine`, the underlying query is already scoped to the caller's own `user_id`, so the realistic blast radius is "return all of my own rows in one response" — a self-inflicted large response, not a cross-tenant resource-exhaustion vector. The `feature-flags` and `notification-ops` sites are gated behind `platform.admin`/`RequireRole('admin')`, so the caller is already privileged. None of the four is a large-scale DoS vector on their own, but an uncapped admin `failed`-deliveries or flag-`history` query against a table that has grown large over time could return an unexpectedly large payload.
Business impact: Low. No unauthenticated or cross-tenant exposure; worst case is an oversized single response.
Evidence:
```
apps/api/src/modules/iam/profile.controller.ts:41-44
  loginHistory(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.security.loginHistory(user.id, Number.isFinite(n) ? n : 50);
  }

apps/api/src/modules/feedback/feedback.controller.ts:111-116
  mine(@SupabaseUserClient() db: SupabaseClient, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 50;
    return this.feedback.listMine(db, Number.isFinite(n) ? n : 50);
  }

apps/api/src/modules/feature-flags/feature-flags.admin.controller.ts:70-73
  history(@Query('key') key?: string, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : 100;
    return this.admin.history(key, Number.isFinite(n) ? n : 100);
  }

apps/api/src/modules/notifications/ops/notification-ops.controller.ts:22-25
  failed(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = limit ? Number(limit) : 25;
    return this.ops.failed(cursor ?? null, Number.isFinite(lim) ? lim : 25);
  }
```
Contrast (the correct pattern, present elsewhere in the same codebase):
```
apps/api/src/modules/notifications/notifications.controller.ts:35-39
function clampLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 20;
}
```
Root cause: `Number(limit) ?? default` pattern applied without the upper-bound clamp used elsewhere in the same codebase.
Remediation: Apply the same `Math.min(n, <sane max>)` clamp used by `clampLimit()`/`listOlderMessages()` to these four sites (e.g. cap at 100-200).
Suggested regression test: `GET /me/login-history?limit=100000` should return no more than the documented max page size.
Confidence: CONFIRMED

Also checked: no global request body-size limit is configured in `main.ts` (`NestFactory.create` is called with no `bodyParser` override), so the platform default (Express/body-parser's ~100KB JSON body limit) is the effective ceiling on any single request, including free-text fields like chat message bodies, consultant notes, and escalation reasons (`messaging.controller.ts`, `consultant-notes.controller.ts`, `document-request.controller.ts`, `escalation.controller.ts` — none of these declare an explicit `z.string().max(...)`/length cap on their text fields, unlike the `.max(...)` pattern used consistently elsewhere in the codebase, e.g. `iam.dto.ts`). This is bounded by a sane platform default rather than unbounded, so treated as informational rather than a separate finding — worth tightening for consistency, not urgency.

---

### SEC-3012
Title: Public marketplace discovery endpoints (`GET /marketplace/consultants`, `GET /marketplace/consultants/:id/reviews`) are unauthenticated and fully unbounded — no `.limit()`/`.range()` anywhere in the query
Severity: MEDIUM
Affected component: apps/api — `modules/marketplace/discovery.controller.ts`, `modules/marketplace/marketplace.repository.impl.ts`
Affected profile(s): unauthenticated (public internet — `@AllowAnonymous()`)
Affected page/API: `GET /marketplace/consultants`, `GET /marketplace/consultants/:id/reviews`
Description: `DiscoveryController.list()` and `.listReviews()` are deliberately `@AllowAnonymous()` (marketplace browse is meant to be public — legitimate product requirement, not a finding on its own). `DiscoveryQueryDto` only validates optional `visa_type`/`country`/`language` filters — there is no `limit`/`page`/`cursor` parameter at all. Traced both all the way to the repository layer (`marketplace.repository.impl.ts:297-336` for `listConsultants`, `:386-396` for `listReviews`): neither query has a `.limit(`, `.range(`, or any other row cap — `listConsultants` returns literally every row in `consultant_profiles` where `active_status = 'active'` (optionally narrowed by the filters, but with zero filters it is the entire active-consultant table in one response), and `listReviews` returns every review row for a given consultant with no cap.
Attack scenario: An unauthenticated caller (no signup, no token, no cost beyond the global 60 req/min IP throttle) repeatedly calls `GET /marketplace/consultants` to scrape the entire consultant directory (headline, specialization, years of experience, hourly rate, rating) and/or `GET /marketplace/consultants/:id/reviews` per consultant to scrape every review's `feedback` text — at 60 requests/minute this is a slow but complete and trivially automatable full-table export, with no authentication and no per-endpoint throttle override (this route is not in the `@Throttle`/`@SkipThrottle` list, so it only gets the generic global limit, which is designed for API abuse prevention in general, not table-scraping prevention specifically). As the consultant/review tables grow, each single unbounded response also grows — a table with tens of thousands of consultants would return tens of thousands of rows in one HTTP response with no pagination, a straightforward resource-consumption/availability concern independent of the scraping angle.
Business impact: Full enumeration of the consultant marketplace (pricing, specialization, experience) and all review text is available to anyone, including competitors, with no rate-limit designed for this specific endpoint. Not a data-confidentiality breach in the classic sense (this is intentionally public marketplace data), but a business-data-harvesting and resource-consumption risk, and the complete lack of a `LIMIT` clause is the underlying missing control regardless of the public/private question.
Evidence:
```
apps/api/src/modules/marketplace/discovery.controller.ts:43-56
  @Get()
  @AllowAnonymous()
  list(@Query() query: unknown, @Headers('authorization') auth?: string): Promise<ConsultantCard[]> {
    const parsed = DiscoveryQueryDto.safeParse(query);
    ...
    return this.discovery.listConsultants(bearer(auth), { visaType: ..., country: ..., language: ... });
  }

apps/api/src/modules/marketplace/marketplace.repository.impl.ts:313-336 (listConsultants — no .limit()/.range() anywhere in the built query `q`)
    let q = db.from('consultant_profiles').select(`...`).eq('active_status', 'active').order('rating_avg', { ascending: false });
    if (filters.visaType) { q = q.contains(...) }
    if (filters.country) { q = q.contains(...) }
    if (filters.language) { q = q.contains(...) }
    const res = await q;
    return rows(res, 'listConsultants').map(toDiscoveryRow);

apps/api/src/modules/marketplace/marketplace.repository.impl.ts:386-396 (listReviews — no .limit()/.range())
  async listReviews(db: SupabaseClient, consultantId: string): Promise<ConsultantReview[]> {
    const res = await db.from('consultant_reviews').select(REVIEW_COLS).eq('consultant_id', consultantId).order('created_at', { ascending: false });
    return rows(res, 'listReviews').map(toReview);
  }
```
Note: the sibling method in the same file, `getConsultantDetail` (single-record lookup), and the `toCard()` mapper in `discovery.service.ts:122-137`, both correctly whitelist output columns rather than spreading the row (the code even has a comment about this at `discovery.service.ts:61`: `// WHITELIST, never a spread of the row.`) — so this is specifically a missing-pagination finding, not a column-exposure finding; the *columns* returned are already deliberately minimal.
Root cause: No `limit`/`page` parameter was ever added to `DiscoveryQueryDto`, and the repository queries have no default cap to fall back on in its absence.
Remediation: Add `limit`/`cursor` (or `page`/`pageSize`) to `DiscoveryQueryDto` with a server-enforced max (e.g. 50), default applied when absent, and pass through to `.range()` in both repository methods. Consider a dedicated, tighter `@Throttle()` on this controller given it requires no authentication.
Suggested regression test: Seed >100 active consultant profiles; `GET /marketplace/consultants` with no query params should return a bounded page, not all rows.
Confidence: CONFIRMED

---

### SEC-3013
Title: AI/LLM-invoking endpoints share the generic global throttle (or, for the WebSocket intake chat, no throttle at all) — no cost-aware rate limiting on expensive AI calls
Severity: MEDIUM
Affected component: apps/api — `modules/narrative/narrative.controller.ts` (`POST :applicationId/generate`), `modules/messaging/messaging-ai.controller.ts` (`POST :applicationId/ai-draft`), `modules/intake/intake.gateway.ts` (WebSocket `/intake` namespace, real-time LangGraph chat)
Affected profile(s): authenticated users (narrative — plan-gated); staff (messaging-ai); authenticated users incl. anonymous/guest (intake chat, per `CLAUDE.md`'s documented flow)
Affected page/API: `POST /narrative/:applicationId/generate`, `POST /messaging/:applicationId/ai-draft`, WS `/intake` message handlers
Description: Per the audit brief's item 10 ("expensive endpoints (exports, reports, AI, OCR, search) without their own throttle"), these three AI-invoking surfaces were checked for a dedicated rate limit. Neither `narrative.controller.ts` nor `messaging-ai.controller.ts` has a `@Throttle()` decorator anywhere in the file (confirmed by grep) — both fall back to the global default of 60 requests/60s per IP (`app.module.ts`'s `ThrottlerModule.forRoot`), the same budget shared with every cheap, non-AI endpoint in the API. `narrative.controller.ts`'s `generate` endpoint is gated by `PlanGuard` (a paying plan is required), which raises the bar but does not bound request *rate* once a plan is held. More significantly: the intake chat — described in the root `CLAUDE.md` as the primary AI surface ("WebSocket chat with AI → builds application_profiles + checklist_items") — runs over Socket.IO (`@WebSocketGateway`), and NestJS's `ThrottlerGuard` (registered as `APP_GUARD` in `app.module.ts`) only intercepts HTTP request handlers, not WebSocket message handlers, so the global 60/min budget doesn't apply to it at all. Grepped `intake.gateway.ts` and `intake.service.ts` for any rate/throttle/limit logic: the only matches are handling of *upstream provider* rate-limit error strings (`intake.gateway.ts:91`, `lower.includes('rate limit')` — recognizing when the LLM provider itself pushed back), not any outbound limit the API enforces on the client.
Attack scenario: An authenticated user (or, for the intake chat, potentially an anonymous/guest session per the codebase's anonymous-identity support seen elsewhere — e.g. `MeController`'s `@AllowAnonymous()`) opens the `/intake` WebSocket connection and sends messages in a tight loop. Each message likely triggers a LangGraph step that calls out to an LLM provider (cost per call). With no message-level throttle in the gateway itself and no HTTP-layer guard covering WS traffic, the only backstop is whatever rate limiting the upstream LLM provider (e.g. OpenAI/Anthropic) enforces on the platform's own API key — i.e., cost and availability risk shifts entirely to the provider-side limit, with no application-level circuit breaker per user/connection.
Business impact: Uncontrolled LLM spend risk and potential provider-side rate-limit exhaustion (which would degrade the AI chat for all users simultaneously) from a single abusive account/connection. This is a real-money-cost class of resource abuse, distinct from ordinary request-rate DoS.
Evidence:
```
apps/api/src/modules/narrative/narrative.controller.ts:22-38 (no @Throttle anywhere in file)
@Controller('narrative')
@UseGuards(JwtGuard, PlanGuard)
export class NarrativeController {
  ...
  @Post(':applicationId/generate')

apps/api/src/modules/messaging/messaging-ai.controller.ts:21-36 (no @Throttle anywhere in file)
@Controller('messaging')
@UseGuards(JwtGuard)
export class MessagingAiController {
  ...
  @Post(':applicationId/ai-draft')

apps/api/src/modules/intake/intake.gateway.ts:91 (only match for "rate"/"limit" in the whole gateway+service — handling the PROVIDER's rate-limit error, not enforcing one of its own)
      lower.includes('rate limit') ||
```
Root cause: `@Throttle()` overrides were added to a handful of endpoints elsewhere in the codebase (`analytics.controller.ts`, `security.controller.ts`, `partner-oauth.controller.ts` — see report header) where the authors specifically reasoned about abuse potential, but the same treatment wasn't extended to the AI-generation endpoints, and NestJS's `ThrottlerGuard` architecturally does not cover WebSocket gateways at all, so the intake chat has no throttle by default rather than an intentionally-chosen one.
Remediation: Add tight `@Throttle()` overrides to `narrative.controller.ts`'s `generate` and `messaging-ai.controller.ts`'s `ai-draft` (e.g. a handful of calls per minute, not 60). For the intake WebSocket gateway, add an explicit per-connection/per-user message-rate limiter in `handleConnection`/the message handler (e.g. a token-bucket keyed by `userId`), since the framework-level guard does not apply.
Suggested regression test: Fire 60 rapid messages over one `/intake` socket connection within a minute and assert the server starts rejecting/throttling before the LLM provider does; assert `POST /narrative/:id/generate` returns 429 well before 60 calls/minute.
Confidence: CONFIRMED

---

### SEC-3014
Title: Command injection and prototype pollution — checked, none found in reachable/production code (positive control)
Severity: N/A (no finding)
Affected component: apps/api, apps/sidecar, scripts
Description:
**Command injection (item 7):** Repo-wide search across `apps/api/src`, `apps/sidecar`, and `scripts/` for `child_process`, `exec(`, `execSync(`, `spawn(`, `execFile(`, and `require('child_process')` returned **zero matches**. There is no shell-out/subprocess-execution code anywhere in the audited surface (PDF/OCR/document tooling is invoked via HTTP API clients — OpenAI, Azure Document Intelligence — not local binaries; see `modules/documents/ocr/*.provider.ts`, which use `fetch`/SDK calls, not `child_process`).
**Prototype pollution / `eval`-class code execution (item 8):** Repo-wide search for `eval(`, `new Function(`, and `vm.runIn` returned **zero matches**. A search for `Object.assign(`-based merge patterns and deep-merge helpers found six call sites, all confined to three files whose names self-declare them as test doubles: `modules/analytics-alerts/mock-analytics-alerts.repository.ts`, `modules/analytics-api/reports/mock-analytics-reports.repository.ts`, `modules/partner/in-memory-partner.repository.ts`. Each does `Object.assign(target, patch)` (or `Object.assign(r, patch, {...})`) with an untyped `patch` — which, in isolation, is a textbook prototype-pollution gadget shape (an attacker-controlled object with an own `__proto__` key merged via `Object.assign` onto a plain object can, in some engines/contexts, pollute `Object.prototype`). However, a repo-wide search of every `*.module.ts` for the concrete class names (`MockAnalyticsAlertsRepository`, `MockAnalyticsReportsRepository`, `InMemoryPartnerRepository`) found **zero DI wiring** — none of the three is registered as a NestJS provider anywhere, conditionally or otherwise. They are reachable only from `*.spec.ts` test files that instantiate them directly, not from the running application. No production request path reaches them.
Confidence: CONFIRMED (checked, no exploitable finding in reachable code; the `Object.assign` pattern in the three unreachable mock files is noted for completeness, not as an actionable finding — flagged so a future refactor that accidentally wires a mock into production DI doesn't silently inherit this shape).

---

### SEC-3015
Title: `Content-Disposition: filename=` construction — mostly catalog-derived and safe; one inconsistently-sanitized `applicationId` interpolation
Severity: LOW
Affected component: apps/api — `modules/prefill/prefill.controller.ts`
Affected profile(s): authenticated users (own application only, per `getPdf`'s `user.id` check inside the service — not re-verified in this pass, out of authz scope)
Affected page/API: `GET /prefill/:applicationId/pdf`
Description: All `Content-Disposition: attachment; filename="..."` header sites in the API were enumerated (`forms.controller.ts:81`, `doc-templates.controller.ts:66`, `prefill.controller.ts:89-92`, `prefill.controller.ts:126,129-132`). Node's `http.ServerResponse.setHeader` rejects raw CR/LF characters at the runtime level (throws `ERR_INVALID_CHAR`), so classic HTTP response-splitting/CRLF header injection is not reachable through any of these sites regardless of input. The remaining risk is `"`-based Content-Disposition *parameter* injection (breaking out of the quoted `filename="..."` value to smuggle a different apparent filename/extension — a filename-spoofing/cosmetic risk, not a header-splitting one). `forms.controller.ts` and `doc-templates.controller.ts` build `filename` from a value returned by `fileFor()`, which only returns after `formCode`/`templateCode` is matched against a pre-resolved, application-scoped delivery list (`delivered.find((f) => f.formCode === formCode)`, `forms.service.ts:222`) — i.e. bounded to the government-form catalog, not attacker-supplied text — so those two are safe. `prefill.controller.ts`'s `getOfficialPdf` correctly sanitizes its `formCode` route param before interpolating (`const safeCode = formCode.replace(/[^A-Za-z0-9._-]/g, '_')`, line 126) — but the same file's `getPdf` handler interpolates the raw `applicationId` route param directly with no equivalent sanitization and no `ParseUUIDPipe`: `` `attachment; filename="visaai-prefilled-${applicationId}.pdf"` `` (line 89-92). A request like `GET /prefill/x%22foo%22.exe%22/pdf` would decode to an `applicationId` containing literal `"` characters, breaking the quoted parameter in the response header.
Attack scenario: Low — the query using `applicationId` to fetch `this.prefill.getPdf(db, applicationId, user.id)` would very likely 404/error on a non-UUID value before the header is even built (not confirmed in this pass — would need to trace `PrefillService.getPdf`'s query). If it does reach the header-write step, the impact is a spoofed/malformed download filename in the victim's browser, not code execution or data exposure.
Business impact: Low — at most a filename-spoofing nuisance, contingent on whether the service layer's own lookup already rejects non-UUID `applicationId` values before the header is constructed (UNVERIFIED — not traced further in this pass).
Evidence:
```
apps/api/src/modules/prefill/prefill.controller.ts:80-93
  async getPdf(..., @Param('applicationId') applicationId: string, @Res() res: Response) {
    const bytes = await this.prefill.getPdf(db, applicationId, user.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="visaai-prefilled-${applicationId}.pdf"`);
    res.send(Buffer.from(bytes));
  }

apps/api/src/modules/prefill/prefill.controller.ts:110-132 (contrast — formCode IS sanitized here)
  const safeCode = formCode.replace(/[^A-Za-z0-9._-]/g, '_');
  res.setHeader('Content-Disposition', `attachment; filename="visaai-${safeCode}-${applicationId}.pdf"`);
```
Note both `getPdf` and `getOfficialPdf` interpolate `applicationId` unsanitized — the second one just happens to also sanitize the *other* interpolated value (`formCode`), leaving `applicationId` as the one inconsistently-handled input in both handlers.

Also checked email header injection (item 9, email sub-case): `modules/shared/email/email.service.ts`'s `EmailService.send(to, subject, htmlBody, attachments)` passes `to`/`subject` straight to `nodemailer`'s `transport.sendMail({ from: this.from, to, subject, html: htmlBody, ... })` (`email.service.ts:49-55`). `from` is server-controlled (`SMTP_FROM` env var, never request-derived — safe). `to`/`subject` are caller-supplied and not independently sanitized in this file; the primary control here is nodemailer's own well-established header-folding/sanitization of the fields it places into RFC 5322 headers, which is outside this codebase's control surface and was not independently re-verified against a live SMTP transcript in this pass (UNVERIFIED at that depth — no evidence found of a bypass, and no in-house sanitization was found to be relied upon either).
Root cause: Inconsistent application of the same sanitization pattern already used one line away for a sibling parameter.
Remediation: Add `new ParseUUIDPipe()` to the `applicationId` param on both handlers (matching the pattern already used in `forms.controller.ts`/`doc-templates.controller.ts`), or apply the same `.replace(/[^A-Za-z0-9._-]/g, '_')` sanitization used for `formCode`.
Suggested regression test: `GET /prefill/%22malicious%22/pdf` should 400 (invalid UUID) rather than reach the header-construction code.
Confidence: CONFIRMED (the unsanitized interpolation is confirmed by reading the code); end-to-end exploitability depends on whether `PrefillService.getPdf` rejects the malformed ID first — UNVERIFIED, not traced in this pass.

---

### SEC-3016
Title: Partner webhook delivery — SSRF defense-in-depth, checked in full (positive finding, notable engineering)
Severity: N/A (no finding — documented as a strong positive control, since the audit brief specifically asks whether SSRF guards exist and whether redirects are followed)
Affected component: apps/api — `modules/partner/partner-webhook-url.ts`, `modules/partner/pinned-lookup.ts`, `modules/partner/http-webhook.sender.ts`
Description: Partner-registered webhook URLs are the one clear SSRF vector in this codebase (a third party supplies a URL; the server later makes an outbound request to it — see `modules/partner/partner-webhook.service.ts` importing `validateWebhookUrl`). This was checked in full and the implementation is layered correctly:
1. **Registration-time validation** (`partner-webhook-url.ts`): rejects non-`https` schemes (except `http://localhost` in sandbox), credentials embedded in the URL, non-standard ports (allowlist: 80/443/8443), literal IPs in private/loopback/link-local/CGNAT/multicast/reserved ranges (both IPv4 and IPv6, including the IPv4-mapped-IPv6 bypass `::ffff:10.0.0.1`, explicitly called out and handled: `partner-webhook-url.ts` comment — "any textual rule for the IPv4-mapped form is trivially bypassed by handing us the dotted notation and letting the URL parser normalise it"), and known cloud-metadata hostnames (`metadata.google.internal`, `metadata.goog`, etc.).
2. **The code itself documents the residual gap** in a hostname that resolves to a private address only *after* registration (DNS rebinding) — filed as tracked debt "PD-4" in the same file's comment — and then closes it:
3. **Delivery-time pinned DNS resolution** (`pinned-lookup.ts`, wired into `http-webhook.sender.ts` via the Node `http(s).request({ lookup: ... })` option): the `lookup` function used to open the actual socket is the same one that validates the resolved address, eliminating the resolve-then-reconnect race a naive "resolve, check, then request" implementation would have. If a hostname resolves to multiple A/AAAA records and *any* is private, the whole resolution is refused (explicitly reasoned about in the code comment — rejecting only-if-all-private would let an attacker force the public answer to fail and fall back to the private one).
4. **No redirect-following**: `node:http`/`node:https` don't follow redirects by default, and this code does nothing to add that behavior, so a webhook target that 302s to an internal address is simply reported as a non-2xx response, not followed.
5. **Literal-IP-host edge case handled**: `http-webhook.sender.ts` notes that `net.connect` skips the `lookup` hook entirely when the hostname is already a literal IP address, and adds an explicit `isPrivateAddress()` check for that case before opening the socket.
6. **Response-handling hardening**: capped response body read (`MAX_RESPONSE_BYTES = 2048`, memory-exhaustion defense against a malicious partner endpoint streaming an unbounded response) and PII redaction before the response snippet is persisted to the delivery log.
Loopback is deliberately tolerated only when `NODE_ENV !== 'production'`, for local sandbox development — correctly scoped.
Confidence: CONFIRMED (checked, no finding — documented as a model implementation of the exact control the audit brief asked about).

---

### SEC-3017
Title: Government-form cache storage-key construction and XXE surface — checked, none found
Severity: N/A (no finding)
Affected component: apps/api — `modules/forms/form-template.store.ts`, `modules/forms/discovery/*`, repo-wide XML parsing
Description:
**Path traversal in the government-form cache (item 5):** `modules/forms/form-template.store.ts`'s `storagePathFor()` builds storage keys as `<country>/<program>/<form-slug>/<version>.pdf`, where every dynamic segment (including the version label, which the code's own comment identifies as "attacker-adjacent input" since "it comes from a remote page" — i.e. scraped government-portal metadata, not fully trusted) is passed through a `slug()` function that strips everything except `[a-z0-9]` (replacing runs with `-`, trimming leading/trailing separators): `s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')`. This fully neutralizes `../` traversal sequences regardless of source, and the code comments show the authors deliberately reasoned about this input's trust level. `modules/doc-templates` and `modules/prefill` were also checked for user-input-driven storage-key/filesystem-path construction — no `path.join()`/raw-concatenation-from-request-body pattern was found in either (their file-serving paths were already covered under SEC-3015, and their write paths are driven by the same catalog/`fileFor()`-style lookups reviewed there, not raw client-supplied paths).
**XXE (item 8, XML sub-case):** Repo-wide search for `xml2js`, `fast-xml-parser`, `libxmljs`, `xmldom`, and `DOMParser` across all `.ts` files and both `package.json` manifests returned zero matches. The codebase does not parse XML anywhere; there is no XXE attack surface to mitigate.
Also noted for completeness: `modules/forms/discovery/{au-home-affairs,eu-home-affairs,canada-ircc}.discovery.ts` make outbound HTTP fetches (via `defaultHttp`/`FetchLike` in `modules/forms/http.ts`) to scrape official government immigration-portal pages for the form-catalog-freshness feature — these targets are hardcoded, developer-configured government URLs, not derived from any request input, so they were not treated as an SSRF vector (no user ever supplies the destination).
Confidence: CONFIRMED (checked, no finding)

---
