# i18n Translation Review Package

_Generated 2026-08-06 by `pnpm i18n:review`. Do not hand-edit the CSVs or
the manifest's `en`/`status` source fields — regenerate. Reviewers DO edit the
`status` column / per-locale state (see Workflow)._

**732 keys × 14 locales** exported from
`apps/web/messages/*.json` (en is the master).

## What's here
- `<locale>.csv` (14 files): `namespace, key, en, <locale>, status`.
  Open in Sheets; a native reviewer reads `en` + the translation and sets
  `status` to `approved` or `needs-fix` (default `pending`).
- `status-manifest.json`: tracking source of truth — per-key `status`
  (`mt` | `english_held_candidate`) and per-locale review state, plus rollup
  counts. Update as review proceeds.

## Workflow
1. Send each `<locale>.csv` to a native speaker of that locale.
2. They flip `status` per row: `approved` (good) or `needs-fix` (+ a corrected
   value in the translation column).
3. Apply `needs-fix` corrections back into `apps/web/messages/<locale>.json`,
   then re-run `pnpm i18n:review` and reconcile the manifest counts.
4. **GA gate:** every locale's `pending` + `needs-fix` count is 0 in the manifest.

## English-held copy — needs professional LEGAL localization (NOT in the CSVs)
These are deliberately hardcoded English in components (HARD CONSTRAINT §4.1), so
they are NOT in `messages/*.json` and not auto-exported. Localize via a
professional legal translator, not MT:
- All pricing strings (e.g. `$29`).
- The prefill auto-fill fee explainer.
- The official-forms "verify every value before submitting" caveat.
- The 503 official-template fallback message.
(Identify exact occurrences by grepping the components; they were intentionally
left English pending legal review.)

## Additional MT surface — api email catalog (review alongside)
`apps/api/src/i18n/email/messages.ts` (the reminder email, 15 locales) is MT and
also needs native review. Keys: `reminder.{subject, body, bodyWithCountry,
nextStepPrefix, resume, unsubscribe}` and `nextStep.{intake, documents, narrative,
readiness, prefill, submission}`. Not in this CSV export (different source file).

## Flagged: identical across all locales (verify intentional)
- `nav.consultantDashboard` = "Dashboard"
- `nav.adminDashboard` = "Admin Dashboard"
- `nav.adminBilling` = "Billing"
- `nav.adminCoupons` = "Coupons"
- `dashboard.vriScore` = "VRI {score}/100"
- `pricing.eyebrow` = "Pricing"
- `pricing.heroTitle` = "Find out which visa you qualify for"
- `pricing.heroLede` = "Take a free 3-minute eligibility assessment. No account or card required — see your options before you pay for anything."
- `pricing.assessCta` = "Start free assessment"
- `pricing.noCard` = "Free · no credit card required"
- `pricing.anchor` = "Traditional immigration consultants charge $500–$5,000 per application. VisaAI prepares yours and has a licensed consultant review it for a fraction of that."
- `pricing.selectCountry` = "Choose your destination"
- `pricing.perApplication` = "per application · consultant-reviewed"
- `pricing.recommended` = "Most popular"
- `pricing.cta` = "Start this application"
- `pricing.govFeeNote` = "Government processing fees are separate and paid directly to the issuing authority."
- `pricing.unavailable` = "Live pricing is briefly unavailable. Start your free assessment and we will show your price."
- `pricing.trust1Title` = "Reviewed by a licensed consultant"
- `pricing.trust1Body` = "Every application is checked and approved by a licensed immigration consultant before you submit."
- `pricing.trust2Title` = "No surprises"
- `pricing.trust2Body` = "One clear price per application. Government fees are shown separately, always at cost."
- `pricing.trust3Title` = "Free to start"
- `pricing.trust3Body` = "Get your eligibility result and a personalized plan before paying anything."
- `adminDashboard.title` = "Executive Dashboard"
- `adminDashboard.users` = "Users"
- `adminDashboard.consultants` = "Consultants"
- `adminDashboard.inProgress` = "Applications in progress"
- `adminDashboard.aiTokens` = "AI tokens"
- `adminDashboard.revenue` = "Completed orders"
- `adminDashboard.logins` = "Logins"
- `adminDashboard.lockouts` = "Lockouts"
- `adminDashboard.notAvailable` = "Not yet available"
- `adminDashboard.range7d` = "7 days"
- `adminDashboard.range30d` = "30 days"
- `adminDashboard.range90d` = "90 days"
- `adminDashboard.widgets` = "Widgets"
- `adminDashboard.rangeLabel` = "Date range"
- `adminUsers.heading` = "Users & roles"
- `adminUsers.searchPlaceholder` = "Search by email…"
- `adminUsers.colEmail` = "Email"
- `adminUsers.colName` = "Name"
- `adminUsers.colStatus` = "Status"
- `adminUsers.colRole` = "Role"
- `adminUsers.colCountries` = "Countries"
- `adminUsers.colActions` = "Actions"
- `adminUsers.statusActive` = "Active"
- `adminUsers.statusSuspended` = "Suspended"
- `adminUsers.statusDeleted` = "Deleted"
- `adminUsers.filterAllStatuses` = "All statuses"
- `adminUsers.manage` = "Manage"
- `adminUsers.bulkSelected` = "{count} selected"
- `adminUsers.bulkSuspend` = "Suspend"
- `adminUsers.bulkReactivate` = "Reactivate"
- `adminUsers.bulkSoftDelete` = "Soft delete"
- `adminUsers.bulkRestore` = "Restore"
- `adminUsers.confirmTitle` = "Confirm action"
- `adminUsers.reasonLabel` = "Reason (optional)"
- `adminUsers.reasonPlaceholder` = "Enter a reason…"
- `adminUsers.confirmCancel` = "Cancel"
- `adminUsers.confirmProceed` = "Proceed"
- `adminUsers.prev` = "Previous"
- `adminUsers.next` = "Next"
- `adminUsers.pageInfo` = "Page {page} of {total}"
- `adminUsers.actionSuspend` = "Suspend"
- `adminUsers.actionReactivate` = "Reactivate"
- `adminUsers.actionSoftDelete` = "Soft delete"
- `adminUsers.actionRestore` = "Restore"
- `adminUsers.actionResetPassword` = "Reset password"
- `adminUsers.rolesHeading` = "Roles"
- `adminUsers.addRole` = "Add role"
- `adminUsers.noRoles` = "No roles assigned"
- `adminUsers.lastSignIn` = "Last sign-in"
- `adminUsers.createdAt` = "Created"
- `adminUsers.emailConfirmed` = "Email confirmed"
- `adminUsers.applicationsCount` = "Applications"
- `adminUsers.recentActivity` = "Recent activity"
- `adminUsers.identity` = "Identity"
- `adminUsers.resetSent` = "Password reset link sent"
- `adminUsers.saved` = "saved"
- `adminUsers.failed` = "failed"
- `adminUsers.selfActionDisabled` = "You cannot perform this action on your own account"
- `adminUsers.noUsers` = "No users found"
- `adminTemplates.title` = "Notification Templates"
- `adminTemplates.event` = "Event type"
- `adminTemplates.locale` = "Locale"
- `adminTemplates.subject` = "Subject (email)"
- `adminTemplates.subjectPlaceholder` = "Optional email subject…"
- `adminTemplates.titleLabel` = "Title"
- `adminTemplates.titlePlaceholder` = "Notification title with {{variables}}…"
- `adminTemplates.body` = "Body"
- `adminTemplates.bodyPlaceholder` = "Notification body with {{variables}}…"
- `adminTemplates.variables` = "Available variables"
- `adminTemplates.preview` = "Preview"
- `adminTemplates.save` = "Save"
- `adminTemplates.history` = "Version history"
- `adminTemplates.active` = "active"
- `adminTemplates.inactive` = "inactive"
- `adminTemplates.new` = "New template"
- `adminTemplates.editing` = "Edit template"
- `adminTemplates.noTemplates` = "No templates yet"
- `adminTemplates.deactivate` = "Deactivate"
- `adminTemplates.loading` = "Loading…"
- `adminBroadcasts.title` = "Broadcast Announcements"
- `adminBroadcasts.compose` = "Compose announcement"
- `adminBroadcasts.titleLabel` = "Title"
- `adminBroadcasts.body` = "Body"
- `adminBroadcasts.category` = "Category"
- `adminBroadcasts.link` = "Link (optional)"
- `adminBroadcasts.audience` = "Audience"
- `adminBroadcasts.all` = "All users"
- `adminBroadcasts.role` = "Role"
- `adminBroadcasts.users` = "Specific users"
- `adminBroadcasts.roleLabel` = "Role"
- `adminBroadcasts.userIds` = "User IDs"
- `adminBroadcasts.userIdsPlaceholder` = "Comma or newline separated user IDs…"
- `adminBroadcasts.preview` = "Preview"
- `adminBroadcasts.send` = "Send"
- `adminBroadcasts.confirmSend` = "Confirm broadcast"
- `adminBroadcasts.cancel` = "Cancel"
- `adminBroadcasts.sending` = "Sending…"
- `adminBroadcasts.required` = "Title and body are required"
- `adminBroadcasts.sent` = "Broadcast queued"
- `adminBroadcasts.sendFailed` = "Failed to send broadcast"
- `adminBroadcasts.history` = "History"
- `adminBroadcasts.empty` = "No broadcasts yet"
- `adminBroadcasts.status` = "Status"
- `adminBroadcasts.recipients` = "Recipients"
- `adminBilling.title` = "Billing & Revenue"
- `adminBilling.mrr` = "MRR"
- `adminBilling.arr` = "ARR"
- `adminBilling.activeSubs` = "Active subscriptions"
- `adminBilling.outstanding` = "Outstanding"
- `adminBilling.collected` = "Collected"
- `adminBilling.refunded` = "Refunded"
- `adminBilling.net` = "Net revenue"
- `adminBilling.byPlan` = "base {base} · pro {pro} · premium {premium}"
- `adminBilling.revenueBy` = "Revenue by {dim}"
- `adminBilling.exportCsv` = "Export CSV"
- `adminBilling.from` = "From"
- `adminBilling.to` = "To"
- `adminBilling.dimension` = "Group by"
- `adminBilling.country` = "Country"
- `adminBilling.visa` = "Visa type"
- `adminBilling.plan` = "Plan"
- `adminBilling.feature` = "Feature"
- `adminBilling.key` = "Key"
- `adminBilling.refunds` = "Refunds"
- `adminBilling.disputes` = "Disputes"
- `adminBilling.amount` = "Amount"
- `adminBilling.status` = "Status"
- `adminBilling.reason` = "Reason"
- `adminBilling.date` = "Date"
- `adminBilling.none` = "None yet"
- `adminBilling.refundTitle` = "Issue a refund"
- `adminBilling.paymentId` = "Payment ID"
- `adminBilling.amountOptional` = "Amount (USD, blank = full)"
- `adminBilling.issueRefund` = "Issue refund"
- `adminBilling.refundOk` = "Refund initiated"
- `adminBilling.couponsTitle` = "Create coupon"
- `adminBilling.code` = "Code"
- `adminBilling.kind` = "Type"
- `adminBilling.percent` = "Percent off"
- `adminBilling.amountKind` = "Amount off"
- `adminBilling.percentOff` = "Percent off (1-100)"
- `adminBilling.amountOff` = "Amount off (USD)"
- `adminBilling.appliesTo` = "Applies to"
- `adminBilling.maxRedemptions` = "Max redemptions (optional)"
- `adminBilling.validUntil` = "Valid until (optional)"
- `adminBilling.createCoupon` = "Create coupon"
- `adminBilling.couponOk` = "Coupon created"
- `adminBilling.error` = "Something went wrong"
- `adminBilling.loadError` = "Failed to load"

These render the same in every locale — usually an intentional brand/placeholder
string (e.g. an acronym + `{placeholder}`), but confirm none are accidental
untranslated drift.
