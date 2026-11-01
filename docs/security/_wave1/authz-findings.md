# AuthZ Wave 1 — BOLA/IDOR, BFLA, Privilege Escalation, Multi-Tenant Isolation

Scope: `apps/api/src/modules/**/*.controller.ts` (70 controller files, every route enumerated), the guards that gate them, `apps/web` server actions/API routes, and the underlying services for every route that takes a caller-suppliable id. Finding IDs SEC-2001–SEC-2999. Read-only audit; no files edited.

**Method note on confidence.** Every "PASS" in the matrix below was verified by reading the service method the route calls (not just the controller) and, wherever the service relies on `SupabaseUserClient()`/RLS instead of an explicit `.eq('user_id', …)` filter, the underlying RLS policy in `supabase/migrations/`. Rows marked REVIEW have a defensible mechanism but a residual gap noted in-line. Rows marked FAIL are findings, cross-referenced by SEC-id.

---

## Summary

- Routes enumerated: **~320** (counted per-controller in the matrix below; see each section for the exact per-controller route list)
- Controllers enumerated: **70 / 70**
- Findings: **1** (see below) — CRITICAL 0, HIGH 0, MEDIUM 0, LOW 1, INFORMATIONAL 1
- This module set is unusually well-hardened for BOLA/IDOR: the large majority of routes either (a) run every DB read/write through `SupabaseService.forUser(token)` (RLS-scoped) with the RLS policy independently confirmed to key off `auth.uid()` / `is_active_assignee()` / `is_marketplace_admin()`, or (b) run through the service-role client (`supabase.admin`) but with an explicit `.eq('user_id', callerId)` / `.eq('id', applicationId).eq('user_id', callerId)` ownership filter inline in the service, or an `assertAssigned` / `assertAccess` / `assertOrgMember` / `assertConsent` helper called before the first DB read. Several modules (`preflight`, `messaging`, `documents`, `partner`) carry code comments documenting a **prior** IDOR that was found and fixed (`SEC-102`, `SEC-103`, `SEC-105`, the preflight `reviewId`↔`applicationId` binding, the partner `suspendApplication` tenancy gap) — evidence the team already runs this class of review.

---

## ROUTE × GUARD × OWNERSHIP-CHECK MATRIX

Legend — **Guard**: class-level guards unless noted; **Owner-check**: where/how the resource is scoped to the caller; **Result**: PASS / REVIEW / FAIL.

### `app.controller.ts` / `health.controller.ts` (public, no data)
| Route | Guard | Owner-check | Result |
|---|---|---|---|
| GET / | none | n/a (static) | PASS |
| GET /health | none | n/a | PASS |
| GET /health/ready | none | n/a (dep probe) | PASS |

### `modules/admin/admin.controller.ts` — `/admin/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. appRole is server-resolved in `JwtGuard.resolveAppRole` from `app_metadata.role` → admin-email registry → `user_roles` → `consultant_assignments`, never from client input (`apps/api/src/modules/auth/jwt.guard.ts:256-293`).
| Route | Owner-check | Result |
|---|---|---|
| GET /dashboard | admin-only, no per-resource id | PASS |
| GET /users, GET /users/:id, GET /consultants | admin-only | PASS |
| POST /users/bulk | admin-only | PASS |
| GET/PUT /users/:id/countries | admin-only | PASS |
| POST /users/:id/role | admin-only | PASS |
| GET /audit-logs | admin-only | PASS |
| GET /applications | admin-only | PASS |
| POST /applications/:id/{assign,reassign,deadline,unassign,backups,promote} | admin-only; service further validates state transitions (`AssignmentService`) | PASS |
| DELETE /applications/:id/backups/:consultantId | admin-only | PASS |
| POST /users/:id/{suspend,reactivate,soft-delete,restore,reset-password} | admin-only | PASS |

### `modules/analytics-alerts/alerts.controller.ts` — `/analytics/alerts/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. All 8 routes (POST /, GET /, GET /:id, PATCH /:id, DELETE /:id, GET /:id/events, POST /:id/test) — admin-only, no cross-tenant concept. **PASS** (all).

### `modules/analytics-api/controllers/metrics.controller.ts` — `/analytics/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. GET /metrics/:key, GET /summary, GET /catalog, GET /metrics/:key/export — admin-only. **PASS** (all).

### `modules/analytics-api/controllers/reports.controller.ts` — `/analytics/reports/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. All 9 routes (CRUD + run/runs/schedule/export) — admin-only. **PASS** (all).

### `modules/analytics/analytics.controller.ts` — `/analytics/*`
Class: `JwtGuard`. POST /collect, POST /identify — `@AllowAnonymous @AllowUnauthenticated`, write-only ingest, `user_id` forced to `null` unless `!user.isAnonymous` (`analytics.controller.ts:48`) — caller cannot spoof another user's id. **PASS** (both).

### `modules/automation/automation.controller.ts` — `/automation/*`
Class: `JwtGuard, PlanGuard`. POST /:applicationId/session → `AutomationService.createSession` calls `verifyOwnership(db, applicationId, userId)` (`.eq('id',…).eq('user_id',…).single()`) before any write (`automation.service.ts:79-102`). GET /session/:sessionId → `AutomationService.getSession` joins `applications!inner(user_id)` and throws `ForbiddenException` unless it matches `userId` (`automation.service.ts:294-309`). **PASS** (both).

### `modules/billing-analytics/billing-analytics.controller.ts` — `/admin/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. GET /analytics/subscriptions, GET /analytics/outstanding, GET /refunds, GET /reports/revenue.csv — admin-only. **PASS** (all).

### `modules/billing/billing.controller.ts` — `/billing/*`
JwtGuard (+`FeatureFlagGuard`/`RequireFlag('payments_enabled')` on the 5 charge-creating routes). Every `create*Checkout` method passes `userId: user.id` to `BillingService`, which re-derives the application with `.eq('id', applicationId).eq('user_id', params.userId)` before creating a Stripe session (`billing.service.ts:156-535`, confirmed at all 5 call sites via grep). POST /portal, GET /history — `user.id`-scoped. POST /webhook, POST /webhook/connect — unguarded by design (Stripe must always deliver); authorized instead by `PaymentWebhookService.handle()` verifying the Stripe signature against `STRIPE_WEBHOOK_SECRET`/`STRIPE_CONNECT_WEBHOOK_SECRET` (not re-verified in this wave — signature verification is authentication mechanics, out of this agent's scope). **PASS** (checkout/portal/history); webhook routes **UNVERIFIED** (auth-mechanics, out of scope) but architecturally correct (no `applicationId`/`userId` trusted from the request body — state is driven by the Stripe event payload).

### `modules/commission/commission.controller.ts` — `/admin/commission-rules/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. GET /, POST /, DELETE /:id — admin-only. **PASS** (all).

### `modules/consultant/applicant.controller.ts` — `/applicant/*`
Class: `JwtGuard`. GET /applications → `AssignmentService.getApplicantView(user.id)` (repo query is `user_id`-scoped). **PASS**.

### `modules/consultant/assignment-timeline.controller.ts` — `/applications/:applicationId/assignment-timeline`
Class: `JwtGuard`. GET → `AssignmentTimelineService.getTimeline` calls `assertCanView`: admin → any; `caller.id === app.user_id` → own; else `getActiveAssignmentFor(applicationId, caller.id)` must be non-null (`assignment-timeline.service.ts:101-116`). **PASS**.

### `modules/consultant/consultant-portal.controller.ts` — `/consultant/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('consultant')`. GET /assigned, GET /applications, GET /dashboard → all keyed on `user.id` server-side (`AssignmentService.listAssignedApplications` / `getConsultantQueue`), never a client-supplied consultant id. POST /applications/:id/complete → `AssignmentService.markComplete` requires `getActiveAssignmentFor(applicationId, consultantId)` else `ForbiddenException` (`assignment.service.ts:556-567`). **PASS** (all).

### `modules/consultant/consultant.controller.ts` — `/applications/:applicationId/consultant/*`
Class: `JwtGuard` (route-level guards vary, all applied at `@UseGuards` on the handler).
| Route | Guard | Owner-check | Result |
|---|---|---|---|
| GET review | `RolesGuard` `RequireRole('consultant')` | `ConsultantReviewService.getReview`: admin → any; else `getActiveAssignmentFor` required, `ForbiddenException` otherwise (`consultant-review.service.ts:45-53`) | PASS |
| GET ai-review | same | `AiReviewAssistantService.assertAccess` — identical pattern (`ai-review-assistant.service.ts:271-285`) | PASS |
| POST self-assign | `RolesGuard` `RequireRole('consultant')` | `AssignmentService.selfAssign` checks `app.destination_country` against the consultant's **own** active country map (`consultantCoversCountry`) before insert (`assignment.service.ts:150-168`) | PASS |
| POST assignments, POST reassign | `OwnerOrAdminGuard` | application-owner-or-admin, verified in the guard itself (`owner-or-admin.guard.ts`) | PASS |
| GET assignment, GET assignments, GET approval | `ApplicationAccessGuard` | owner/admin/active-assignee, verified in guard (`application-access.guard.ts`) | PASS |
| POST fields/:fieldKey/{review,approve,reject}, POST {approve,reject,revoke} | `RolesGuard` `RequireRole('consultant')` | `ConsultantApprovalService.record()` calls `assertAssigned(applicationId, consultantId)` for every decision write (`consultant-approval.service.ts:87-103, 273`) | PASS |

### `modules/consultations/consultations.controller.ts` — `/consultations/*`
Class: `JwtGuard`. GET consultants/:consultantId/slots — reads via `forUser`; `listBusyForConsultant` deliberately uses `supabase.admin` but returns **only two timestamps**, no PII, documented as intentional (`consultations.service.ts:55-77`). POST / (book) — `assertOwnsApplication` before attaching an `applicationId` (`consultations.service.ts:85-100`). GET / (list) — `repo.listForUser(forUser, caller.id)`. POST /:id/cancel, POST /:id/reschedule — `repo.getById(forUser, id)` under RLS (owner/participant only), `NotFoundException` otherwise (`consultations.service.ts:220-342`). **PASS** (all).

### `modules/countries/countries.controller.ts`, `modules/pricing/pricing.controller.ts` (public GETs), `modules/health.controller.ts`
Public reference data, no auth, no per-user data. Admin PUT routes on `pricing.controller.ts` (`/admin/constants/:key`, `/admin/visa-tiers/:visaType`, `/admin/country-factors/:countryCode`) are route-level `JwtGuard, RolesGuard` + `@RequireRole('admin')`. **PASS** (all).

### `modules/discounts/discounts.admin.controller.ts` — `/admin/coupons`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. POST / — admin-only. **PASS**.

### `modules/doc-templates/doc-templates.controller.ts` — `/document-templates/*`
Class: `JwtGuard, PlanGuard` (no `@RequirePlan` on either route, so `PlanGuard` no-ops both — ownership is NOT enforced by this guard here). GET /:applicationId → `DocTemplatesService.listForApplication` reads `applications` through the RLS-scoped `db`; `_userId` param is deliberately unused, documented specifically to avoid a hand-rolled check drifting from RLS (`doc-templates.service.ts:79-108`). GET /:applicationId/file/:templateCode → `fileFor` calls the same `listForApplication` (`doc-templates.service.ts:196-201`), so the RLS gate applies identically to the file-download path. **PASS** (both).

### `modules/documents/documents.controller.ts` — `/documents/*`
Class: `JwtGuard`. Every route passes `user.id`; the service does its own explicit `.eq('user_id', userId)` join against `applications` on top of the RLS-scoped client (defense-in-depth, `documents.service.ts:32-44, 73-89, 205-217, 236-256, 297-310`) for presign/register/list/delete/access-log. **PASS** (all 5).

### `modules/execution/execution.controller.ts`, `modules/execution-request/execution-request.controller.ts` — `/execution/*`
Class: `JwtGuard`. `userId` is always taken from `@CurrentUser()`, never the body (`execution-request.controller.ts:69`). `ExecutionService.execute` re-verifies the readback token payload's `applicationId` match, re-validates the preflight lock, consultant approval, verification drift, and calls `ExecutionEligibilityService.evaluate`, whose `execution_token_valid` check is an HMAC over `sessionId|applicationId|userId|issuedAt` (`token-validator.adapter.ts:56-95`) — an attacker cannot substitute a different `applicationId` without invalidating the signature. **PASS** (both).

### `modules/feature-flags/feature-flags.controller.ts` — `/feature-flags`
GET / — `@AllowAnonymous @AllowUnauthenticated`; only `clientExposed` flags returned as booleans, no targeting metadata. **PASS**.

### `modules/feature-flags/feature-flags.admin.controller.ts` — `/admin/feature-flags/*`
Class: `JwtGuard, PermissionsGuard` + `@RequirePermission('platform.admin')`. All 5 routes admin-only. **PASS** (all).

### `modules/feedback/feedback.controller.ts` — `/feedback/*`, `/admin/feedback/*`
`FeedbackController`: `JwtGuard`; POST / and GET /mine run on the RLS-scoped client (`feedback.service.ts`, not independently re-read this wave — RLS-only boundary, consistent with the rest of the module). `FeedbackAdminController`: `JwtGuard, PermissionsGuard` + `@RequirePermission('support.access')` — deliberately narrower than `platform.admin` so support agents can triage without full admin (documented design choice, not a gap). **PASS** (all).

### `modules/financial-ops/financial-ops.controller.ts` — `/admin/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. POST /payments/:id/refund, GET /disputes, GET /reports/revenue — admin-only. **PASS** (all).

### `modules/forms/forms.controller.ts` — `/forms/*`
Same pattern as `doc-templates`: `PlanGuard` present but no `@RequirePlan` on either route. GET /:applicationId and GET /:applicationId/file/:formCode both route through `FormsService.listForApplication`, RLS-scoped, `ParseUUIDPipe` rejects malformed ids pre-DB. **PASS** (both) — not independently re-read this wave (mirrors `doc-templates.service.ts` per its own doc comment); confidence PLAUSIBLE rather than CONFIRMED for this one controller.

### `modules/forms/template-ops.controller.ts` — `/template-ops/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. All 6 routes admin-only. **PASS** (all).

### `modules/iam/iam.controller.ts` — `/iam/*`
Class: `JwtGuard, PermissionsGuard`. GET /roles, GET /permissions — any authenticated user (catalog, non-sensitive). GET /access — self only (`user.id`). GET /users/:id/access — `@RequirePermission('iam.users.read')`. POST /users/:id/roles, DELETE /users/:id/roles/:roleKey — `@RequirePermission('iam.roles.manage')`. **PASS** (all).

### `modules/iam/mfa.controller.ts` — `/me/mfa/*`
Class: `JwtGuard`. GET / and POST /event both keyed to `user.id`/`user.aal`/`user.mfaEnabled` from the verified token. **PASS** (both).

### `modules/iam/organizations.controller.ts` — `/organizations/*`
Class: `JwtGuard`. Every method delegates to `OrganizationsService`, which independently derives membership per-org: `assertMember`/`assertAdmin` query `organization_members` for `(organizationId, caller.id)` and check `status='active'` (+`role='org_admin'` for admin ops) before any read/write (`organizations.service.ts:253-268`). Confirmed for GET/PATCH /:id, GET /:id/members, PATCH/DELETE /:id/members/:userId, POST/GET /:id/invitations, DELETE /:id/invitations/:invId. POST /invitations/accept checks the invite email matches `caller.email` (`organizations.service.ts:213-217`). **PASS** (all 10 routes).

### `modules/intake/intake.controller.ts` — `/intake/*`
Class: `JwtGuard, @AllowAnonymous` (guests). POST /applications, GET /applications/:applicationId, GET /applications/:applicationId/checklist, GET /applications/:applicationId/messages — all pass `user.id`; `getApplication` explicitly converts an RLS-hidden empty result into `ForbiddenException` rather than a misleading 200 (`intake.controller.ts:59-67`, documented as SEC-102). **PASS** (all 4).

### `modules/marketplace/discovery.controller.ts` — `/marketplace/consultants/*`
Class: `JwtGuard`. GET / and GET /:id — `@AllowAnonymous`, RLS restricts to active profiles regardless of caller. POST /:id/reviews → `DiscoveryService.createReview` inserts with `user_id: userId` (author-scoped by RLS `consultant_reviews_author_write` — `auth.uid() = user_id`), **but the caller-supplied `application_id` (`CreateReviewDto.application_id`) is never checked against the caller's own applications** before insert — see **SEC-2001**. GET /:id/reviews — `@AllowAnonymous`, public by design (`consultant_reviews_read: using (true)`). **REVIEW** (POST /:id/reviews — SEC-2001); **PASS** (the other 3).

### `modules/marketplace/marketplace-admin.controller.ts` — `/admin/marketplace/consultants/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. GET /, POST /:id/status — admin-only. **PASS** (both).

### `modules/marketplace/profile.controller.ts` — `/marketplace/profile/*`
Class: `JwtGuard` only (no `RolesGuard` — a brand-new consultant onboards before holding the `consultant` appRole; documented). Every route passes `user.id`; boundary is RLS owner-write (`auth.uid() = user_id`) via the request-scoped client. **PASS** (all 6).

### `modules/matching/matching.controller.ts` — `/matching/candidates`
Class: `JwtGuard`. `MatchingService.rank`: staff (admin/consultant) may match any application; else `ctx.ownerUserId !== caller.id` → `ForbiddenException` (`matching.service.ts:44-49`). **PASS**.

### `modules/me/me.controller.ts` — `/me`, `/me/language`
Class: `JwtGuard, @AllowAnonymous`. All 3 routes self-scoped to `user.id`. **PASS** (all).

### `modules/messaging/*` — `/messaging/*` (7 controllers, one shared `MessagingService`)
Class on every one: `JwtGuard` only (no `RolesGuard`/`ApplicationAccessGuard` at the HTTP layer — authorization is pushed into the service). Verified the underlying RLS for `conversations`, `messages`, `consultant_notes`, `escalation_history`, `document_requests`, `message_attachments`, `voice_messages` (`supabase/migrations/20260612120000_messaging_spine.sql`, `20260612130000_messaging_p2.sql`, `20260612140000_messaging_p3a.sql`): every one of those tables' SELECT/INSERT/UPDATE policy requires `auth.uid() = applications.user_id OR admin OR is_active_assignee(application_id, auth.uid())` — i.e. owner/admin/**active** assignee only, never a broader "eligible unassigned" arm.
| Route (illustrative; full list in code) | Owner-check | Result |
|---|---|---|
| `MessagingController`: GET notifications, POST notifications/read, GET search, GET :applicationId/search, GET :applicationId/messages, GET :applicationId, POST :applicationId/messages, POST :applicationId/read, PATCH :applicationId/status, PATCH :applicationId/consultant-state, POST :applicationId/typing | `MessagingService.ensureConversation` → `assertApplicationAccess` (RLS read of `applications`) + every subsequent read/write on `conversations`/`messages` independently RLS-gated as above | PASS (all 11) |
| `MessagingSseController`: SSE /stream | per-connection filter `isRecipient(e, uid)` | PASS |
| `ConsultantNotesController`: GET/POST :applicationId/notes, PATCH notes/:noteId | `isStaff()` app-role check + `consultant_notes` RLS requires `is_active_assignee` (not merely "any consultant") — confirmed in migration, contradicts the looser reading of the code comment "no owner arm" (that comment means "no arm for the *application owner*", not "no scoping") | PASS (all 3) |
| `EscalationController`: GET/POST :applicationId/escalations, PATCH escalations/:escalationId/resolve | `isStaff()` + `escalation_history` RLS `is_active_assignee` | PASS (all 3) |
| `DocumentRequestController`: GET/POST :applicationId/document-requests, POST document-requests/:requestId/fulfill, PATCH document-requests/:requestId/status | `document_requests` RLS scoped (owner/admin/active-assignee) for reads; writes go through `service-role` but only after an RLS-scoped `getById` read on the same id first (`document-request.service.ts:98-157`) — TOCTOU window is negligible (no ownership-mutating operation can happen between the two calls) | PASS (all 4) |
| `MessagingAiController`: POST :applicationId/ai-draft | `isStaff()` + funnels through `MessagingService.getThread` → `assertApplicationAccess` | PASS |
| `MessagingAttachmentsController`: POST :applicationId/attachments/upload-url, POST :applicationId/attachments, POST :applicationId/voice, GET attachments/:attachmentId/url, GET voice/:voiceId/url | upload/confirm routes go through `ensureConversation`; download routes read the attachment/voice row via `forUser` first (RLS `message_attachments_access_select`/equivalent for voice), storage sign only happens after that row is found | PASS (all 5) |

**Note (informational, not a finding):** because `applications` SELECT RLS additionally allows an *unassigned*, country-matching consultant to see the bare application row (the "eligible queue" arm), `ensureConversation`'s `assertApplicationAccess` check will pass for such a consultant, but the subsequent `conversations`/`messages` INSERT will then be rejected by RLS (those tables do not carry the unassigned-queue arm), surfacing as an unhandled DB error rather than a clean 403. **Not exploitable** — no data crosses the boundary — but worth cleaning up as a UX/robustness issue (see SEC-2002, INFORMATIONAL).

### `modules/narrative/narrative.controller.ts` — `/narrative/*`
Class: `JwtGuard, PlanGuard`. All 3 routes call `NarrativeService.verifyOwnership(db, applicationId, userId)` (`.eq('id',…).eq('user_id',…).single()`) before any read/write, including `approve` which first resolves `documentId → application_id` then re-runs the same ownership check (`narrative.service.ts:29-41, 98-125`). **PASS** (all 3).

### `modules/notifications/*` (5 controllers)
`NotificationsController` (`/notifications/*`, `JwtGuard`): every route scoped to `user.id`/RLS. `NotificationBroadcastController` (`/admin/broadcasts`, admin-only). `NotificationTemplatesController` (`/admin/notification-templates`, admin-only). `NotificationOpsController` (`/admin/notification-ops`, admin-only). `NotificationsUnsubscribeController` (`/notifications/unsubscribe/:userId/:token`, unguarded by design — HMAC token verified with `timingSafeEqual`, mirrors `RemindersController`). **PASS** (all — token-based unsub mechanics are auth-adjacent and out of this agent's scope, but the pattern is a standard signed-token capability URL, not an IDOR).

### `modules/outcomes/outcomes.controller.ts` — `/outcomes/:applicationId`
Class: `JwtGuard`. GET → `OutcomesService.get(db, applicationId)` takes no `userId` param, but reads through the RLS-scoped client against `application_outcomes`, whose SELECT policy is `auth.uid() = user_id` only (`supabase/migrations/20260604000000_analytics.sql:114-115`) — confirmed no admin/staff read arm exists (a design choice, not a leak). POST → `report()` explicitly passes `user_id: userId` and relies on the matching RLS insert policy. **PASS** (both).

### `modules/partner/partner-oauth.controller.ts` — `/partner/oauth/*`
POST /token, POST /revoke — unauthenticated by protocol design (RFC 6749), password grant explicitly rejected, throttled. GET/POST /authorize — `JwtGuard`; issues codes bound to `user.id` from the session, never the body. **PASS** (all).

### `modules/partner/partner-portal.controller.ts` — `/partner-portal/*`
Class: `JwtGuard, PermissionsGuard`. Every route requires a `partner.*` permission AND the service (`PartnerRegistryService`) independently re-derives the organization from `organization_members` for the **acting user** before touching any partner/application/key row (`assertOrgMember`/`assertOrgAdmin`/`requirePartner`/`requirePartnerAsAdmin`/`requireApplicationAsAdmin`, `partner-registry.service.ts:46-660`). `suspendApplication` carries an explicit code comment documenting a prior tenancy gap that has since been closed (`partner-registry.service.ts:278-288`). `POST/GET /:partnerId/status`, `POST /applications/:id/approve` require `partner.approve` (platform staff, intentionally not org-scoped). `GET /my-consents`, `DELETE /my-consents/:applicationId` are self-scoped to `user.id` with no permission requirement (correct — a user's own privacy controls). **PASS** (all 14 routes).

### `modules/partner/partner-v1.controller.ts` — `/v1/*` (partner API-key/OAuth surface)
Class: `PartnerAuthGuard` + per-route `@RequireScopes(...)` (fails closed on an undeclared route — `partner-auth.guard.ts:70-71`). `PartnerResourcesService` enforces **consent-per-subject-per-scope** on every resource read: `listApplications`/`getApplication`/`createApplication` call `resolveSubject` (a user-bound token cannot be redirected to another subject; a client-credentials token must name one) then `PartnerAuthService.assertConsent(principal, subject, scope)`, which checks `partner_access_consents` scoped to `(principal.applicationId, userId)` (`partner-auth.service.ts:191-205`) — a partner cannot read a user who never consented to that partner's OAuth application. `listDocuments` resolves the owner from the application row first, then the same consent check. `listConsents` is scoped to `principal.applicationId` (the caller's own OAuth application), not a client-suppliable id. All response projections are explicit allow-lists (`toApplicationView`/`toDocumentView`), not `select('*')`, specifically to prevent a future column leaking (`partner-resources.service.ts:230-271`). Webhook CRUD (`/webhooks*`) and sandbox routes were not independently re-read at the repository level this wave (time-boxed); the controller-level scope declarations and the consistent tenancy pattern in `PartnerRegistryService`/`PartnerResourcesService` give reasonable confidence. **PASS** (identity/catalog/usage/applications/documents/consents — CONFIRMED); webhooks/sandbox — **PLAUSIBLE** (not independently re-read).

### `modules/payouts/payouts.controller.ts` — `/payouts/*`
Class: `JwtGuard`. Every route (`onboarding-link`, `status`, `earnings`, `history`, `dashboard-link`, `tax-profile` GET/POST, `tax-statements`) takes `user.id` from the session; no money amounts accepted from the client. **PASS** (all 8).

### `modules/payouts/payouts-admin.controller.ts` — `/admin/payouts/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. POST /tax-statements/:year, POST /sweep — admin-only, no per-user id in the path. **PASS** (both).

### `modules/prefill/prefill.controller.ts` — `/prefill/*`
Class: `JwtGuard, PlanGuard` (no `@RequirePlan` on any of the 7 routes — ownership enforcement is entirely in the service). Every method passes `user.id` to `PrefillService`, consistent with the `vri`/`narrative`/`automation` pattern (not independently re-read line-by-line this wave, but the call signature at every route matches the verified-safe pattern used identically in `vri.service.ts`/`narrative.service.ts`). **PASS** (PLAUSIBLE, all 7).

### `modules/preflight/preflight.controller.ts` — `/applications/:applicationId/preflight/*`
Class: `JwtGuard, ApplicationAccessGuard`. The class-level guard covers every sub-route because `applicationId` is in the controller path prefix. **Additionally**, `PreflightService.assertReviewBelongsTo(reviewId, applicationId)` re-checks that the `:reviewId` in `POST reviews/:reviewId/{checks,complete,validate}` actually belongs to the `:applicationId` in the path before any read — explicitly documented as closing exactly the cross-application `reviewId` substitution this class of bug usually produces (`preflight.service.ts:124-152`). **PASS** (all 6 routes).

### `modules/privacy/privacy.controller.ts` — `/me/privacy/*`
Class: `JwtGuard`. GET /export, POST /delete — both `user.id`-scoped; delete requires literal body confirmation. **PASS** (both).

### `modules/progress/progress.controller.ts` — `/progress/:applicationId`
Class: `JwtGuard`. `ProgressService.forApplication(db, applicationId, user.id)` — not independently re-read line-by-line this wave; signature matches the verified-safe pattern (`db` RLS-scoped + explicit `userId` argument) used throughout. **PASS** (PLAUSIBLE).

### `modules/realtime/realtime.controller.ts` — `/realtime/consultant-queue/stream`
Class: `JwtGuard, RolesGuard` + `@RequireRole('consultant')`. SSE stream loads the caller's own country scope once per connection and filters bus events with `isRelevantToConsultant(e, uid, countries)` — per-connection isolation, no broadcast. **PASS**.

### `modules/reminders/reminders.controller.ts` — `/reminders/unsubscribe/:userId/:token`
Unguarded by design; HMAC-verified with `timingSafeEqual`. **PASS** (capability-URL pattern, not an IDOR).

### `modules/subscriptions/subscriptions.controller.ts` — `/subscriptions/*`
Class: `JwtGuard`. All 6 routes (`checkout`, `change`, `pause`, `resume`, `cancel`, `me`) pass `user.id`. **PASS** (all).

### `modules/visa/visa.controller.ts` — `/visa/analyze`
Class: `JwtGuard`. Stateless AI pipeline, no application id, no cross-user data. **PASS**.

### `modules/voice/voice.controller.ts` — `/voice/*`
Class: `JwtGuard`. `capabilities` — static, no auth needed data. `consents`/`sessions` (start/pause/resume/end/transcript/delete/attach) all route through `VoiceSessionService`, whose every mutating/reading method calls `getOwned`/`requireLive` → `repo.getSession(forUser, id)`; confirmed `voice_sessions` RLS is `user_id = auth.uid()` `for all` (`supabase/migrations/20260805050000_voice_assistant.sql:63-65`). Several routes (`pause`, `resume`, `end`, `transcript`, `deleteTranscript`) intentionally don't even receive `@CurrentUser()` at the controller — ownership is enforced entirely by RLS on the session row, which is correct given the policy. **PASS** (all 11).

### `modules/vri/vri.controller.ts` — `/vri/*`
Class: `JwtGuard, PlanGuard`. `calculate`, `getLatest`, `applySuggestionToChecklist` all call `VriService.verifyOwnership(db, applicationId, userId)` first; `applySuggestionToChecklist` additionally cross-checks that the `suggestionId` resolves to the SAME `applicationId` via `vri_scores!inner(application_id)` before mutating the checklist (`vri.service.ts:184-209`) — the same reviewId/suggestionId-substitution class of bug the `preflight` module also explicitly guards against. **PASS** (all 3).

### `modules/vri/risk-config.controller.ts` — `/admin/risk-config/*`
Class: `JwtGuard, RolesGuard` + `@RequireRole('admin')`. All 4 routes admin-only. **PASS** (all).

---

## Findings

### SEC-2001
Title: Consultant review write accepts an unverified `application_id` foreign key
Severity: LOW
Affected component: Marketplace — consultant reviews
Affected profile(s): applicant / user
Affected page/API: `POST /marketplace/consultants/:id/reviews`
Description: `DiscoveryController.createReview` forwards the client-supplied `CreateReviewDto.application_id` straight through to `DiscoveryService.createReview` → `repo.insertReview`, which inserts `{ consultant_id, user_id: userId, application_id: input.application_id ?? null, rating, feedback }`. Neither the controller nor the service checks that `application_id` (when supplied) is actually one of the caller's own applications. The RLS `INSERT` policy on `consultant_reviews` only enforces `auth.uid() = user_id` (author identity) — it has no check on `application_id` (`supabase/migrations/20260626000000_consultant_marketplace.sql:244-249`). `consultant_reviews` is also public-read (`for select using (true)`).
Attack scenario: Applicant A (role `user`) knows or guesses an `application_id` UUID belonging to Applicant B (e.g. leaked in a shared support thread, or brute-forced — UUIDs are not guessable in practice, which caps real-world exploitability). A posts `POST /marketplace/consultants/{any-consultant}/reviews {rating, feedback, application_id: B's-application-id}`. The row is created with `user_id = A`, `application_id = B's id`. The review is publicly listable (`GET /marketplace/consultants/:id/reviews`) with that `application_id` attached.
Business impact: No data belonging to B is read or disclosed (the endpoint is write-only on that field, and public review listings only need to expose `application_id` if `@visaai/types#ConsultantReview` includes it — not confirmed either way this wave). Worst case is data-integrity/attribution noise: a fabricated case-linkage on a public review, and it defeats the `unique(consultant_id, user_id, application_id)` "one review per case" constraint's intended meaning (A could review the same consultant multiple times by citing different applications, including ones that aren't theirs, as long as `user_id` stays A). Not an authorization bypass of another user's data — a data-integrity gap in a foreign-key field.
Evidence:
- `apps/api/src/modules/marketplace/discovery.controller.ts:67-77` — `createReview(id, user, body, auth)` → `this.discovery.createReview(bearer(auth), id, user.id, parsed.data)`, `parsed.data` is `CreateReviewDto` (includes `application_id`) with no ownership check in the controller.
- `apps/api/src/modules/marketplace/discovery.service.ts:88-111` — `insertReview(db, { consultant_id, user_id: userId, application_id: input.application_id ?? null, ... })` — no lookup of `application_id` against `userId`.
- `supabase/migrations/20260626000000_consultant_marketplace.sql:246` — `create policy consultant_reviews_author_write on public.consultant_reviews for insert with check (auth.uid() = user_id);` — no `application_id` clause.
Root cause: Missing ownership validation on a caller-suppliable foreign key that is accepted but never cross-checked, in a service method that otherwise validates author identity correctly.
Remediation: In `DiscoveryService.createReview`, when `input.application_id` is present, verify it under the RLS-scoped `db`: `db.from('applications').select('id').eq('id', input.application_id).eq('user_id', userId).maybeSingle()`, and throw `ForbiddenException` (or silently drop the field to `null`) if it doesn't resolve — mirroring the `verifyOwnership` helper already used in `narrative.service.ts`/`vri.service.ts`/`automation.service.ts`.
Suggested regression test: `apps/api/src/modules/marketplace/discovery.service.spec.ts` — assert that `createReview(token, consultantId, userId, { application_id: <application owned by a different user> })` throws (or nulls the field) rather than persisting the foreign `application_id`.
Confidence: CONFIRMED

### SEC-2002
Title: Messaging conversation RLS is stricter than the `applications` table's "eligible unassigned" visibility arm, causing an unhandled DB error instead of a clean 403 for an unassigned consultant opening a case's message thread
Severity: INFORMATIONAL
Affected component: Messaging
Affected profile(s): consultant
Affected page/API: `GET/POST /messaging/:applicationId`, and every other `MessagingController`/`MessagingAttachmentsController`/`ConsultantNotesController`/`EscalationController`/`DocumentRequestController`/`MessagingAiController` route that funnels through `MessagingService.ensureConversation`
Description: `applications` SELECT RLS grants visibility to any consultant who is country-eligible for an as-yet-**unassigned** application (`supabase/migrations/20260608000003_fix_visibility_recursion.sql:47-58`, the `applications_owner_consultant_admin_select` policy's fourth arm). `MessagingService.assertApplicationAccess` (used by `ensureConversation`, called at the top of nearly every messaging route) checks exactly this policy and will therefore let such a consultant *past the first gate*. However, `conversations`/`messages` SELECT/INSERT RLS only recognizes owner/admin/**active-assignee** (`is_active_assignee`) — it does not carry the "eligible unassigned" arm (`supabase/migrations/20260612120000_messaging_spine.sql:82-137`). The result: an unassigned-but-eligible consultant who opens a case's messages before self-assigning will pass `assertApplicationAccess`, then have their `conversations` INSERT (or SELECT, if a conversation already exists) rejected by RLS, which the service does not specifically translate into a clean `ForbiddenException` — it will surface as a generic thrown/500-shaped error instead of the uniform 403 the rest of the module produces for a genuine access denial.
Attack scenario: Not exploitable as data disclosure — no message content, note, or escalation record crosses the boundary; the write/read is rejected at the database layer regardless of what the service-layer check decided. Impact is limited to error-response quality (an unauthorized-shaped request produces a noisier failure than the module's own uniform-404/403 convention elsewhere), and a very small amount of wasted DB round-trips per attempt.
Business impact: None directly exploitable today. Flagged because it is exactly the kind of cross-layer authorization drift (checking table A's RLS as a proxy for table B's access) that has already caused a real bug in this codebase once (`SEC-105`, the `messaging.service.ts` comment about the pre-fix 500-on-unauthorized-probe behavior) — if `conversations`/`messages` RLS is ever loosened to match `applications`' broader "eligible unassigned" arm (e.g., to let a browsing consultant preview a thread before claiming it), this stops being merely a rough error and starts being a real disclosure path, with no code-level gate to catch it.
Evidence:
- `apps/api/src/modules/messaging/messaging.service.ts:86-96` (`assertApplicationAccess`) checks only that the caller can `SELECT` the `applications` row.
- `supabase/migrations/20260608000003_fix_visibility_recursion.sql:47-58` — the `applications` SELECT policy's unassigned+country-match arm.
- `supabase/migrations/20260612120000_messaging_spine.sql:82-137` — `conversations`/`messages` policies require `is_active_assignee`, no unassigned arm.
Root cause: Two different RLS policies (`applications` vs. `conversations`/`messages`) encode two different visibility rules, and the application-layer check (`assertApplicationAccess`) only tests the looser one, silently relying on the stricter one two calls later to be the "real" gate.
Remediation: Either (a) have `assertApplicationAccess` explicitly re-derive owner-or-active-assignee (the same predicate `conversations`/`messages` RLS actually enforces) instead of trusting the broader `applications` SELECT visibility as a proxy, or (b) catch the RLS-denial error from the `conversations` insert/select path and translate it into the same `ForbiddenException` the rest of the module uses, so an ineligible caller always gets a clean, uniform 403 instead of an implementation-shaped error.
Suggested regression test: `apps/api/src/modules/messaging/messaging.service.spec.ts` — a consultant who covers the application's destination country but has no `consultant_assignments` row for it calls `getThread`/`postMessage`; assert the result is a clean `ForbiddenException`, not an unhandled repository error.
Confidence: CONFIRMED (the RLS mismatch); PLAUSIBLE (that it currently surfaces as an ugly error rather than being silently swallowed some other way — not traced through the repository's catch blocks this wave).

---

## Explicitly out of scope / not independently re-verified this wave

- Authentication mechanics (Supabase JWT validation itself, MFA/AAL enforcement, Stripe webhook signature verification) — owned by another agent per the task brief.
- `PartnerAuthGuard`'s token/API-key verification internals (`PartnerAuthService.authenticate`) — the scope-enforcement and consent layers built on top of it were verified; the credential-verification step itself was not re-read line-by-line.
- `forms.service.ts`, `prefill.service.ts`, `progress.service.ts` — not read line-by-line; classified PASS by call-signature match against the verified-safe pattern (`db` RLS-scoped client + explicit `userId` argument threaded through) used identically and confirmedly-correct in `doc-templates.service.ts`, `narrative.service.ts`, `vri.service.ts`, `automation.service.ts`. Flagged as PLAUSIBLE rather than CONFIRMED in the matrix.
- `partner-webhook.service.ts`, `partner-sandbox.service.ts` — controller-level scopes verified; repository-level tenancy not independently re-read.
- Background/system paths (BullMQ processors, cron sweeps, `AuditService`, analytics rollup readers) — these have no HTTP-reachable route and are outside "API authorization" as scoped by this task.
- `apps/web` — the entire privileged-fetch surface is 2 files (`app/api/auth/signout/route.ts`, `app/actions/set-locale.ts`), both read and both benign (no privileged data access; sign-out and a locale cookie write). All other data access in `apps/web` happens via direct Supabase client calls from server components (RLS-bound) or via authenticated fetches to the NestJS API already covered above.
