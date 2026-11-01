# VisaAI — Legal Review Required

**Deliverable required by:** Master Execution Spec §29 (Legal objective) and §30 (Legal review deliverable).
**Prepared by:** engineering audit, 2026-08-21.
**Product under review:** VisaAI, https://visaai.co — AI-assisted visa-application preparation. Handles passport, financial, employment, education and family data. Ships a consultant marketplace, Stripe subscriptions and one-time payments, 15 locales, and a Chrome extension that fills government portal forms on the user's own machine.

---

## What this document is, and is not

This is an **engineering-side issue register for qualified counsel**. Every item below is grounded in the code as built, with `file:line` citations, and every legal conclusion is stated as a **question for counsel**, never as an answer.

**This document does not, and cannot, establish that VisaAI is compliant with any law.** Engineering can reduce exposure and build defensible controls; it cannot determine compliance. No statement here should be read as legal advice. Nowhere does this document assert that the product is compliant, or fully so, with any regime — no qualified counsel has established that, and only counsel can.

Per spec §29: *"Do not claim that engineering can prevent all legal action or guarantee legal compliance. Qualified counsel must review legal conclusions and launch-critical policy language."*

**Method.** Every claim was verified against the repository at `/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI` and, where the claim concerns live behaviour, against production `https://visaai.co` on 2026-08-21. Controls are credited **only** where the implementing code was located. Where a control was expected and not found, the entry says so explicitly.

**Severity definitions used here**

| Severity | Meaning |
|---|---|
| **Critical before launch** | Counsel decision and/or code change should precede public launch in the affected market. |
| **High** | Should be resolved on a short, dated timeline; may be launch-blocking for a specific jurisdiction at counsel's direction. |
| **Medium** | Real exposure; schedule against the post-launch roadmap with an owner. |
| **Informational** | Recorded so counsel has the full picture; no action proposed by engineering. |

---

## Issue index

| ID | Severity | Issue |
|---|---|---|
| L-01 | Critical before launch | Public Terms and Privacy Policy are self-declared unreviewed templates, live and indexable in 15 locales |
| L-02 | Critical before launch | "Every application is checked and approved by a licensed immigration consultant" — licensure is never verified by any code path |
| L-03 | Critical before launch | Paid eligibility assessment and application preparation in jurisdictions where immigration advice is a licensed activity |
| L-04 | Critical before launch | Approval-likelihood and outcome claims rendered without any disclaimer on the surface that shows them |
| L-05 | Critical before launch | "Auto-submit" copy asserts a capability the code does not have and contradicts the non-representation position |
| L-06 | Critical before launch | Persistent client identifier and `dataLayer` telemetry written on first paint with no consent mechanism anywhere |
| L-07 | Critical before launch | No controller identity, no reachable privacy contact, no EU/UK Article 27 representative |
| L-08 | Critical before launch | Personal data collected from anonymous guests before any notice, terms, or rights channel |
| L-09 | Critical before launch | Cached official government forms redistributed from visaai.co and paywalled, with no licence or attribution handling |
| L-10 | Critical before launch | Distance selling: no pre-contract information, no withdrawal right or waiver, no consumer refund route |
| L-11 | Critical before launch | Article 9 / Article 10 data processed at scale with no DPIA, ROPA, DPA, sub-processor list or breach procedure |
| L-12 | Critical before launch | Identity and criminality data transferred to OpenAI in the US on paths the residency guard does not cover |
| L-13 | High | `documents.encrypted = true` is asserted to data subjects while nothing encrypts documents; passport numbers stored in plaintext |
| L-14 | High | DSAR export omits the intake profile and all document contents; erasure leaves Stripe, analytics, login IPs and backups |
| L-15 | High | No retention schedule for case data; the guest-cleanup job is unscheduled; messages retained indefinitely |
| L-16 | High | AI transparency: no provenance in the data model, disclaimers English-only, none on the VRI surface, `needsHumanReview` discarded |
| L-17 | High | Marketplace has no consultant agreement, no indemnity/E&O/contractor terms, no clawback basis, unreachable tax-form collection |
| L-18 | High | Terms omit governing law, jurisdiction, dispute resolution, auto-renewal, price change, and trading identity |
| L-19 | High | Lifecycle email on implied consent by database default; no `List-Unsubscribe` headers; all-users broadcast with no consent segmentation |
| L-20 | Medium | No non-affiliation statement anywhere; extension injects into Government of Canada domains; EU flag used for "Schengen"; UN emblem served |
| L-21 | Medium | Extension scope is two Canadian domains while copy promises to fill "your government portal"; no in-extension consent; sideload install path |
| L-22 | Medium | Legal, safety and disclaimer copy is English-only across 15 locales; email translations are unreviewed machine translation |
| L-23 | Medium | The only "do not rely on this for a real filing" banner is feature-flagged off and does not render in production |
| L-24 | Medium | Accessibility: strong automated gate, but English public routes only; no accessibility statement; RTL and authenticated surfaces untested |
| L-25 | Informational | Government-source ingestion conduct: robots.txt honoured and UA identified, but a host-specific UA override and a measured EC 429 incident |
| L-26 | Informational | Payments: no sanctions screening, no billing-country capture on the highest-volume checkouts, Stripe Tax off by default |
| L-27 | Informational | Third-party asset licensing: the vendored `flag-icons` MIT notice is not shipped |

---

## L-01 — Public Terms and Privacy Policy are self-declared unreviewed templates

- **Severity**: Critical before launch

- **Issue**: The two documents that constitute the contract with the user and the statutory privacy notice both tell the reader, in production, that they have not been reviewed by counsel. They are simultaneously the legal basis being relied on and a published admission that no such basis has been settled.

- **Current behavior**:
  - `apps/web/app/[locale]/terms/page.tsx:26` renders `"Template pending legal review. Last updated: 2026-06-04."`, with the source comment at `apps/web/app/[locale]/terms/page.tsx:18-19`: `// TEMPLATE. Strategy Action 10. Must be reviewed and finalized by counsel (Action 9) before launch.`
  - `apps/web/app/[locale]/privacy/page.tsx:29` renders the identical string; source comment at `apps/web/app/[locale]/privacy/page.tsx:20-22`.
  - Both are in the sitemap and therefore indexable: `apps/web/app/sitemap.ts:5` lists `['', '/pricing', '/privacy', '/terms', '/login', '/signup']`, emitted once per locale at `apps/web/app/sitemap.ts:31-37` (15 locales → 90 URLs). `apps/web/app/robots.ts:26` allows `/`; neither page carries `noindex`.
  - Verified live on 2026-08-21: `https://visaai.co/privacy`, `https://visaai.co/terms` and `https://visaai.co/es/privacy` all return the "Template pending legal review" string; `https://visaai.co/sitemap.xml` returns 90 `<loc>` entries including `/privacy` in every locale.
  - The privacy notice is four short sections (`apps/web/app/[locale]/privacy/page.tsx:33-79`) for a product that processes passport scans, bank statements, criminal-record answers and voice transcripts.

- **Jurisdiction / context**: GDPR Articles 12–14 (transparency, and the specific content a notice must carry); UK GDPR; PIPEDA Principle 8 (Openness) and the Canadian openness/accountability requirements; CCPA/CPRA notice-at-collection; EU Unfair Commercial Practices Directive and national consumer codes on unfair or unclear contract terms. Publishing a document that announces its own provisional status is also relevant to whether the terms were validly incorporated.

- **Engineering controls already implemented**:
  - Both pages exist, are routed, and are linked from signup: `apps/web/app/[locale]/(auth)/signup/page.tsx:166-167`.
  - The privacy page has already been corrected once to remove a factually false statement rather than reword it — see the in-code note at `apps/web/app/[locale]/privacy/page.tsx:59-66`, which records that a claim about backup purging was removed because production had `pitr_enabled=false` and no backups to purge. This is the correct instinct and should be preserved.
  - Both pages are covered by the automated accessibility gate: `apps/web/e2e/design-system.spec.ts:18-24` (route list) and `:135-160` (axe WCAG 2.0/2.1/2.2 A+AA, light and dark, `expect(results.violations).toEqual([])`).

- **Remaining legal question**: Are these documents enforceable as terms and adequate as an Article 13/14 notice in their current state, and does the published "pending legal review" caveat itself create exposure (misrepresentation, failure of incorporation, or an admission adverse to the platform)? What is the minimum content set counsel requires before the pages may be indexed in each target market?

- **Counsel decision required**: Approve final Terms of Service and Privacy Policy text, or direct that both pages be de-indexed and gated until approved. Specify whether the "Template pending legal review" line must be removed before or at launch, and confirm the effective date and version-history mechanism counsel wants.

---

## L-02 — "Every application is checked and approved by a licensed immigration consultant" while licensure is never verified in code

> **STATUS 2026-08-21: the copy defect is FIXED; the licensure question is not.**
>
> The reviewed text was captured before commit `2d0b766`. The string no longer
> exists in any of the 15 locale files, and `apps/web/messages/claims.test.ts`
> fails the build if it returns. "Licensed Consultant Review" and "Licensed
> immigration consultants who can review your application" were removed for the
> same reason.
>
> What is NOT resolved and remains for counsel: whether the marketplace may
> describe consultants as licensed at all given that `license_verified` is still
> never written `true` by any code path, and what verification the product must
> perform before it does. The finding below is retained in full because that
> question stands.

- **Severity**: Critical before launch

- **Issue**: The public pricing page makes an unqualified, absolute representation that a *licensed* immigration consultant reviews and **approves** every application. The database column that would record licence verification is never written to `true` by any code path in the repository, licence details are unvalidated free text, and admin approval writes only a listing-visibility flag.

- **Current behavior**:
  - `apps/web/messages/en.json:622` — `pricing.trust1Body`: `"Every application is checked and approved by a licensed immigration consultant before you submit."` Rendered on the public pricing page at `apps/web/app/[locale]/pricing/page.tsx:85-86`. Verified live on `https://visaai.co/pricing` 2026-08-21.
  - Reinforced at `apps/web/messages/en.json:621` (`"Reviewed by a licensed consultant"`), `:614` (`"…has a licensed consultant review it for a fraction of that."`), `:616` (`"per application · consultant-reviewed"`), `:342` (`"Licensed Consultant Review"`), and `:924` (`"Licensed immigration consultants who can review your application."`).
  - The verification column exists — `supabase/migrations/20260626000000_consultant_marketplace.sql:40-43`: `license_number text, license_authority text, license_country text, license_verified boolean not null default false`.
  - **`license_verified` is read but never written.** Read sites: `apps/api/src/modules/marketplace/marketplace.repository.impl.ts:87`, `apps/api/src/modules/marketplace/discovery.service.ts:77`, `apps/api/src/modules/marketplace/marketplace.dto.ts:122`, `apps/api/src/modules/matching/matching.repository.impl.ts:104`. No write site exists — no admin endpoint, no UI control, no registry lookup.
  - Admin approval sets only listing status: `apps/api/src/modules/marketplace/marketplace-admin.service.ts:58-73` and `apps/api/src/modules/marketplace/marketplace.repository.impl.ts:426` (`.update({ active_status: status, updated_at: … })`).
  - Licence fields are length-validated only: `apps/api/src/modules/marketplace/marketplace.dto.ts:23-25` — `license_number: z.string().max(120)`, `license_authority: z.string().max(120)`, `license_country: z.string().length(2)`. No format check and no CICC/IAA/MARA/bar-registry lookup exists anywhere in the repository.
  - Admin review renders the raw free text and offers Approve / Send back / Suspend: `apps/web/app/[locale]/(admin)/consultant-review/review-queue.tsx:126-165`.
  - The user is nonetheless told verification happens: `apps/web/messages/en.json:979` — `"Submitted. An admin reviews your license before you appear in search."`
  - The one code path that enforces the flag is therefore inert in a way that fails open: `apps/api/src/modules/matching/matching.engine.ts:70-74` zeroes one weighted score component for lawyer-flagged visas when the licence is unverified, but the hard filter at `apps/api/src/modules/matching/matching.engine.ts:90-104` does not check licensure at all, so an unverified consultant can still be ranked and returned.
  - The claim also outruns the enforcement that does exist: the consultant-approval gate at `apps/api/src/modules/eligibility/execution-eligibility.service.ts:40-101` governs only automated portal execution and requires a paid prefill (`:30-33`). Nothing requires consultant review before a user downloads an AI-generated letter, reads a VRI score, or files manually.
  - This sits directly against the Terms: `apps/web/app/[locale]/terms/page.tsx:33-34` states VisaAI *"is not a law firm, not a licensed immigration consultant."*

- **Jurisdiction / context**: Canada — IRPA s.91 (only CICC-regulated consultants, lawyers, and Quebec notaries may represent or advise for a fee) and CICC advertising rules. United Kingdom — Immigration and Asylum Act 1999 s.84 and the OISC/IAA regime. Australia — Migration Act s.276 and MARA registration. Across all target markets: EU UCPD Art. 6 (misleading actions), UK CPUTR/DMCCA, US FTC Act s.5, and Canadian Competition Act s.52/74.01 on false or misleading representations. The words *"every"* and *"approved"* are the load-bearing risk.

- **Engineering controls already implemented**:
  - Verification/payout columns are protected from consultant self-modification by a database trigger: `supabase/migrations/20260816120000_sec_rls_column_hardening.sql:47-56`, raising `'SEC-4090: consultant may not modify verification/payout/rating columns'`.
  - `license_verified` is deliberately excluded from the client-writable DTO: `apps/api/src/modules/marketplace/marketplace.dto.ts:11-14`.
  - Self-serve profiles cap themselves at `pending_review`: `apps/api/src/modules/marketplace/marketplace.dto.ts:30`; a human admin transition is required to reach `active` (`apps/api/src/modules/marketplace/marketplace-admin.controller.ts:38-51`, `JwtGuard` + `RolesGuard`).
  - The public consultant profile renders **no** trust or verification badge — only country codes and languages (`apps/web/app/[locale]/(dashboard)/consultants/[id]/page.tsx:67-76`), so the misrepresentation is confined to marketing copy rather than being asserted per-consultant.
  - Genuine human review machinery exists downstream: `apps/api/src/modules/consultant/consultant-approval.service.ts:162,180`; state machine at `apps/api/src/modules/verification/verification.service.ts:40-42`; the consultant-facing AI assistant is explicitly advisory (`apps/api/src/modules/consultant/ai-review-assistant.service.ts:647`, `apps/api/src/modules/consultant/consultant.controller.ts:71`).

- **Remaining legal question**: Can VisaAI make any "licensed consultant" representation before a verification pipeline exists that checks a licence against the issuing regulator's register? If a verification step is built, does presenting a regulated professional through a platform that takes a 20% commission make VisaAI itself a participant in the regulated activity, or a referral intermediary, in Canada, the UK and Australia? Is the word "approved" (as distinct from "reviewed") sustainable in any market?

- **Counsel decision required**: Rule on whether the "licensed consultant" copy may remain live at all pending a working verification control. Approve or reject specific replacement wording. Specify the minimum verification evidence counsel requires per regulator (CICC, IAA/OISC, MARA, state bar), whether periodic re-verification is required, and whether a per-consultant verified/unverified indicator must be shown to users.

---

## L-03 — Paid eligibility assessment and application preparation where immigration advice is a licensed activity

- **Severity**: Critical before launch

- **Issue**: Independently of the marketplace, the core product performs, for a fee, activities that several target jurisdictions define as regulated immigration advice: assessing which visa a person qualifies for, recommending visa categories, telling the user what to fix to strengthen a case, and drafting the substantive narrative documents in the application.

- **Current behavior**:
  - Public marketing headline: `apps/web/messages/en.json:610` — `pricing.heroTitle`: `"Find out which visa you qualify for"`; lede at `:611`: `"Take a free 3-minute eligibility assessment."` Rendered at `apps/web/app/[locale]/pricing/page.tsx:62-63`.
  - Visa-category recommendation with per-option scoring: `apps/api/src/modules/vri/graphs/nodes/suggest-visa-categories.ts:15-33`, output shown at `apps/web/app/[locale]/(dashboard)/readiness/[applicationId]/readiness-client.tsx:373-388` under `apps/web/messages/en.json:246-248`.
  - Case-strengthening advice generated by a model prompted as an advisor: `apps/api/src/modules/vri/graphs/nodes/generate-recommendations.ts:20-25` — `"You are a visa application advisor… provide ONE specific, actionable recommendation to strengthen it."` Rendered at `readiness-client.tsx:353-361`.
  - Substantive drafting of application content: `apps/api/src/modules/narrative/graphs/nodes/draft-document.ts:11-19` generates Letter of Explanation, travel itinerary and cover letter; system role at `:40` is `"You are an expert immigration document writer."`
  - Official form field completion: `apps/api/src/modules/prefill/forms/imm5257.ts:112-133` fills IRCC IMM 5257 AcroForm fields; served to the user at `apps/api/src/modules/prefill/prefill.controller.ts:114-135`.
  - Intake explicitly elicits inadmissibility-relevant facts: `apps/api/src/modules/intake/graphs/nodes/ask-question.ts:163` instructs the agent to ask about *"criminal history, prior immigration violations, dependents"*, and `:88` places a criminal charge in scope; `apps/api/src/modules/visa-rules/rule.types.ts:57,59` carry `has_prior_refusal` and `has_criminal_record`.
  - A voice assistant answers case questions in conversation: `apps/api/src/modules/voice/voice-orchestration.service.ts:161,219`.
  - All of this is sold: one-time plans at `packages/types/src/index.ts:32-36` (`$10 / $30 / $250`), a `$29` prefill fee at `apps/api/src/modules/billing/billing.service.ts:32-35`.
  - Marketing positions the product against regulated advisers on price: `apps/web/messages/en.json:614` — `"Traditional immigration consultants charge $500–$5,000 per application. VisaAI prepares yours…"`

- **Jurisdiction / context**: Canada IRPA s.91 (advice or representation for consideration, at any stage of an application, is restricted to authorised representatives); UK Immigration and Asylum Act 1999 s.82–84 and the OISC/IAA scheme (advice or services in relation to a "relevant matter" in the course of a business); Australia Migration Act 1958 s.276/280 ("immigration assistance", which expressly includes preparing or helping prepare a document and advising on a visa application); US unauthorized practice of law and state immigration-consultant statutes (e.g. California Business & Professions Code s.22440 et seq. on immigration consultants and "notario" restrictions). Locales served include `en`, `fr`, `de`, `es`, `it`, `pt`, `nl`, `ar`, `tr`, `hi`, `ur`, `zh`, `zh-TW`, `ja`, `ko` (`apps/web/i18n/config.ts:5-20`), so the addressable user population spans all of the above.

- **Engineering controls already implemented**:
  - Explicit non-advice positioning in the Terms: `apps/web/app/[locale]/terms/page.tsx:33-36` and `:49-54`.
  - A blocking, unbundled acknowledgement at email signup: `apps/web/app/[locale]/(auth)/signup/page.tsx:163-168` — `"I understand VisaAI is a preparation tool, not legal advice, and does not guarantee any visa outcome."`, with `disabled={!accepted}` at `:170`.
  - Persistent disclaimer on the auth screens: `apps/web/components/auth/auth-split-layout.tsx:32` — `"Preparation tool — not legal advice. No outcome guaranteed."`
  - Disclaimer on the AI drafting surface: `apps/web/app/[locale]/(dashboard)/narrative/[applicationId]/narrative-client.tsx:146-147` — `"VisaAI does not provide legal advice. For review of your specific case, a licensed immigration consultant (RCIC) can help."`
  - Voice assistant self-identifies as non-licensed on a safety trigger: `apps/api/src/modules/voice/voice-safety.ts:220-221`.
  - Prompt-level anti-fabrication constraints: `apps/api/src/modules/narrative/graphs/nodes/draft-document.ts:14` (`"Never invent facts"`), `:16`, `:18`; `apps/api/src/modules/vri/graphs/nodes/generate-recommendations.ts:25`; `apps/api/src/modules/visa/visa.agents.ts:62-71`.
  - A user-approval gate before an AI draft is treated as final: `apps/api/src/modules/narrative/narrative.service.ts:98-125`, surfaced as `"Save & Approve"` (`apps/web/messages/en.json:358`).
  - Scope guard on the intake agent: `apps/api/src/modules/intake/scope-guard.ts:21`.

- **Remaining legal question**: Does the combination of paid eligibility determination, visa-category recommendation, tailored case-strengthening advice, and drafting of substantive application documents constitute "advice", "representation", or "immigration assistance" under IRPA s.91, IAA s.82–84, and Migration Act s.276 — and does a disclaimer that the tool "is not legal advice" change that characterisation where the statutes look at the activity rather than the label? Does the answer differ between the fully automated path and the marketplace path? Which of these features, if any, must be geo-restricted, licensed, or removed per market?

- **Counsel decision required**: Provide a per-market determination (Canada, UK, Australia, US, and the EU/EEA markets implied by the locale set) on which product surfaces may operate, and on what basis — exemption, licensure, partnership with a regulated firm, or geo-restriction. Approve the exact wording and placement of the non-advice disclaimer required on each affected surface. Decide whether "Find out which visa you qualify for" may remain as the public headline.

---

> **STATUS 2026-08-21: partially mitigated.** "most likely to be approved" was
> removed from `readiness.bestFitIntro` and from the upsell copy in
> `readiness-client.tsx`; a `scoreDisclaimer` now renders directly above the
> percentage list, stating the score measures fit to the applicant's answers and
> is not a probability of approval. "improves approval odds" was removed from two
> `strengthenHint` strings. The claims test now fails the build on
> "most likely to be approved", "approval odds/chance/probability/likelihood"
> and "auto-submit".
>
> NOT resolved: the underlying field is still named `approval_likelihood` and is
> a model output, and the disclaimer is English-only across 15 locales.

## L-04 — Approval-likelihood and outcome claims rendered without a disclaimer on the surface that shows them

- **Severity**: Critical before launch

- **Issue**: The product renders a number that a user will read as their odds of being granted a visa, alongside prose stating which visas are "most likely to be approved", on a page that carries no disclaimer of any kind. Separately, two strings assert that using the product improves approval odds.

- **Current behavior**:
  - `apps/web/messages/en.json:247` — `readiness.bestFitIntro`: `"Based on your profile and VRI scores, these visa categories from the official immigration authority of {country} are most likely to be approved."` Rendered at `apps/web/app/[locale]/(dashboard)/readiness/[applicationId]/readiness-client.tsx:373`.
  - `apps/web/messages/en.json:248` — `readiness.matchPct`: `"{pct}% match"`, rendered at `readiness-client.tsx:382`. The number substituted is `approval_likelihood` (`apps/api/src/modules/vri/graphs/vri.state.ts:51`), produced by a prompt that asks the model to *"Estimate the applicant's approval likelihood as an integer 0-100"* (`apps/api/src/modules/vri/graphs/nodes/suggest-visa-categories.ts:21`). The word "approval" is dropped at the render boundary; the number is unchanged.
  - Unlike the evaluator in `visa.agents.ts`, this value has **no anti-certainty clamp** — the schema permits 0 and 100 (`apps/api/src/modules/vri/graphs/nodes/suggest-visa-categories.ts:61`, clamped again only to 0–100 at `:189-192`).
  - `apps/web/messages/en.json:146` — `intake.strengthenHint`: `"Optional — improves approval odds"`.
  - `apps/web/messages/en.json:199` — `documents.strengthenHint`: `"Optional — not required, but these improve your approval odds."`
  - `apps/web/messages/en.json:266-267` — `"At risk"` / `"A common refusal reason. Address this first."`
  - **There is no disclaimer anywhere in `readiness-client.tsx` (495 lines).** No "estimate", no "not a prediction", no "does not guarantee", no AI label — even though the recommendations (`:353-361`) and the visa suggestions including free-text `reasoning` (`:391`) are raw model output.
  - The upsell copy on the same page markets the number as predictive: `readiness-client.tsx:333-337` — `"Upgrade to Copilot to see ranked visa categories you're most likely to be approved for…"`
  - The parallel evaluator produces `calculated_success_probability` (`apps/api/src/modules/visa/visa.schemas.ts:18`), rendered by a copywriter prompt that asks for a *"## Success Probability (bold percent + one-line uncertainty caveat)"* (`apps/api/src/modules/visa/visa.agents.ts:166-172`) — meaning the caveat wording is LLM-authored per request and is not a fixed, reviewable string. This path is consumed by mobile only (`apps/mobile/app/(app)/eligibility.tsx:91-96`).
  - The `escalate` / `escalationReason` signals produced for sub-50 scores (`apps/api/src/modules/vri/vri.service.ts:138-139`) are never surfaced to the user — no consumer exists in `apps/web` or `apps/mobile`.

- **Jurisdiction / context**: EU UCPD Art. 6 and Annex I; UK CPUTR/DMCCA; US FTC Act s.5 and the FTC's guidance on substantiation of objective performance claims; Canadian Competition Act s.52 and s.74.01(1)(b) (performance representations not based on adequate and proper testing). Immigration-specific: guaranteeing or implying influence over a government decision is precisely the conduct CICC, the IAA and MARA advertising rules prohibit. There is no dataset in the repository correlating VRI scores with real outcomes — `application_outcomes` exists (`supabase/migrations/20260604000000_analytics.sql:104`) but nothing calibrates the score against it — so the substantiation question is live.

- **Engineering controls already implemented**:
  - The VRI score itself is deterministic and auditable, not model-generated: six pure scoring functions at `apps/api/src/modules/vri/graphs/scoring/score-documentation.ts:17-20`, `score-financial.ts:8-28`, `score-travel-history.ts:15`, `score-home-ties.ts:9-12`, `score-employment.ts:9-22`, `score-consistency.ts:27-30`; published weights at `apps/api/src/modules/vri/risk-config.types.ts:54-61`; weighted aggregate renormalised over assessed factors only at `apps/api/src/modules/vri/graphs/nodes/aggregate-score.ts:15-40`.
  - The framing chosen for the headline number is readiness, not prediction: `"Visa Readiness Index"` / `"Your application strength assessment"` / `"Overall VRI / 100"` (`apps/web/messages/en.json:236-237,243`).
  - The `visa.agents.ts` evaluator has a hard anti-certainty instruction and a server-side clamp: prompt at `apps/api/src/modules/visa/visa.agents.ts:111-121` (`"NEVER 100. NEVER express certainty."`), clamp to 1–99 at `:156-160` with the comment `"Defensive: never assert certainty regardless of model output."`
  - The copywriter prompt forbids guarantee language: `apps/api/src/modules/visa/visa.agents.ts:172` — `"Do NOT claim guaranteed approval."`
  - Mobile does carry a disclaimer pinned above the AI report: `apps/mobile/src/i18n/messages.ts:103-104` and `apps/mobile/app/(app)/eligibility.tsx:209`.
  - No `guarantee`, `100%`, `success rate`, `money-back`, `risk-free`, testimonial, star-rating or user-count claim appears anywhere in `apps/web/messages/en.json` or rendered JSX. The structured-data layer documents and enforces a deliberate no-fabrication policy: `apps/web/lib/seo/structured-data.ts:1-12` (`"no aggregateRating, no review, no foundingDate, no employee count"`).

- **Remaining legal question**: Is a per-visa percentage derived from a model's "approval likelihood" defensible when relabelled `"{pct}% match"`, or does the relabelling aggravate the position by obscuring what the number is? What substantiation would counsel require before any figure that a consumer can read as approval odds is displayed? Are `"improves approval odds"` and `"most likely to be approved"` sustainable in any target market? Must an LLM-authored uncertainty caveat be replaced with fixed, counsel-approved text?

- **Counsel decision required**: Approve or reject each of the specific strings at `apps/web/messages/en.json:146`, `:199`, `:247`, `:248` and `readiness-client.tsx:333-337`. Specify the mandatory disclaimer text and its placement on the readiness surface. Decide whether `approval_likelihood` may be shown to users at all, and if so whether it requires the same 1–99 clamp already applied at `apps/api/src/modules/visa/visa.agents.ts:156-160`.

---

> **STATUS 2026-08-21: the false capability claim is FIXED.** The payment toast
> read "downloads and auto-submit are unlocked"; it now reads "downloads and
> assisted form filling are unlocked. You still submit the application
> yourself." Verified against `apps/extension/src/executor/safety-guards.ts`,
> which blocks every submit/button/file control, and the execution-path
> invariant that enforces the absence of any submit, click or navigation call —
> the extension is architecturally incapable of submitting.
>
> This mattered beyond marketing: a paying user who believed the product would
> submit for them might never submit at all.

## L-05 — "Auto-submit" copy asserts a capability the code does not have

- **Severity**: Critical before launch

- **Issue**: Four user-facing surfaces tell the user that VisaAI will auto-submit their application on the official government portal, and one of them ties that capability to a paid unlock. The extension cannot submit — submission is architecturally impossible and statically enforced. The same copy also undercuts the product's core legal position that the user, not VisaAI, files the application.

- **Current behavior — the claims**:
  - `apps/web/app/[locale]/(dashboard)/prefill/[applicationId]/prefill-client.tsx:363` — `"Downloading the filled forms or letting VisaAI auto-submit them on the official portal needs a one-time fee per visa."`
  - `apps/web/app/[locale]/(dashboard)/prefill/[applicationId]/prefill-client.tsx:378` — heading `"Unlock downloads & auto-submit"`.
  - `apps/web/messages/en.json:445` — `"Payment confirmed — downloads and auto-submit are unlocked."`
  - `apps/web/lib/payment-error.ts:16` — toast `"Unlock downloads & auto-submit — redirecting to checkout…"`
  - Repository documentation repeats it: `CLAUDE.md` describes the extension as *"portal auto-fill + submission"* and *"the full submission flow"*.

- **Current behavior — what the code actually does**:
  - The extension's only DOM write is a field-value assignment: `apps/extension/src/executor/field-executor.ts:19-39`, setting `.value` via the native prototype setter (`:31-33`) and dispatching only `input` (`:35`) and `change` (`:36`).
  - Submit controls are unwritable by construction: `apps/extension/src/executor/safety-guards.ts:8` (`WRITABLE_TAGS = INPUT|TEXTAREA|SELECT`), `:10` (`FORBIDDEN_INPUT_TYPES` includes `submit`, `button`, `image`, `reset`, `file`, `password`), `:21-22` (disabled/readonly rejected). Header comment at `:3-5`: *"It must never target a submit/button/file control, never click, never submit a form, never navigate."*
  - A build-failing static invariant enforces this: `apps/api/test/execution-path-invariant.spec.ts:107-126` asserts the executor contains none of `.click(`, `submit`, `location.href`, `window.location`, `.submit(`; `:74-105` asserts every other portal-context script contains no write primitive at all.
  - Server-side there is **no `submission` module** and no submit path: `apps/api/src/modules/portal-fill/portal-fill.module.ts:21-22` — *"The DOM write lives only in the extension; the server never accesses the DOM and has no submit path."*; `apps/api/src/modules/portal-fill/field-executor.port.ts:42` — *"NO DOM access, NO submit, NO retry."* The default transport is disconnected (`field-executor.port.ts:142-152`).
  - There is no e-signature, attestation, or declaration-signing capability anywhere; `declaration` exists only as a blank document-template kind (`apps/api/src/strategies/types.ts:128,136`).
  - **Contradicted by the product's own disclaimers**, which are accurate: `apps/web/messages/en.json:370` — `"You always complete payment, signature, and final submission."`; `apps/api/src/modules/automation/fill-instructions.ts:108` — `"VisaAI never submits or pays on your behalf."`; `apps/extension/manifest.json:6` — `"You always complete payment and submission."`; `apps/web/app/[locale]/(dashboard)/submission/[applicationId]/submission-client.tsx:244-247`.

- **Jurisdiction / context**: Two distinct exposures. (1) Consumer protection — a paid feature described in terms the product does not deliver: EU UCPD Art. 6, UK CPUTR/DMCCA, FTC Act s.5, Canadian Competition Act s.52. (2) Regulated-representation risk — a claim that the platform submits an application on the applicant's behalf is close to a claim to act as a representative, engaging IRPA s.91, IAA s.84 and Migration Act s.276, and touching the truth-declaration a visa applicant personally signs. Immigration forms contain a personal declaration; a platform that appeared to submit on the applicant's behalf raises misrepresentation questions under IRPA s.40 for the applicant.

- **Engineering controls already implemented**:
  - The static build invariant described above (`apps/api/test/execution-path-invariant.spec.ts:25-32,74-105,107-126`) — a genuinely strong control that makes the capability impossible to add silently.
  - Legacy socket-driven fill defaults off and fails closed with an audit event: `apps/api/src/config/configuration.ts:218-221`; `apps/api/src/modules/automation/automation.service.ts:45-56,101,145`; `apps/api/src/modules/automation/automation.gateway.ts:80-96` (writes `LEGACY_AUTOMATION_BLOCKED`).
  - Hash-chained, append-only audit of every field write: `apps/api/src/modules/portal-fill/portal-fill-orchestrator.ts:45,51-57,75-82,95-102,106-113,126-136`; storage guarantees at `supabase/migrations/20260606000004_audit_events.sql:5-8` (*"INSERT-only, per-application hash chain, value HASHES only (no raw PII)"*).
  - Server-side re-verification of any "verified" claim from the extension, with replay refusal: `apps/api/src/modules/portal-fill/field-executor.port.ts:60-69,93-126`.
  - Accurate counter-copy already exists on the submission surface (`en.json:370`, `submission-client.tsx:244-247`) and in the extension manifest (`apps/extension/manifest.json:6`).

- **Remaining legal question**: Does the "auto-submit" copy constitute a misleading commercial practice given that the paid unlock is described partly by reference to a capability that does not exist? Independently, would VisaAI performing or appearing to perform submission — now or in future — characterise it as a representative under IRPA s.91 / IAA s.84 / Migration Act s.276, and what does that mean for the applicant's personal declaration? Should the Terms address automated interaction with government systems at all, given they currently say nothing about it?

- **Counsel decision required**: Direct removal or replacement of the four "auto-submit" strings and approve replacement wording. Confirm whether the product may ever perform submission, and if the answer is no, whether counsel wants that recorded as a binding product constraint in the Terms. Approve the extension-related clause set for the Terms, which currently has none.

---

## L-06 — Persistent client identifier and `dataLayer` telemetry written on first paint with no consent mechanism

- **Severity**: Critical before launch

- **Issue**: On every page load, including the public pricing, privacy and terms pages, the application writes a persistent pseudonymous identifier to the visitor's browser storage and pushes events into `window.dataLayer`. There is no cookie banner, no consent manager, and no consent gate of any kind anywhere in the codebase. The privacy notice does not mention cookies, local storage, or the identifier.

- **Current behavior**:
  - `AnalyticsProvider` is mounted in the root locale layout, so it runs on every route: `apps/web/app/[locale]/layout.tsx:12` (import) and `:118` (render). Implementation at `apps/web/components/providers/analytics-provider.tsx:17-27` — fires `session.started` on mount, `page.viewed` on every route change, `user.identified` when auth resolves.
  - The SDK writes a persistent UUID to `localStorage`: `apps/web/lib/analytics/anonymous-id.ts:1-11`, key `va_anon_id`.
  - It is on by default and has no per-visitor switch: `apps/web/lib/analytics/client.ts:12` — `const ENABLED = process.env.NEXT_PUBLIC_ANALYTICS_ENABLED !== 'false'`. `.env.example:147` sets `NEXT_PUBLIC_ANALYTICS_ENABLED=true`.
  - Events are beaconed to the API: `apps/web/lib/analytics/client.ts:34` (`navigator.sendBeacon('/analytics/collect')`), with an unload hook at `:76-77`.
  - A **second**, separate telemetry path pushes unconditionally into the GTM/GA4 queue: `apps/web/lib/analytics.ts:34-35` — `window.dataLayer = window.dataLayer ?? []; window.dataLayer.push(payload)`, with an optional beacon to `NEXT_PUBLIC_ANALYTICS_URL` at `:37-40`. Call sites include the **public** guest funnel: `apps/web/app/[locale]/(public)/intake/[applicationId]/intake-chat-client.tsx:12`, `apps/web/components/auth/auth-gate-provider.tsx:6`, `apps/web/components/auth/auth-modal.tsx:13`, `apps/web/app/[locale]/(auth)/login/page.tsx:7`.
  - **No consent mechanism exists.** Searches across `apps/web` for `CookieBanner`, `cookie consent`, `consentmanager`, `cookiebot`, `osano`, `onetrust`, `klaro`, `usercentrics` return nothing. The only `gdpr` match in the web app is prose in the privacy page.
  - The privacy notice says only `"We also collect basic usage analytics that do not contain your document contents."` (`apps/web/app/[locale]/privacy/page.tsx:36-40`). It contains no cookie table and no mention of `localStorage` or `va_anon_id`.
  - Other client-side storage set without notice: `NEXT_LOCALE`, a one-year cookie (`apps/web/i18n/config.ts:30`; `apps/web/app/actions/set-locale.ts:14`); Supabase `sb-*` auth cookies (`apps/web/proxy.ts:48-66`); a service worker at `apps/web/public/sw.js`.

- **Jurisdiction / context**: ePrivacy Directive Art. 5(3) as implemented nationally — Germany TDDDG §25, France (CNIL) Art. 82 Loi Informatique et Libertés, Italy, Spain, Netherlands, Portugal; UK PECR reg. 6. All of these require prior consent for storing or accessing information on terminal equipment unless strictly necessary for a service the user requested. A cross-session analytics identifier is not generally treated as strictly necessary; French and German regulators have issued specific guidance and enforcement on exactly this pattern. Six or more of the 15 configured locales (`fr`, `de`, `es`, `it`, `nl`, `pt`) map to EU/EEA markets, and `en` covers the UK. Separately, GDPR Art. 13 requires the identifier and its purpose to be disclosed at collection.

- **Engineering controls already implemented**:
  - **No third-party trackers are loaded.** Verified absent from `apps/web/package.json` and from all rendered scripts: PostHog, Mixpanel, Segment, Amplitude, Plausible, Google Analytics/GTM, Hotjar, Clarity, FullStory, Vercel Analytics, Sentry. Analytics is first-party into `analytics_event_stream` (`apps/api/src/config/configuration.ts:234`). This materially narrows the exposure to a first-party-consent question rather than a third-party-transfer question.
  - A documented and enforced no-PII policy on event properties: `apps/web/lib/analytics/client.ts:6-8` — *"props may only contain ids, enums, and paths — never names, emails, free-text, or other personally identifiable information."*
  - A real, scheduled 90-day retention job on raw events: `apps/api/src/modules/analytics/retention/analytics-retention.scheduler.ts:18-27` (daily repeatable, fixed `jobId`), processor at `apps/api/src/modules/analytics/retention/analytics-retention.processor.ts:17-19`, cutoff from `ANALYTICS_RAW_RETENTION_DAYS` default 90 at `apps/api/src/modules/analytics/retention/analytics-retention.service.ts:19-24`, bounded delete at `apps/api/src/modules/analytics/warehouse/supabase-warehouse.provider.ts:48-59`.
  - The SDK degrades safely when storage is unavailable rather than falling back to fingerprinting: `apps/web/lib/analytics/anonymous-id.ts:12-15`.
  - A per-user, per-version, revocable consent model already exists in the codebase for voice — `supabase/migrations/20260805050000_voice_assistant.sql:12-28` — and is a usable template for a site-wide consent record.

- **Remaining legal question**: Does `va_anon_id` qualify as strictly necessary under any national implementation of Art. 5(3), and if not, what consent architecture does counsel require — banner with reject-all parity, granular categories, consent logging, and what re-consent cadence? Is the `window.dataLayer` push acceptable while no tag manager is installed, given that installing one later would silently begin transmitting to Google? Does the one-year `NEXT_LOCALE` cookie fall inside the strictly-necessary exemption?

- **Counsel decision required**: Specify the consent model required per market and whether launch in EU/EEA and UK may proceed before it exists. Approve the cookie/storage table for the privacy notice, including `va_anon_id`, `NEXT_LOCALE`, and the Supabase `sb-*` cookies. Rule on whether the `window.dataLayer` path must be removed or gated now.

---

## L-07 — No controller identity, no reachable privacy contact, no EU/UK Article 27 representative

- **Severity**: Critical before launch

- **Issue**: The product does not identify the legal entity that operates it, gives no address, no email, no DPO and no EU or UK representative. The single privacy contact method the notice advertises does not exist as a route in the application, and is in any case unreachable by the people most likely to need it.

- **Current behavior**:
  - `apps/web/app/[locale]/privacy/page.tsx:75-79` — the entire Contact section: `"For privacy requests, contact us through the in-app support channel."`
  - **There is no in-app support channel.** The full route inventory (58 pages under `apps/web/app/[locale]`) contains no `/support`, `/help`, `/contact`, `/about`, `/imprint`, `/legal`, `/cookies`, `/accessibility` or `/dsar` route.
  - No legal entity is named anywhere in `apps/web/app`, `apps/web/components`, or `apps/web/messages/en.json` — searches for `Inc.`, `Ltd`, `LLC`, `GmbH`, `registered office`, `company number`, `data controller` return nothing.
  - No email address is published anywhere in the web app. The only address in the codebase is the crawler contact in an outbound HTTP header: `apps/api/src/modules/forms/http.ts:57` (`from: 'support@visaai.co'`), which is not user-facing.
  - No DPO and no Art. 27 representative is named in code or documentation.
  - The Terms likewise identify no contracting entity: `apps/web/app/[locale]/terms/page.tsx:29-71`.
  - A user who has already deleted their account, or an anonymous guest (see L-08), cannot reach any of it — the surviving paths all require an authenticated session.

- **Jurisdiction / context**: GDPR Art. 13(1)(a)–(b) (identity and contact details of the controller and, where applicable, the DPO), Art. 27 (representative in the Union for controllers not established in the EU), Art. 37 (DPO designation, engaged by large-scale Art. 9/Art. 10 processing — see L-11); UK GDPR Art. 27 (UK representative). Germany DDG §5 (Impressum — provider identification, with administrative-fine exposure and a well-developed private-enforcement practice); EU Digital Services Act Art. 11–12 (points of contact) and the e-Commerce Directive Art. 5 provider-information requirements. PIPEDA Principle 1 requires an accountable individual and a means of contact. CCPA/CPRA requires at least two designated request methods for consumers.

- **Engineering controls already implemented**:
  - Self-service data export and erasure are genuinely implemented and reachable for logged-in users, which discharges part of the practical burden even though the contact channel is missing: `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:33-150`, rendered at `apps/web/app/[locale]/(dashboard)/profile/page.tsx:59`; endpoints at `apps/api/src/modules/privacy/privacy.controller.ts:35-41` and `:43-52`.
  - Privacy requests are logged with the subject email for audit purposes: `apps/api/src/modules/privacy/privacy.service.ts:196`; table at `supabase/migrations/20260805010000_privacy_requests.sql:13`.
  - Mobile calls the same endpoints (`apps/mobile/src/api/endpoints.ts:57-58`), so the capability is not web-only.

- **Remaining legal question**: Which entity is the controller for each processing activity, and where is it established? Does that establishment trigger Art. 27 EU and UK representative appointments, and does the scale and nature of processing trigger a mandatory DPO under Art. 37(1)(b)/(c)? What is the minimum provider-identification set required for the German and wider EU market, and must it appear on a dedicated page? Which two consumer request methods will satisfy CCPA/CPRA?

- **Counsel decision required**: Name the controller entity, registered address, and contact address to be published. Decide whether a DPO and Art. 27 representatives are required and, if so, supply the details for publication. Approve the structure of the contact/imprint surface — a dedicated page versus footer disclosure — and confirm the DSAR intake channel that must exist and be reachable without an account.

---

## L-08 — Personal data collected from anonymous guests before any notice, terms or rights channel

- **Severity**: Critical before launch

- **Issue**: The primary acquisition funnel is deliberately login-free. It mints an anonymous identity, creates an application, and runs an AI intake interview that elicits personal — and by design inadmissibility-relevant — information, all before the visitor has been shown a privacy notice, has accepted any terms, or has any way to exercise data-subject rights. The account-creation path used by that funnel omits the terms acceptance and disclaimer that the standalone signup page has.

- **Current behavior**:
  - The site root sends every logged-out visitor into the funnel: `apps/web/proxy.ts:124` — `if (!user && path === '/') return redirectTo('/applications/new')`.
  - The funnel mints an anonymous Supabase identity before anything is shown: `apps/web/app/[locale]/(public)/applications/new/page.tsx:30-38` calls `ensureSession()`; implementation at `apps/web/lib/supabase/client.ts:101-120` (`signInAnonymously`), with `is_anonymous = true` (`apps/web/lib/supabase/client.ts:82-83`).
  - It then creates an application server-side (`apps/web/app/[locale]/(public)/applications/new/page.tsx:40-53`) and routes to the public intake chat (`apps/web/app/[locale]/(public)/intake/[applicationId]/page.tsx`).
  - The intake agent is instructed to ask about criminal history and prior immigration violations: `apps/api/src/modules/intake/graphs/nodes/ask-question.ts:163`, `:88`. Answers are extracted and persisted to `application_profiles.profile_json` (`apps/api/src/modules/intake/graphs/nodes/update-profile.ts:8`; schema at `supabase/migrations/20260531000000_initial_schema.sql:46-52`).
  - Analytics fires throughout this pre-notice period — `apps/web/app/[locale]/(public)/intake/[applicationId]/intake-chat-client.tsx:12` and the root-mounted provider (see L-06).
  - **The modal signup path shows no terms and no disclaimer.** `apps/web/components/auth/auth-modal.tsx` (332 lines) contains no reference to terms, privacy, acceptance, guarantee, or legal advice; it calls `signUp` / `upgradeGuestEmail` directly at `:117-118`. This is the path reached from the funnel via `apps/web/components/auth/gated-region.tsx:36`, `apps/web/components/layout/stage-nav.tsx:62`, and `apps/web/app/[locale]/(public)/intake/[applicationId]/intake-chat-client.tsx:62`. The blocking checkbox exists only on the standalone page at `apps/web/app/[locale]/(auth)/signup/page.tsx:163-170`.
  - **Acceptance is never recorded.** `signUp` takes only `{ email, password, fullName }` (`apps/web/lib/supabase/client.ts:90-92`). No `terms_accepted`, `tos_version`, `policy_version` or equivalent column exists in any migration; the only `accepted_at` columns belong to organisation invites (`supabase/migrations/20260628000000_iam_foundation.sql:117`) and beta cohorts (`supabase/migrations/20260806130000_feature_flags_and_beta_cohorts.sql:85`).
  - A guest has no route to erasure or export: `/profile` sits behind the dashboard auth group and `isGated` is true for guests (`apps/web/components/auth/auth-gate-provider.tsx:105`).
  - The cleanup function that would age out abandoned guests exists but **is not scheduled**: `supabase/migrations/20260610000000_cleanup_stale_anonymous_users.sql:12-33`, with the `cron.schedule(...)` call commented out at `:44-53`. No `cron.schedule` for it exists in any migration, and nothing in `apps/api` invokes it.

- **Jurisdiction / context**: GDPR Art. 13 requires the notice at the time the data is obtained, not later; Art. 6 requires a lawful basis identified before processing; Art. 9(2)(a) requires *explicit* consent for special-category data where consent is the basis; Art. 5(1)(e) storage limitation. UK GDPR equivalents. PIPEDA Principles 2–4 (identifying purposes, consent, limiting collection) require knowledge and consent at or before collection. CCPA/CPRA notice-at-collection. Contract formation and unfair-terms questions arise where an account is created without terms being presented. There is also no age gate anywhere in the product (searches for age verification, parental consent, COPPA return nothing) while the product handles dependants and minors (`apps/api/src/modules/visa-rules/rule.types.ts:50-64`; Australian Form 1229 *"Consent to grant an Australian visa to a child under 18"* at `apps/api/src/strategies/document-requirements/document-templates.ts:243`).

- **Engineering controls already implemented**:
  - Guests are real, RLS-scoped identities rather than shared or unauthenticated rows, so a guest can only ever reach their own data: `apps/web/lib/supabase/client.ts:101-107`; RLS on `application_profiles` at `supabase/migrations/20260531000000_initial_schema.sql:54-57`; anonymous-user support handled explicitly at `supabase/migrations/20260610000001_anonymous_users_support.sql:1-12`.
  - `JwtGuard` is documented as fail-closed for anonymous callers, so a guest session is not a general API key: `apps/web/lib/supabase/client.ts:74-76`.
  - Upgrade preserves the identity in place rather than creating a second record: `apps/web/components/auth/auth-modal.tsx:113-118`.
  - The 30-day cleanup function itself is written, permission-hardened (`supabase/migrations/20260610000000_cleanup_stale_anonymous_users.sql:41-42`) and ready to schedule — the gap is operational, not architectural.
  - The standalone signup checkbox is well-implemented where it exists: unbundled, unchecked by default, and blocking (`apps/web/app/[locale]/(auth)/signup/page.tsx:163-170`).

- **Remaining legal question**: What lawful basis applies to data collected from an anonymous visitor before any notice, and can that basis be cured retroactively at signup? Does eliciting criminal-history information in a pre-account chat require explicit consent under Art. 9(2)(a) and additional safeguards under Art. 10? What notice must appear before the first intake question rather than at account creation? Is a client-side-only acceptance that is never recorded sufficient evidence that the user agreed to the Terms? Does the product require an age gate?

- **Counsel decision required**: Approve the pre-collection notice text and its placement in the guest funnel. Direct whether the modal signup path must carry the same blocking acknowledgement as the standalone page. Specify whether terms acceptance must be persisted with a version stamp, and what the retention period for abandoned guest data should be so the cleanup job can be scheduled to it. Rule on whether a minimum-age representation is required.

---

## L-09 — Cached official government forms redistributed from visaai.co and paywalled

- **Severity**: Critical before launch

- **Issue**: The platform downloads official government PDF forms, stores the bytes, serves those bytes from its own origin, and places both the blank official forms and the filled versions behind a paid unlock. No licence, copyright, attribution, or terms-of-use metadata is captured, and no notice tells the user that the document originates from a government and is available free from the source.

- **Current behavior — caching and redistribution**:
  - `form_templates` caches blank official forms, with the bytes held in Supabase Storage rather than in the row: `supabase/migrations/20260811120000_form_templates.sql:65` (`storage_path`), `:66` (`sha256`), `:58` (`landing_url`), `:60-61` (`resolved_pdf_url`, `version_label`), `:74-75` (`fetched_at`, `last_checked_at`). The table comment describes it as *"Cached blank official government forms… Never holds applicant data."*
  - `document_templates` caches authority-published document artefacts the same way: `supabase/migrations/20260813120000_document_templates.sql:72` (`source_url`), `:79` (`storage_path`), `:80` (`sha256`), `:73-74` (`resolved_pdf_url`, `version_label`).
  - The fetcher targets government hosts directly: `apps/api/src/modules/forms/form-catalog.ts:24-49` maps IRCC IMM codes to `https://www.canada.ca/content/dam/ircc/migration/ircc/english/pdf/kits/forms/*.pdf`; the allowlist is at `apps/api/src/modules/forms/http.ts:20-34` (`canada.ca`, `cic.gc.ca`, `gov.uk`, `homeaffairs.gov.au`, `immi.homeaffairs.gov.au`, `state.gov`, `travel.state.gov`, `uscis.gov`, `ec.europa.eu`, `schengenvisainfo.com`).
  - **VisaAI serves the cached bytes from its own origin**: `apps/api/src/modules/prefill/prefill.controller.ts:114-135` streams the PDF as `application/pdf` with `Content-Disposition: attachment`. The user never touches the government URL for these downloads.
  - It also fills and returns the official AcroForm: `apps/api/src/modules/prefill/forms/imm5257.ts:112-133` writes into IRCC IMM 5257 field names using `pdf-lib`; PDF assembly and flattening at `apps/api/src/modules/prefill/prefill-pdf.ts` and `apps/api/src/modules/prefill/pdf-shape.ts`.
  - **Both are paywalled.** `apps/web/app/[locale]/(dashboard)/prefill/[applicationId]/prefill-client.tsx:363` — *"Downloading the filled forms … needs a one-time fee per visa"*; `:381-383` — *"One-time $29 for this visa. Download the filled PDF **and the official government forms**…"*; enforcement returns HTTP 402 at `apps/api/src/modules/prefill/prefill.controller.ts` via `apps/api/src/modules/billing/billing.service.ts:32-35`. `apps/web/messages/en.json:437` renders `"Preview — download locked"`.
  - **No licence metadata is captured.** Neither table has a licence, copyright, rights, or terms-of-use column — verified by searching `supabase/migrations/20260811120000_form_templates.sql` and `supabase/migrations/20260813120000_document_templates.sql`, which return no match for licence, copyright, rights or attribution. Repository-wide searches for `Crown copyright`, `OGL`, `Open Government Licence` and `public domain` likewise return nothing.
  - **No provenance notice is shown on the download surface.** `apps/web/messages/en.json:441` is only `"Official government forms"` and `:443` `"Download {code}"`. No "not an official government site", no "available free from", no retrieved-at date on this surface.

- **Jurisdiction / context**: Canada — Crown copyright under the Copyright Act s.12; IRCC forms are Crown works, and the Government of Canada terms distinguish non-commercial reproduction from commercial redistribution. United Kingdom — Crown copyright, typically licensed under the Open Government Licence, which permits reuse but imposes mandatory attribution and a licence notice; gov.uk terms also restrict implying official endorsement. Australia — Commonwealth copyright, generally CC BY 4.0 for Home Affairs material, again with attribution conditions. United States — 17 U.S.C. §105 places US Government works in the public domain, but USCIS separately restricts commercial use of its forms and has an explicit policy against charging for blank forms. European Commission — Decision 2011/833/EU on reuse, with attribution requirements. The commercial dimension is the sharp edge: charging $29 to download a blank official form that the issuing government provides free is both a licensing question and a consumer-fairness question, and USCIS in particular treats charging for blank forms as a hallmark of immigration-services fraud.

- **Engineering controls already implemented**:
  - Strict host allowlist plus SSRF hardening on the fetcher: `apps/api/src/modules/forms/http.ts:20-34` (allowlist), `:36-49` (HTTPS-only, redirect re-validation), private-IP blocking.
  - Identifying, contactable user agent: `apps/api/src/modules/forms/http.ts:52-58` — `VisaAIBot/1.0 (+https://visaai.co/bot; support@visaai.co)`.
  - `robots.txt` is fetched, parsed and honoured before any document fetch: `apps/api/src/modules/forms/robots.ts:17-84` (`parseRobots`, `isPathAllowed`, `RobotsGate`), enforced at `apps/api/src/modules/forms/form-refresh.service.ts:328` against the *resolved* PDF URL rather than the landing page (`:293-300`).
  - Per-host rate limiting and concurrency caps: `apps/api/src/modules/forms/http.ts` throttle; sweep concurrency bounded in `apps/api/src/modules/forms/sweep/sweep.service.ts`.
  - Integrity and provenance *are* recorded at the data layer even though they are not surfaced to the user: `landing_url`, `resolved_pdf_url`, `version_label`, `sha256`, `fetched_at` and `last_checked_at` at `supabase/migrations/20260811120000_form_templates.sql:58,60-61,66,74-75`, and the equivalents at `supabase/migrations/20260813120000_document_templates.sql:72-74,80`. An attribution and freshness notice can be rendered from data that already exists.
  - **robots.txt refusals are persisted per row, not just honoured at fetch time**: both tables carry a `blocked` status meaning *"robots.txt disallows this URL; never fetch it"* — `supabase/migrations/20260811120000_form_templates.sql:83`, `supabase/migrations/20260813120000_document_templates.sql:91,97`.
  - **The design already falls back to the official link when no cached copy exists**, which is the posture counsel may prefer everywhere: `supabase/migrations/20260811120000_form_templates.sql:63-64` and `supabase/migrations/20260813120000_document_templates.sql:77-78` — *"storage_path is null until a download succeeds, which is what 'serve the official link instead' keys on"*. `document_templates` goes further with a `link_only` status for authorities that publish a page rather than a file (`:88-94`).
  - A database constraint prevents a row from claiming a servable cached copy it does not have: `supabase/migrations/20260811120000_form_templates.sql:92-94`; `supabase/migrations/20260813120000_document_templates.sql:108-110`.
  - Conditional revalidation rather than blind re-download, with an `unchanged` outcome distinct from `ok`: `apps/api/src/modules/forms/form-refresh.service.ts:18`.
  - Provenance *is* already surfaced elsewhere in the product, which sets the precedent: `apps/web/messages/en.json:251` renders a `"Source:"` label on the readiness page (`readiness-client.tsx:399-407`).

- **Remaining legal question**: Does caching and re-serving official PDFs from visaai.co exceed the reuse permitted by Crown copyright (CA/UK), Commonwealth copyright (AU), Commission Decision 2011/833/EU, and USCIS commercial-use policy? Does charging a fee that expressly includes *"the official government forms"* cross from permitted reuse into prohibited commercial redistribution, and does it independently create a consumer-protection or immigration-fraud-indicator problem in the US? What attribution, licence notice, and "available free from the government" disclosure must accompany each form? Is filling and flattening an official AcroForm a derivative work requiring separate permission?

- **Counsel decision required**: Rule per source government on whether cache-and-serve is permitted, or whether the product must link to the government URL instead. Decide explicitly whether blank official forms may sit behind the $29 unlock. Approve the attribution/licence/provenance notice text to be rendered on every form download surface, and specify the licence metadata fields to be added to `form_templates` and `document_templates`.

---

## L-10 — Distance selling: no pre-contract information, no withdrawal right, no consumer refund route

- **Severity**: Critical before launch

- **Issue**: Paid digital content is sold to consumers across EU, UK, Canadian and US markets with none of the pre-contract disclosures those regimes require, no statutory withdrawal right or the express waiver that would displace it, and no implemented refund mechanism — despite the Terms promising that refunds are *"described at checkout"*.

- **Current behavior**:
  - What is sold: three one-time plans at `packages/types/src/index.ts:32-36` — `self_service` $10, `ai_copilot` $30, `expert_review` $250 — plus a `$29` per-visa prefill unlock at `apps/api/src/modules/billing/billing.service.ts:32-35`, and consultant engagements through the marketplace.
  - The Terms' entire treatment of payment: `apps/web/app/[locale]/terms/page.tsx:57-62` — *"Fees are for use of the software, not for any immigration outcome. A visa refusal is not a basis for a refund. Refunds are available only for product failure or an unused paid deliverable, as described at checkout."*
  - **Nothing is described at checkout.** There is no refund-policy string anywhere in `apps/web/messages/en.json` and no refund route in the codebase — searches across `apps/api/src/modules/billing` and `payments` for `refund` return no user-initiated path.
  - **No withdrawal right or waiver.** No `withdrawal`, `cooling-off`, `14 day`, `right to cancel` or equivalent string exists anywhere in `apps/web`. There is no checkbox by which the consumer expressly consents to immediate performance and acknowledges loss of the withdrawal right — the mechanism that would otherwise disapply it for digital content.
  - **No pre-contract confirmation.** The 402 handler redirects the user straight into Stripe Checkout on a toast, with no interstitial showing total price, currency, what is supplied, or that the service begins immediately: `apps/web/lib/payment-error.ts:16-30`.
  - The paywall copy itself is terse and appears only inline: `apps/web/app/[locale]/(dashboard)/prefill/[applicationId]/prefill-client.tsx:378-383`.
  - Pricing is shown without tax treatment: `apps/web/messages/en.json:618` notes only that *"Government processing fees are separate"*. `automatic_tax` does not appear in `.env.example` and Stripe Tax is not enabled in the checkout session construction.
  - Government fees are correctly excluded from what VisaAI charges (`apps/web/messages/en.json:618`, `:625`), but the total-cost-to-user picture is not presented pre-purchase.

- **Jurisdiction / context**: EU Consumer Rights Directive 2011/83/EU Arts. 6 (pre-contract information), 8(2) (the "order with obligation to pay" confirmation), 9–16 (14-day withdrawal), and specifically Art. 16(m), which removes the withdrawal right for digital content only where the consumer gave **prior express consent** and **acknowledged** losing the right — neither of which is collected here. UK Consumer Contracts (Information, Cancellation and Additional Charges) Regulations 2013, regs. 9–13 and 37; UK Consumer Rights Act 2015 Part 1 Ch. 3 (digital content quality rights) and the Digital Markets, Competition and Consumers Act 2024 subscription provisions. Canada — provincial consumer protection acts and the Quebec Consumer Protection Act, which impose distance-contract disclosure and cancellation rights. US — FTC "Negative Option"/Click-to-Cancel rule and state auto-renewal laws (California ARL, New York). EU/UK VAT on electronically supplied services to consumers is a separate live question given no tax configuration was found.

- **Engineering controls already implemented**:
  - Payment is handled through Stripe Checkout rather than a bespoke flow, so PCI scope and the payment-page disclosures are largely delegated: session construction in `apps/api/src/modules/billing/billing.service.ts`.
  - The entitlement model is per-application and one-time rather than a silently recurring charge on the prefill path, which narrows auto-renewal exposure on that product: `apps/api/src/modules/billing/billing.service.ts:32-35`.
  - Server-side entitlement enforcement returns a clean 402 rather than silently degrading: `apps/api/src/modules/prefill/prefill.controller.ts`, `apps/api/src/lib/payment-error` handling at `apps/web/lib/payment-error.ts:14`.
  - The Terms already state the commercially important limitation accurately and prominently — that fees buy software, not an outcome, and that a refusal is not a refund trigger (`apps/web/app/[locale]/terms/page.tsx:59-61`).
  - Government fees are consistently and correctly separated from VisaAI's fee in the pricing copy (`apps/web/messages/en.json:618`, `:625`).

- **Remaining legal question**: Which of the paid products are "digital content" versus "services" for withdrawal purposes, and what is the correct Art. 16(m) / reg. 37 waiver flow for each? What pre-contract information set and order-confirmation wording does counsel require, per market? Given the Terms promise a refund route that does not exist, is that promise itself actionable, and what refund policy should replace it? Is VAT/GST registration and Stripe Tax configuration required before selling into EU/UK markets, and does the consultant marketplace change the analysis by making VisaAI a platform rather than the supplier?

- **Counsel decision required**: Approve the pre-contract disclosure set and the checkout confirmation copy. Specify the withdrawal-right waiver mechanism and its exact wording, or confirm that the 14-day right applies unwaived and a refund path must be built. Approve a refund policy and state where it must be presented. Rule on tax treatment and on whether EU/UK sales may proceed before it is configured.

---

## L-11 — Article 9 / Article 10 data processed at scale with no DPIA, ROPA, DPA or breach procedure

- **Severity**: Critical before launch

- **Issue**: The product systematically collects identity documents, financial records, family composition and criminal-history answers, profiles individuals against risk indicators, and stores the results in schemaless JSON columns with no field-level classification. None of the accountability instruments that this processing presupposes exist in the repository.

- **Current behavior — what is collected**:
  - Identity documents including passports: privacy notice at `apps/web/app/[locale]/privacy/page.tsx:36-40` acknowledges *"identity and financial documents such as passports and bank statements"*; OCR routes identity documents to a dedicated model at `apps/api/src/config/configuration.ts:92-99` (`prebuilt-idDocument`).
  - Criminal-history and prior-refusal facts: `apps/api/src/modules/visa-rules/rule.types.ts:57,59` (`has_prior_refusal`, `has_criminal_record`); intake is instructed to elicit criminal history at `apps/api/src/modules/intake/graphs/nodes/ask-question.ts:163`, and a criminal charge is in scope at `:88`.
  - Family and dependants: `apps/api/src/modules/visa-rules/rule.types.ts:50-64`; minors contemplated at `apps/api/src/strategies/document-requirements/document-templates.ts:243` (Australian Form 1229).
  - Voice transcripts: `supabase/migrations/20260805050000_voice_assistant.sql:31-60` (`voice_sessions`, `voice_transcript_turns`).
  - **Profiling and risk scoring of individuals**: `application_profiles.risk_indicators_json` (`supabase/migrations/20260531000000_initial_schema.sql:50`) and the six-factor VRI (see L-04).
  - **The core personal-data store is schemaless.** `application_profiles.profile_json jsonb not null default '{}'` (`supabase/migrations/20260531000000_initial_schema.sql:49`) — written by an LLM extraction step (`apps/api/src/modules/intake/graphs/nodes/update-profile.ts:8`). There is no field inventory, no data-classification tagging, and therefore no structural limit on what special-category data an open-ended chat can deposit.
  - **What does not exist**: no DPIA, no ROPA/Art. 30 record, no sub-processor list, no DPA or SCC templates, and no breach-response runbook in `docs/` — `docs/legal/` was empty before this document. `docs/security/` contains a substantial security programme (`THREAT_MODEL.md`, `SECURITY_ARCHITECTURE.md`, `SECURITY_OPERATIONS_RUNBOOK.md`, `SECURITY_REMAINING_RISKS.md` and others) but no privacy-law accountability artefacts and no Art. 33/34 notification procedure.
  - Prior credential exposures are recorded as open operator actions in `docs/security/SECURITY_REMAINING_RISKS.md` (SEC-5001 OpenAI key committed to git history; SEC-5003 Upstash token; SEC-5004 Supabase service-role/anon/JWT secret), each pending rotation confirmation — which is a live Art. 33 assessment question, not merely a security backlog item.

- **Jurisdiction / context**: GDPR Art. 9 (special categories — health, biometric where used for identification, religious or philosophical belief, and data revealing them, which bank statements and free-text narratives readily do), Art. 10 (criminal convictions and offences, which may be processed only under authority of law or official authority), Art. 35 (DPIA mandatory for large-scale processing of Art. 9/Art. 10 data and for systematic evaluation including profiling — this processing meets multiple EDPB criteria), Art. 30 (records of processing), Art. 28 (processor contracts), Art. 33/34 (breach notification within 72 hours), Art. 37 (DPO). UK GDPR equivalents plus the DPA 2018 Sch. 1 condition required for criminal-offence data. PIPEDA sensitivity-proportionate safeguards and the mandatory breach-of-security-safeguards reporting regime. CPRA "sensitive personal information" and its limit-use right. Note the Art. 10 point is the most acute: it generally requires official authority or a specific legal authorisation, which a commercial platform will not straightforwardly have.

- **Engineering controls already implemented**:
  - Row-level security on every personal-data table, owner-scoped, with the ownership resolved through the parent application: `supabase/migrations/20260531000000_initial_schema.sql:43`, `:54-57`, and equivalents throughout; a dedicated RLS-hardening pass at `supabase/migrations/20260806100000_security_audit_db_hardening.sql` and `supabase/migrations/20260816120000_sec_rls_column_hardening.sql`.
  - A production boot guard that refuses to start unless data residency is pinned and OCR runs on a regional managed provider: `apps/api/src/config/configuration.ts:356-372` — *"Refuse to boot otherwise so raw identity/financial documents can never silently egress to a non-regional service."*
  - Voice is built to a genuinely privacy-forward design: raw audio never persisted, text only, and only under per-kind, per-policy-version, revocable consent — `supabase/migrations/20260805050000_voice_assistant.sql:1-28`.
  - Append-only, hash-chained audit that stores value **hashes** rather than raw PII: `supabase/migrations/20260606000004_audit_events.sql:5-8`.
  - Analytics carries a documented no-PII property policy and a real 90-day TTL (see L-06).
  - A completed, documented security programme with a threat model and an operations runbook: `docs/security/THREAT_MODEL.md`, `docs/security/SECURITY_OPERATIONS_RUNBOOK.md`, `docs/security/SECURITY_ARCHITECTURE.md`.

- **Remaining legal question**: What is the lawful basis under Art. 6, and the Art. 9(2) condition and Art. 10 authority, for each category of data collected — in particular criminal-history answers? Is a DPIA mandatory here (engineering's reading is that several Art. 35(3) and EDPB criteria are met), and who signs it? Does the schemaless `profile_json` design satisfy Art. 5(1)(c) data minimisation and Art. 30 record-keeping, or must the intake output be constrained to a declared field schema? Which processors require Art. 28 DPAs, and are prior committed credentials a reportable breach under Art. 33 or PIPEDA?

- **Counsel decision required**: Direct whether a DPIA is required and approve its scope and conclusions. Approve the Art. 30 record, the lawful-basis and Art. 9/10 condition mapping per data category, the sub-processor list for publication, and the DPA/SCC templates to be executed. Rule on whether criminal-history intake may proceed at all in EU/UK markets. Determine whether the historical credential exposures require regulator or data-subject notification.

---

## L-12 — Identity and criminality data transferred to OpenAI in the US on paths the residency guard does not cover

- **Severity**: Critical before launch

- **Issue**: The product has a well-built data-residency guard for OCR, but the guard governs the OCR provider only. The intake agent, the VRI reasoning nodes, the narrative drafting nodes and the voice assistant all send extracted document content and intake answers — including criminal-history and financial facts — to OpenAI in the United States. No transfer mechanism, no transfer impact assessment, and no sub-processor disclosure exists.

- **Current behavior**:
  - OpenAI is the primary and hardcoded AI provider: `apps/api/src/modules/shared/ai/ai.service.ts`, with models pinned per the architecture note in `docs/ai/OPENAI_ARCHITECTURE.md` and `docs/exec/COORDINATION_LEDGER.md` recording `gpt-4o`/`gpt-4o-mini` hardcoded across 12 source files.
  - Personal data reaches it on multiple paths: intake question generation and profile extraction (`apps/api/src/modules/intake/graphs/nodes/ask-question.ts:88,163`; `apps/api/src/modules/intake/graphs/nodes/update-profile.ts:8`), visa-category suggestion (`apps/api/src/modules/vri/graphs/nodes/suggest-visa-categories.ts:15-33`), recommendations (`apps/api/src/modules/vri/graphs/nodes/generate-recommendations.ts:20-25`), narrative drafting (`apps/api/src/modules/narrative/graphs/nodes/draft-document.ts:11-19`), the evaluator (`apps/api/src/modules/visa/visa.agents.ts:111-172`), and voice orchestration (`apps/api/src/modules/voice/voice-orchestration.service.ts:161,219`).
  - **The residency guard does not reach these paths.** `apps/api/src/config/configuration.ts:356-372` constrains only `DATA_RESIDENCY_MODE` and `OCR_PROVIDER`; the list of acceptable providers at `:365` is `['azure-di','aws-textract','google-docai']`. Nothing in the guard constrains the LLM used for reasoning or drafting.
  - The codebase is explicit that OpenAI is non-regional: `apps/api/src/config/configuration.ts:101-105` — *"It runs on OpenAI, which is NON-REGIONAL — it therefore ships document text out of region, exactly what DATA_RESIDENCY_MODE exists to prevent."*
  - `.env.example:49` ships `DATA_RESIDENCY_MODE=global` as the default; the guard forces a non-global value only when `NODE_ENV === 'production'` (`apps/api/src/config/configuration.ts:356`).
  - Other recipients of personal data, none disclosed to users: Supabase (self-hosted on a Hostinger VPS per `deploy/nginx/visaai.co.conf:1` and `docs/production/vps-hardening/ecosystem.config.js:5`), Stripe, Azure Document Intelligence (`apps/api/src/config/configuration.ts:91-93`), Upstash Redis, and the email provider. The privacy notice names only one: *"our infrastructure providers (including Supabase)"* (`apps/web/app/[locale]/privacy/page.tsx:52-56`).
  - The privacy notice makes a residency claim engineering cannot presently substantiate for the LLM paths: `apps/web/app/[locale]/privacy/page.tsx:54-55` — *"Where required, data for users in a given region is kept within that region."*
  - Backups are held on the same host as the primary database, recorded as an open operator item: `docs/security/SECURITY_REMAINING_RISKS.md` (SEC-7009).

- **Jurisdiction / context**: GDPR Chapter V — Arts. 44–49. Transfers to the US require a valid mechanism: the EU–US Data Privacy Framework if the importer is certified, otherwise SCCs plus a transfer impact assessment. UK GDPR requires the UK Addendum or IDTA. Swiss FADP has its own bridge. PIPEDA does not restrict transfer but requires comparable protection by contract and transparency about foreign processing; Quebec Law 25 requires a privacy impact assessment before transferring outside Quebec. Art. 13(1)(f) requires the transfer and its safeguard to be disclosed in the privacy notice, which currently discloses neither.

- **Engineering controls already implemented**:
  - The residency guard itself is a genuinely strong control for the OCR path — production refuses to boot on `DATA_RESIDENCY_MODE=global` or a non-regional OCR provider: `apps/api/src/config/configuration.ts:356-372`.
  - The secondary extraction pass that would leak document text is gated fail-closed by default: `OCR_DERIVE_FIELDS` defaults to `auto`, documented at `apps/api/src/config/configuration.ts:100-110` as *"on under 'global' residency, OFF otherwise… No silent default that leaks: the gate fails closed under any residency mode that pins data"*, with the refusal path at `apps/api/src/modules/documents/graphs/nodes/derive-fields.ts:84`.
  - Azure Document Intelligence is deployed as a regional service with in-region processing documented: `.env.example:76` — *"they run in your Azure region, so this keeps document data in-region"*; per-document-type model routing at `apps/api/src/config/configuration.ts:92-99`.
  - Residency mode is threaded into the document processor rather than being config-only: `apps/api/src/modules/documents/documents.processor.ts:96`.
  - AI usage is metered and attributable per user/feature via `AiService`, giving a factual basis for a transfer inventory: `apps/api/src/modules/shared/ai/ai.service.ts:61`.
  - Prompt-injection defences and input fencing are implemented on the AI paths (`docs/security/SECURITY_REMAINING_RISKS.md`, SEC-6006 entry).

- **Remaining legal question**: What transfer mechanism covers the OpenAI processing — DPF certification, SCCs plus TIA, or neither at present — and does the same analysis cover Azure, Stripe and Upstash? Given that the residency guard covers OCR but not LLM inference, is the privacy notice's regional-retention statement accurate as written, and must it be corrected before launch? Does Quebec Law 25 require a PIA before any transfer outside Quebec, and does the self-hosted VPS location satisfy or defeat the residency posture? Is a zero-retention or regional-endpoint arrangement with the LLM provider required?

- **Counsel decision required**: Identify and execute the transfer mechanism for each US-based recipient, and confirm whether launch may proceed in EU/UK/Quebec before they are in place. Approve the corrected residency statement in the privacy notice and the sub-processor list for publication. Rule on whether LLM inference on identity and criminal-history data must be moved to a regional endpoint or brought inside the boot guard.

---

## L-13 — `documents.encrypted = true` is asserted to data subjects while nothing encrypts documents

- **Severity**: High

- **Issue**: Every document row carries a column asserting the file is encrypted. Nothing in the codebase encrypts documents, and the column is never written or read by application logic. That value is included verbatim in the data-subject export, so it is a security representation made directly to the data subject in a statutory disclosure.

- **Current behavior**:
  - `supabase/migrations/20260531000000_initial_schema.sql:82` — `encrypted boolean not null default true` on `public.documents`.
  - The column has **no writer and no reader** in application code: no reference to `encrypted` exists anywhere in `apps/api/src/modules/documents/`. Nothing sets it, nothing checks it, nothing acts on it. Every row is `true` by default alone.
  - It is nonetheless handed to the data subject: the export selects whole rows via `byApp('documents')` (`apps/api/src/modules/privacy/privacy.service.ts:103`), returned in the bundle at `:151`.
  - No application-layer or field-level encryption exists: searches across `apps/api/src` for `pgcrypto`, `createCipheriv`, `KMS`, `vault`, or envelope encryption return no document-encryption implementation. Protection at rest is whatever the underlying disk and Supabase Storage provide.
  - Identity numbers extracted by OCR are stored as ordinary text in `application_profiles.profile_json` (`supabase/migrations/20260531000000_initial_schema.sql:49`), with no tokenisation or column-level protection.
  - The privacy notice makes a matching general claim: `apps/web/app/[locale]/privacy/page.tsx:53-54` — *"stored with our infrastructure providers (including Supabase) under access controls and encryption."*

- **Jurisdiction / context**: GDPR Art. 5(1)(a) (fairness and transparency) and Art. 5(1)(d) (accuracy of personal data, which includes data about the processing state returned to the subject); Art. 15 (the export must be accurate); Art. 32(1)(a) (encryption as an appropriate measure, and the credibility of any claim to have implemented it). Also relevant to breach analysis: whether data was encrypted is the central question in Art. 34 (communication to data subjects may be avoided where data was encrypted) and in PIPEDA's real-risk-of-significant-harm assessment. An inaccurate encryption flag would distort that assessment at exactly the moment it matters. Consumer-protection regimes treat overstated security claims as actionable (FTC Act s.5 has an established line of security-misrepresentation cases).

- **Engineering controls already implemented**:
  - Documents live in a private bucket reached only through short-lived signed URLs, with owner-scoped RLS — the actual access-control posture is sound even though it is not encryption: RLS on `documents` at `supabase/migrations/20260531000000_initial_schema.sql:88`.
  - The production boot guard prevents raw documents from egressing to a non-regional OCR provider: `apps/api/src/config/configuration.ts:356-372` (see L-12).
  - Audit records store value **hashes**, never raw document values: `supabase/migrations/20260606000004_audit_events.sql:5-8`.
  - `X-Content-Type-Options: nosniff`, upload type allowlists and a web CSP are in place, per `docs/security/SECURITY_REMAINING_RISKS.md` (SEC-12001 entry).
  - The team has already demonstrated the right response to this exact class of problem — a false backup claim was removed from the privacy page rather than reworded (`apps/web/app/[locale]/privacy/page.tsx:59-66`).

- **Remaining legal question**: Does an inaccurate `encrypted: true` value returned in an Article 15 export constitute inaccurate personal data and a transparency failure? Is the privacy notice's "encryption" sentence supportable by storage-provider-level encryption alone, or must it be qualified? If a breach occurred, would this flag undermine the Art. 34 / PIPEDA harm assessment and the platform's own evidence of its security posture?

- **Counsel decision required**: Approve the corrected wording of the encryption sentence in the privacy notice. Direct whether the `encrypted` column must be removed, or made truthful by implementing encryption, before the next export is served. Confirm what encryption representation, if any, may be made in the Terms, marketing copy, and any future security questionnaire.

---

## L-14 — DSAR export omits the intake profile and document contents; erasure leaves residue outside the cascade

- **Severity**: High

- **Issue**: The Article 15 export is real and reachable, but it omits the single richest store of personal data in the product and returns no document contents. Erasure is genuinely thorough inside the database and storage, but several categories of personal data sit outside the cascade and are not addressed.

- **Current behavior — export gaps**:
  - The export assembles thirteen tables: `apps/api/src/modules/privacy/privacy.service.ts:101-138`, returned at `:150-163`.
  - **`application_profiles` is not among them.** That is the table holding `profile_json` — the intake answers including criminal-history and financial facts — and `risk_indicators_json` (`supabase/migrations/20260531000000_initial_schema.sql:46-52`). The in-code comment at `apps/api/src/modules/privacy/privacy.service.ts:33-39` lists `application_profiles` among the tables *"the export already contains"* while justifying the removal of a derived view; that premise does not hold.
  - Document **contents** are not exported — `byApp('documents')` (`:103`) returns metadata rows only. The user receives filenames and paths, not their passport scan.
  - `audit_events`, `ai_usage` and analytics events are not exported.
  - The client downloads the bundle as JSON without rendering it, which is a good choice: `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:51-61`.

- **Current behavior — erasure residue**:
  - Erasure purges storage, then deletes the auth identity and relies on the FK cascade: `apps/api/src/modules/privacy/privacy.service.ts:169-198`.
  - Not addressed by that path: the Stripe customer and its payment records; analytics events keyed to `anonymous_id`/`user_id` in `analytics_event_stream` (which age out on the 90-day job rather than on request); `login_history` IP addresses beyond the cascade; and backups — recorded as co-located with the primary database in `docs/security/SECURITY_REMAINING_RISKS.md` (SEC-7009).
  - Audit rows are deliberately retained and anonymised rather than deleted, which is a defensible design but is not disclosed to the user: `supabase/migrations/20260813140000_append_only_cascade_fix.sql:26-33,44-50`.
  - The confirmation copy promises more than the code does: `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:114-115` — *"This permanently deletes your account, applications and uploaded documents."*

- **Jurisdiction / context**: GDPR Art. 15(3) (a copy of the personal data undergoing processing, which includes document contents where they are personal data), Art. 17 (erasure), Art. 19 (notification of erasure to recipients — engaging Stripe and any processor), Art. 20 (portability in a structured, commonly used, machine-readable format — JSON qualifies). UK GDPR equivalents. PIPEDA Principle 9 (individual access). CCPA/CPRA right to know and right to delete, including the obligation to direct service providers to delete.

- **Engineering controls already implemented**:
  - Export and erasure both exist, are reachable in web and mobile, and are server-enforced rather than client-trusted: `apps/api/src/modules/privacy/privacy.controller.ts:35-52`; UI at `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:33-150`; mobile at `apps/mobile/src/api/endpoints.ts:57-58`.
  - Deletion requires a typed `DELETE` confirmation on both client and server, with the server explicitly not trusting the client: `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:78,129` and the note at `:19-22`.
  - **Storage purge is recursive and was hardened after a real gap was found**: `apps/api/src/modules/privacy/privacy.service.ts:200-235` — SEC-12003 fixed a two-level walk that missed message and voice attachments, where *"identity documents exchanged in consultant messaging survived 'erasure'"*. Depth-capped, chunked removal.
  - **The erasure path was broken in production and was fixed**: `supabase/migrations/20260813140000_append_only_cascade_fix.sql:1-33` records that `audit_events` append-only triggers collided with an `ON DELETE CASCADE`, so *"VisaAI cannot honour a right-to-erasure request"* — resolved by moving the FK to `ON DELETE SET NULL` (`:56-70`) so audit integrity and erasure coexist, with orphaned rows made invisible to all non-service roles (`:44-50`).
  - A second real defect in the erasure audit trail was found and fixed: `apps/api/src/modules/privacy/privacy.service.ts:181-193` (PRIV-002) — erasure records were being silently dropped by an FK violation.
  - Every privacy request is logged with status and outcome: `apps/api/src/modules/privacy/privacy.service.ts:196`; `supabase/migrations/20260805010000_privacy_requests.sql:13`.
  - A hard navigation after deletion ensures no deleted-user state survives in the tab: `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:82-87`.

- **Remaining legal question**: Must an Art. 15 export include the contents of uploaded documents, or is metadata plus the user's own retained copies sufficient? Does omitting `application_profiles` render past exports incomplete, and does that require remediation or notification to anyone who already exported? Is retaining anonymised audit rows after erasure justified under Art. 17(3), and must that retention be disclosed in the privacy notice? What must be done about Stripe records, analytics events and backups on an erasure request, and what is the acceptable lag for backup expiry?

- **Counsel decision required**: Approve the definitive list of data categories that must appear in an export, and whether document contents are included. Approve the disclosure text describing what survives erasure and why. Direct whether processor-side deletion (Stripe, analytics) must be propagated on request, and set the maximum acceptable backup-expiry window.

---

## L-15 — No retention schedule for case data; guest cleanup unscheduled; messages retained indefinitely

- **Severity**: High

- **Issue**: Only analytics has an implemented retention limit. Passport scans, bank statements, intake answers, consultant messages and voice transcripts are retained indefinitely by default, with deletion available only if the user asks. The one retention job written for abandoned guest data is not scheduled.

- **Current behavior**:
  - **The only implemented TTL in the product** is the 90-day analytics prune: `apps/api/src/modules/analytics/retention/analytics-retention.scheduler.ts:18-27`, `apps/api/src/modules/analytics/retention/analytics-retention.service.ts:19-24`, `.env.example:143`.
  - No retention job exists for `documents`, `application_profiles`, `generated_documents`, `messages`, `vri_scores`, `login_history`, or the document storage bucket. Searches across `apps/api/src` and `supabase/migrations/` for retention/purge/TTL scheduling return only the analytics job and the unscheduled guest cleanup.
  - **The guest cleanup function is written but never scheduled**: `supabase/migrations/20260610000000_cleanup_stale_anonymous_users.sql:12-33` defines `cleanup_stale_anonymous_users(interval)` with a 30-day default, but the `cron.schedule(...)` invocation is commented out at `:44-53`. No migration schedules it and nothing in `apps/api` calls it. The only other reference is a permissions list in `supabase/seed.sql:62`.
  - Consultant–user messages, which the erasure code confirms carry identity documents as attachments (`apps/api/src/modules/privacy/privacy.service.ts:206-210`), have no retention limit.
  - Voice transcripts are retained under a consent kind called `transcript_retention` (`supabase/migrations/20260805050000_voice_assistant.sql:16`) but no duration is defined or enforced in code.
  - The privacy notice states a rights-based position but no retention periods at all: `apps/web/app/[locale]/privacy/page.tsx:67-72`.
  - Spec §32 requires exactly this to be settled — *"account, profile, applications, uploads, extracted text, AI-generated outputs, embeddings, conversation state, generated files, analytics identifiers, logs, backups"* — and it is not.

- **Jurisdiction / context**: GDPR Art. 5(1)(e) storage limitation and Art. 13(2)(a) (the retention period, or the criteria for determining it, must be stated in the notice — the current notice states neither); UK GDPR equivalents. PIPEDA Principle 5 (Limiting Use, Disclosure, and Retention) requires destruction when the purpose is fulfilled and requires guidelines with minimum and maximum retention periods. CPRA requires disclosure of retention periods per category. Indefinite retention of passport and financial data also enlarges the harm surface of any future breach, which bears on Art. 32 adequacy.

- **Engineering controls already implemented**:
  - The analytics retention job is a complete, working reference implementation — scheduler, processor, service, bounded delete: `apps/api/src/modules/analytics/retention/analytics-retention.scheduler.ts:18-27`, `.../analytics-retention.processor.ts:17-19`, `.../analytics-retention.service.ts:19-24`, `apps/api/src/modules/analytics/warehouse/supabase-warehouse.provider.ts:48-59`. The pattern can be reused for case data.
  - The guest-cleanup function is written, permission-hardened and ready to schedule: `supabase/migrations/20260610000000_cleanup_stale_anonymous_users.sql:12-33,41-42`.
  - Voice was designed with retention in mind from the start — raw audio is never persisted, and retention is a separately revocable consent kind: `supabase/migrations/20260805050000_voice_assistant.sql:1-6,12-23`.
  - `form_templates` carries `fetched_at` and `last_checked_at` for cache freshness (`supabase/migrations/20260811120000_form_templates.sql:74-75`), and a dedicated freshness module exists at `apps/api/src/modules/forms/freshness.ts` — the staleness pattern already exists in the schema vocabulary.
  - User-initiated erasure works and purges storage recursively (see L-14).

- **Remaining legal question**: What retention period applies to each data category, and from what trigger — last activity, application submission, or account closure? Is any retention legally *required* (tax records for payments, dispute-resolution windows for marketplace engagements, professional-conduct records for consultant reviews), and does that conflict with erasure requests? What retention statement must appear in the privacy notice to satisfy Art. 13(2)(a) and PIPEDA Principle 5? What is the correct period for abandoned guest data, so the cleanup job can be scheduled to it?

- **Counsel decision required**: Provide a retention schedule per category — account, profile/intake answers, uploaded documents, extracted text, AI outputs, messages and attachments, voice transcripts, payments, audit, logs, analytics identifiers, backups — with the legal basis for each period. Approve the retention disclosure text. Authorise scheduling the guest-cleanup job at a counsel-approved interval.

---

## L-16 — AI transparency: no provenance in the data model, disclaimers absent from the surface that most needs one

- **Severity**: High

- **Issue**: AI-generated text and AI-derived assessments are presented to users without a machine-readable provenance marker, without a consistent visual label, and — on the readiness surface — without any disclaimer at all. A signal the system computes to flag cases needing human review is discarded rather than surfaced.

- **Current behavior**:
  - **No AI provenance in the data model.** `generated_documents` carries no `ai_generated`, `model`, `prompt_version` or equivalent column; the model identity lives only in transient AI-usage metering (`apps/api/src/modules/shared/ai/ai.service.ts:61`). A document exported, downloaded or attached carries nothing marking it as machine-generated.
  - **The readiness surface has no disclaimer.** `apps/web/app/[locale]/(dashboard)/readiness/[applicationId]/readiness-client.tsx` (495 lines) contains no AI label and no caveat, while rendering LLM-generated recommendations (`:353-361`), LLM-generated visa suggestions with free-text `reasoning` (`:391`), and an approval-derived percentage (`:382`). See L-04.
  - **The disclaimers that do exist are hardcoded English**, so 14 of 15 locales receive them untranslated: `apps/web/app/[locale]/(dashboard)/narrative/[applicationId]/narrative-client.tsx:146-147`; `apps/web/components/auth/auth-split-layout.tsx:32`; the entire `/privacy` and `/terms` bodies.
  - **The `needsHumanReview` / escalation signal is computed and dropped.** `apps/api/src/modules/vri/vri.service.ts:138-139` produces `escalate` and `escalationReason` for low-confidence or low-score cases; no consumer exists in `apps/web` or `apps/mobile`. The user is never told the system flagged their case.
  - The uncertainty caveat on the mobile evaluator path is authored by the model per request rather than being fixed reviewable text: `apps/api/src/modules/visa/visa.agents.ts:166-172`.
  - Self-review is performed by the same model family that produced the draft: `apps/api/src/modules/narrative/graphs/nodes/`, `apps/api/src/modules/visa/visa.agents.ts`.
  - Automated processing is described to users only obliquely: the privacy notice says *"We do not use your documents to make decisions about you"* (`apps/web/app/[locale]/privacy/page.tsx:46-47`), while the product does produce an automated assessment of the person's application strength.

- **Jurisdiction / context**: GDPR Arts. 13(2)(f), 14(2)(g) and 22 (automated decision-making, including profiling — whether the VRI and the visa-category recommendation constitute a decision producing legal or similarly significant effects, or "merely" profiling requiring disclosure, is the live question); Art. 15(1)(h) requires meaningful information about the logic involved. EU AI Act — Art. 50 transparency obligations for AI systems interacting with natural persons and for generated content, with those obligations applying from 2 August 2026; whether any VisaAI component falls in a higher-risk category given the migration context is a counsel question, and Annex III of the AI Act expressly names migration, asylum and border-control use cases. Consumer-protection regimes independently require that a consumer not be misled about whether they are dealing with a human or a machine. PIPEDA reform proposals and Quebec Law 25 s.12.1 already impose automated-decision disclosure in Canada.

- **Engineering controls already implemented**:
  - A user-approval gate before an AI draft becomes final, with edit-then-approve semantics: `apps/api/src/modules/narrative/narrative.service.ts:98-125`; UI at `apps/web/messages/en.json:355-360` (`"Generate supporting documents — review and approve each one"`, `"Save & Approve"`).
  - An explicit AI disclaimer on the drafting surface naming the alternative: `apps/web/app/[locale]/(dashboard)/narrative/[applicationId]/narrative-client.tsx:146-147`.
  - Terms address AI output directly and accurately: `apps/web/app/[locale]/terms/page.tsx:49-54` — *"Drafts produced by VisaAI are starting points that you must read, edit, and confirm. They may contain errors or omissions."*
  - Strong prompt-level anti-fabrication constraints across every generative path: `apps/api/src/modules/narrative/graphs/nodes/draft-document.ts:14,16,18`; `apps/api/src/modules/vri/graphs/nodes/generate-recommendations.ts:25`; `apps/api/src/modules/visa/visa.agents.ts:62-71`.
  - A hard anti-certainty clamp on the evaluator, applied server-side regardless of model output: `apps/api/src/modules/visa/visa.agents.ts:111-121,156-160`.
  - The VRI score itself is deterministic, weighted and explainable rather than model-generated — the logic *can* be disclosed: scoring functions and published weights at `apps/api/src/modules/vri/risk-config.types.ts:54-61` and `apps/api/src/modules/vri/graphs/nodes/aggregate-score.ts:15-40`.
  - Mobile does pin a disclaimer above the AI report: `apps/mobile/app/(app)/eligibility.tsx:209`.
  - Prompt-injection defences and input fencing are implemented on AI paths (`docs/security/SECURITY_REMAINING_RISKS.md`, SEC-6006), and a `GuardrailsService` exists at `apps/api/src/modules/shared/guardrails/guardrails.service.ts` — though the same entry records that its output filter is not yet wired to VRI/analyze.

- **Remaining legal question**: Does the VRI score or the visa-category recommendation engage Art. 22, and if so is explicit consent, contractual necessity, or human intervention required? What "meaningful information about the logic involved" must be published? Does the EU AI Act's migration-related Annex III listing capture any VisaAI component, and what obligations attach and by when? Must AI-generated documents carry a persistent, machine-readable provenance marker — particularly documents a user may file with a government?

- **Counsel decision required**: Determine the Art. 22 and EU AI Act classification for the VRI, the visa recommender, and the narrative generator. Approve the AI-disclosure text required on each generative and assessment surface, including the readiness page, and confirm whether it must be translated into all 15 locales. Rule on whether AI provenance must be persisted in the data model and whether escalation flags must be surfaced to users.

---

## L-17 — Marketplace has no consultant agreement, no professional-liability terms, and no clawback basis

- **Severity**: High

- **Issue**: The platform onboards independent professionals, routes consumers to them, takes a commission, and pays them out — with no contract governing any of it. There is no consultant agreement in the repository and no acceptance flow in code. Professional liability, indemnity, insurance, independent-contractor status, confidentiality and conflict-of-interest are all unaddressed.

- **Current behavior**:
  - Consultants self-onboard through `apps/web/app/[locale]/(dashboard)/become-a-consultant/page.tsx` and the DTO at `apps/api/src/modules/marketplace/marketplace.dto.ts:11-30`. **No terms acceptance, agreement text, or acceptance record exists** — no `consultant_agreement`, `terms_version`, or equivalent column appears in `supabase/migrations/20260626000000_consultant_marketplace.sql`, and no agreement document exists anywhere in `docs/`.
  - Commission is taken by the platform: commission rules in `supabase/migrations/20260626000000_consultant_marketplace.sql`, surfaced in admin analytics at `apps/web/messages/en.json:887` — *"Take-rate is derived from marketplace commission rules."*
  - Payouts run through Stripe Connect: consultant payouts page at `apps/web/app/[locale]/(consultant)/consultant/payouts/page.tsx`; `apps/web/messages/en.json:571` tells consultants a marketplace profile is required *"to start receiving payments for the work you complete."*
  - Consultants review consumer applications containing passport and financial data: `apps/api/src/modules/consultant/consultant-approval.service.ts:162,180`; consultant application view at `apps/web/app/[locale]/(consultant)/consultant/application/[id]/page.tsx`. **No confidentiality or data-processing terms bind them.**
  - Consultant–user messaging carries identity documents as attachments, confirmed by the erasure code: `apps/api/src/modules/privacy/privacy.service.ts:206-210`.
  - **No clawback mechanism.** No refund/reversal path exists that would recover a transferred payout if a consumer disputes or charges back — searches across `apps/api/src/modules/payouts` and `payments` for reversal/clawback logic return nothing.
  - Tax-form collection is unreachable: W-8/W-9 handling exists at the API layer but no UI surfaces it, so no consultant can complete it.
  - No KYC beyond what Stripe Connect performs, and no sanctions or AML screening exists in the codebase.
  - There is no professional-indemnity or errors-and-omissions requirement anywhere.
  - The Terms are silent on the marketplace entirely: `apps/web/app/[locale]/terms/page.tsx:29-71` never mentions consultants, engagements, payouts, or disputes.

- **Jurisdiction / context**: Platform liability for professional services introduced to consumers — EU Digital Services Act trader-traceability obligations (Art. 30) for platforms allowing traders to contract with consumers, and the P2B Regulation 2019/1150 (terms, ranking transparency, suspension grounds, redress) which applies to intermediation services with EU business users. Worker-classification exposure in multiple jurisdictions where the platform sets price mechanics and controls access. Tax reporting: US 1099-K/1099-NEC and Form W-9/W-8BEN collection, EU DAC7 seller reporting, and Canadian equivalents. Professional-regulation exposure flows back to L-02 and L-03: if consultants are regulated persons, the platform's role in advertising, matching and fee-sharing may itself be regulated conduct — fee-sharing with non-licensees is restricted in several regimes. Payment-services and money-transmission analysis depends on who is merchant of record.

- **Engineering controls already implemented**:
  - Consultant-modifiable fields are constrained at the database level: `supabase/migrations/20260816120000_sec_rls_column_hardening.sql:47-56` blocks self-modification of verification, payout and rating columns.
  - Admin approval is required before a profile becomes bookable, behind `JwtGuard` + `RolesGuard`: `apps/api/src/modules/marketplace/marketplace-admin.controller.ts:38-51`; self-serve profiles cap at `pending_review` (`apps/api/src/modules/marketplace/marketplace.dto.ts:30`).
  - A review queue with Approve / Send back / Suspend exists: `apps/web/app/[locale]/(admin)/consultant-review/review-queue.tsx:126-165`.
  - Payouts run on Stripe Connect, so identity verification and payout compliance are substantially delegated to a regulated provider.
  - Consultant access to applications is RBAC- and RLS-controlled and audited: `docs/security/RBAC_SECURITY_MATRIX.md`; append-only audit at `supabase/migrations/20260606000004_audit_events.sql`.
  - Messaging is retained and owner-scoped, so a record of the engagement exists: `supabase/migrations/20260612130000_messaging_p2.sql`.

- **Remaining legal question**: What contract must bind consultants, and must acceptance be versioned and recorded? Are consultants independent contractors in every market where they operate, and what platform behaviours would jeopardise that? Who bears liability for negligent or unlicensed advice given through the marketplace — and does the platform's commission change the answer? Does DSA Art. 30 trader traceability apply? What tax-reporting obligations (1099-K/NEC, DAC7) attach, and by when must W-8/W-9 collection actually work? Is the commission structure permissible fee-sharing in regulated markets?

- **Counsel decision required**: Draft or approve the consultant agreement, including licensure warranties, professional-indemnity/E&O requirements, confidentiality and data-processing terms, independent-contractor status, indemnity, suspension grounds, and clawback rights. Specify the tax forms that must be collected before first payout and direct that the collection UI be built. Approve the marketplace clauses to be added to the consumer Terms, including who the consumer contracts with and how disputes are handled.

---

## L-18 — Terms omit governing law, jurisdiction, dispute resolution, auto-renewal and trading identity

- **Severity**: High

- **Issue**: The Terms of Service run to five short sections. They contain none of the provisions that make a consumer contract operable across jurisdictions, and none of the subscription mechanics the product actually implements.

- **Current behavior**:
  - The complete Terms are five sections: *What VisaAI is*, *Your responsibilities*, *AI-generated content*, *Payments and refunds*, *Limitation of liability* — `apps/web/app/[locale]/terms/page.tsx:29-71`.
  - **Absent entirely**: contracting entity and address (see L-07); governing law; forum/jurisdiction; dispute resolution or arbitration; consumer-mandatory-law carve-outs; subscription auto-renewal, cancellation and price-change terms; account suspension and termination rights; acceptable use; intellectual-property ownership of user content and AI output; DMCA/notice-and-takedown; the consultant marketplace (see L-17); the Chrome extension and automated interaction with third-party systems (see L-05); force majeure; assignment; severability; amendment and notice of change; and any warranty disclaimer beyond the single "as is" clause at `:66-69`.
  - **No versioning or change mechanism.** The only date is the static string at `:26`; there is no version identifier, no change history, and no acceptance record (see L-08), so there is no way to prove which version a given user agreed to.
  - The limitation of liability is a single sentence with no cap, no carve-outs, and no consumer-law qualification beyond *"To the extent permitted by law"* (`:66-69`).
  - Subscription mechanics exist in code (`apps/api/src/modules/billing/`, `subscriptions` table in the privacy export at `apps/api/src/modules/privacy/privacy.service.ts:135`) but are not described in the Terms at all.

- **Jurisdiction / context**: Rome I Regulation Art. 6 and the Brussels I Recast Arts. 17–19 — a consumer cannot be deprived of the protection of their home law, and choice-of-law and forum clauses against EU consumers are constrained. UK equivalents post-Brexit. EU Unfair Contract Terms Directive 93/13/EEC and national blacklists — an unqualified liability exclusion is very likely unfair as against a consumer. UK Consumer Rights Act 2015 Part 2 (fairness) and s.57 (liability that cannot be excluded). Quebec Consumer Protection Act restricts forum-selection against consumers. US: FAA arbitration and class-waiver enforceability varies by state; FTC Click-to-Cancel and state ARL statutes require specific auto-renewal disclosures and cancellation mechanics. Distance-selling overlaps with L-10.

- **Engineering controls already implemented**:
  - The substantive risk-allocation positions that matter most for this product are already stated, and stated well: not a law firm or licensed consultant, no outcome guarantee, user responsibility for accuracy, an explicit warning that misrepresentation in an immigration application carries serious consequences, and fees decoupled from outcome — `apps/web/app/[locale]/terms/page.tsx:33-36`, `:41-45`, `:59-61`.
  - A blocking acceptance checkbox exists on the standalone signup page: `apps/web/app/[locale]/(auth)/signup/page.tsx:163-170`.
  - Both legal pages are linked from signup and from each other: `apps/web/app/[locale]/(auth)/signup/page.tsx:166-167`; `apps/web/app/[locale]/terms/page.tsx:74`.
  - A versioned-consent pattern already exists in the codebase and can be reused for terms acceptance: `supabase/migrations/20260805050000_voice_assistant.sql:12-23`.

- **Remaining legal question**: What governing law and forum can VisaAI validly specify given consumer-protection mandatory rules in the EU, UK, Canada and the US? Is the current unqualified liability exclusion enforceable anywhere, and what cap and carve-out structure should replace it? Are separate consumer and business/consultant terms required? What auto-renewal and cancellation disclosures does each market require? Must the Terms be versioned with recorded acceptance, and does a material change require re-acceptance?

- **Counsel decision required**: Deliver the complete Terms of Service, including the omitted provisions listed above. Specify the versioning and re-acceptance policy so engineering can implement acceptance recording. Confirm whether separate consumer and consultant terms are required, and approve the notice mechanism for future changes.

---

## L-19 — Lifecycle email on implied consent by database default; no `List-Unsubscribe`; broadcast with no consent segmentation

- **Severity**: High

- **Issue**: Email is enabled for every user by a database default rather than by an affirmative choice, there is no opt-in at signup, outbound mail carries no `List-Unsubscribe` header, and an admin broadcast tool can send to all users without reference to any consent state.

- **Current behavior**:
  - Email and push are on by default; only SMS is opt-in: `supabase/migrations/20260613120000_messaging_p3b_notifications.sql:23-24` — `email_enabled boolean not null default true`, `push_enabled boolean not null default true`. SMS is deliberately different at `supabase/migrations/20260702000000_notification_sms_channel.sql:3-5` — *"Opt-IN (default false): SMS is intrusive + costs money, unlike email/push."*
  - **No marketing opt-in exists at signup.** `apps/web/app/[locale]/(auth)/signup/page.tsx` has one checkbox, for Terms and Privacy (`:163-170`); there is no separate, unbundled marketing consent. The modal path has no checkbox at all (see L-08).
  - **No `List-Unsubscribe` or `List-Unsubscribe-Post` header** is set anywhere: searches across `apps/api/src` return no match. Gmail and Yahoo bulk-sender requirements have mandated one-click unsubscribe since 2024.
  - An admin broadcast surface exists: `apps/web/app/[locale]/(admin)/broadcasts/page.tsx`, with copy at `apps/web/messages/en.json` under `adminBroadcasts`. No consent-state segmentation is applied when selecting recipients.
  - The unsubscribe signing secret is **optional**, so links can be issued unsigned: `apps/api/src/config/configuration.ts:127-130` — `UNSUBSCRIBE_SIGNING_SECRET: z.string().min(16).optional()`.
  - No suppression list, bounce-handling table, or complaint-feedback-loop handling exists in `supabase/migrations/`.

- **Jurisdiction / context**: Canada's Anti-Spam Legislation is the strictest regime in play and the most relevant given the product's Canadian focus — CASL requires express or narrowly-defined implied consent, prescribed sender-identification content, and a functioning unsubscribe mechanism honoured within 10 business days, with penalties up to CAD 10 million and a private right of action. A `default true` column is unlikely to constitute express consent. EU ePrivacy Art. 13 and national implementations require prior consent for marketing email, with a narrow soft-opt-in for existing customers of similar products. UK PECR reg. 22 the same. US CAN-SPAM is opt-out but requires a valid physical postal address in every commercial message — none is published anywhere in the product (see L-07). Gmail/Yahoo bulk-sender rules are a deliverability requirement rather than a legal one, but the one-click header is now effectively mandatory.

- **Engineering controls already implemented**:
  - A real per-user preference table with per-channel granularity exists and is honoured: `supabase/migrations/20260613120000_messaging_p3b_notifications.sql:23-24`; preferences are included in the data export (`apps/api/src/modules/privacy/privacy.service.ts:136`).
  - SMS is correctly modelled as opt-in with the reasoning recorded in the migration: `supabase/migrations/20260702000000_notification_sms_channel.sql:3-5`.
  - An unsubscribe mechanism exists and is localised into all 15 languages: `apps/api/src/i18n/email/messages.ts:27,42,60,78,96,114,133,151` and following.
  - HMAC-signed unsubscribe/reminder links are supported: `apps/api/src/config/configuration.ts:127-130`.
  - A notification template system with activation control exists: `supabase/migrations/20260702010000_notification_templates.sql:13`.
  - The distinction between transactional and marketing mail is at least partially reflected in the template taxonomy, giving a basis to segment.

- **Remaining legal question**: Which messages are transactional (permitted without consent) and which are commercial electronic messages requiring CASL express consent or ePrivacy consent? Does `email_enabled default true` satisfy any applicable consent standard, and if not, must existing users be re-permissioned before the next send? What sender-identification and postal-address content must appear in every commercial message? Must the unsubscribe signing secret be mandatory rather than optional?

- **Counsel decision required**: Classify each outbound message type as transactional or commercial. Specify the consent model required per market, whether an unbundled marketing opt-in must be added at signup, and whether the existing base requires re-permissioning. Approve the mandatory email footer content, including the physical postal address. Confirm the unsubscribe honouring window to be implemented.

---

## L-20 — No non-affiliation statement anywhere; government and official framing throughout

- **Severity**: Medium

- **Issue**: The product uses "official" and "government" framing pervasively, serves government-sourced forms from its own domain, injects a branded assistant into Government of Canada websites, and uses the EU flag as a product token — while never once stating that it is not affiliated with, endorsed by, or acting for any government.

- **Current behavior**:
  - **No non-affiliation statement exists.** Searches across `apps/web/messages/en.json`, all rendered JSX, `apps/web/app/[locale]/terms/page.tsx` and `apps/web/app/[locale]/privacy/page.tsx` for "not affiliated", "not endorsed", "independent", "not a government" return nothing.
  - "Official" framing is used repeatedly and prominently: `apps/web/messages/en.json:247` (*"from the official immigration authority of {country}"*), `:249` (*"Required forms (official):"*), `:250` (*"Supporting documents (official):"*), `:441` (*"Official government forms"*), `:442` (*"Official fill coming soon"*), `:371` (*"Official portal URL (optional)"*).
  - Government-sourced PDFs are served from the visaai.co origin rather than linked to the source: `apps/api/src/modules/prefill/prefill.controller.ts:114-135` (see L-09).
  - The extension injects a branded side panel into Government of Canada domains: `apps/extension/manifest.json:8` — `host_permissions: ["https://*.cic.gc.ca/*", "https://*.canada.ca/*"]`; content scripts on the same matches at `:20-26`; side panel at `:27-29`; product name *"VisaAI Portal Assistant"* at `:4`.
  - The **EU flag is used as the product token for the Schengen bloc**: `apps/web/components/ui/country-flag.tsx:52-55` maps the `schengen` sentinel to `eu`, rendering `apps/web/public/flags/4x3/eu.svg`. Verified served in production: `https://visaai.co/flags/4x3/eu.svg` returns 200.
  - The **UN emblem is also served** from production: `apps/web/public/flags/4x3/un.svg`, verified 200 at `https://visaai.co/flags/4x3/un.svg`.
  - No `/about`, `/contact`, or `/imprint` page exists at which an independence statement could sit (see L-07).

- **Jurisdiction / context**: Canada — the Trade-marks Act s.9(1)(n)(iii) protects official marks adopted by public authorities, and IRCC publishes explicit guidance warning applicants about sites that imply an official connection; the Competition Act s.52 covers false or misleading representations as to affiliation. United Kingdom — Crown and departmental branding restrictions, plus CPUTR Annex 1 which lists as always-unfair "falsely claiming or creating the impression that the trader… has been approved, endorsed or authorised by a public body". EU — UCPD Annex I paras. 2 and 4 (unauthorised use of trust marks; falsely claiming endorsement by a public body). The EU flag ("European emblem") is specifically protected: use requires that it not create confusion with the EU institutions and, per Commission guidance, may require authorisation. The UN emblem is protected under Art. 6ter of the Paris Convention and by UN resolution; its use generally requires UN authorisation. United States — 18 U.S.C. §709 and agency-specific rules on implying federal endorsement; USCIS and the FTC actively pursue websites that imply official status.

- **Engineering controls already implemented**:
  - The extension is honestly named and described: `apps/extension/manifest.json:4-6` — *"Assists with filling government visa portal forms. You always complete payment and submission."*
  - Fill instructions are explicit that VisaAI is not acting for the user: `apps/api/src/modules/automation/fill-instructions.ts:108` — *"VisaAI never submits or pays on your behalf."*
  - The Terms state VisaAI is a software preparation tool and disclaim licensed status, which is adjacent to (though not the same as) a non-affiliation statement: `apps/web/app/[locale]/terms/page.tsx:33-36`.
  - Government fees are consistently and correctly identified as payable to the issuing authority, not to VisaAI: `apps/web/messages/en.json:618`, `:625`.
  - Source provenance is already rendered on the readiness surface, establishing the pattern: `apps/web/messages/en.json:251` (`"Source:"`), rendered at `apps/web/app/[locale]/(dashboard)/readiness/[applicationId]/readiness-client.tsx:399-407`.
  - Flags are marked decorative by default with `alt=""` and `aria-hidden`, so they are not announced as identity claims to assistive technology: `apps/web/components/ui/country-flag.tsx:45-48`.

- **Remaining legal question**: Does the aggregate presentation — "official" language, government-hosted-looking form downloads, a branded panel inside canada.ca, and the EU/UN emblems — create an impression of public-body approval or affiliation? Where must a non-affiliation statement appear, and in what words? Is use of the European emblem as a Schengen token permissible without Commission authorisation, and is the UN emblem asset permissible at all? Does injecting branded UI into Government of Canada sites raise any issue beyond trademark — for example under the portals' own terms of use?

- **Counsel decision required**: Approve the non-affiliation statement text and mandate its placement (footer, form-download surface, extension side panel, and the legal pages). Rule on continued use of the EU emblem for "Schengen" and on the UN emblem asset. Confirm whether the "official" adjective may continue to be used to describe forms and sources, and in what construction.

---

## L-21 — Extension scope is two Canadian domains while the copy promises to fill "your government portal"

- **Severity**: Medium

- **Issue**: The product supports 34 destinations and markets portal auto-fill as a paid feature, but the extension is scoped to two Government of Canada domains. A user on a UK, US, Australian or Schengen application is told the extension will fill their portal; it cannot. One documented install path also asks users to enable Chrome developer mode and sideload.

- **Current behavior**:
  - Scope: `apps/extension/manifest.json:8` and `:22` — `https://*.cic.gc.ca/*` and `https://*.canada.ca/*` only.
  - The copy is destination-agnostic: `apps/web/messages/en.json:369` — *"The VisaAI Chrome extension fills the government portal form for you"*; `:373` — *"Open your government portal in a Chrome tab and sign in, then click below"*; `:371` — *"Official portal URL (optional)"* with the hint at `:372` that *"the extension fills whichever portal tab is active."*
  - `Portal Auto-Fill Assistant` is sold as a plan feature with no destination qualifier: `apps/web/messages/en.json:340`.
  - The product supports 34 destinations per `docs/exec/COORDINATION_LEDGER.md` (CA, US, GB, AU plus the Schengen bloc).
  - **Sideload install path**: `apps/web/messages/en.json:379-382` instructs the user to unzip a downloaded folder, *"Open chrome://extensions in a new tab and turn on Developer mode (top right)"*, and *"Click \"Load unpacked\""*. A Chrome Web Store path also exists at `:387-389`.
  - **No consent or disclaimer screen inside the extension** before it fills: the side panel (`apps/extension/manifest.json:27-29`) presents no acceptance step; the only disclaimer is the manifest description at `:6`, which a user sees only in the Chrome extension listing.
  - The Terms say nothing about the extension or about automated interaction with third-party systems: `apps/web/app/[locale]/terms/page.tsx:29-71`.
  - Government portal terms of use are not addressed anywhere in code or documentation.

- **Jurisdiction / context**: Consumer protection — selling a feature whose stated scope exceeds its actual capability engages UCPD Art. 6, CPUTR/DMCCA, FTC Act s.5, and Competition Act s.52. Contractual and computer-misuse questions arise from automated interaction with government portals: many portals' terms restrict automated access, and jurisdictions differ on whether breaching website terms carries any statutory consequence (the US CFAA position narrowed after *Van Buren*, but Canadian and UK analyses differ). Asking consumers to enable developer mode and sideload is a security-posture question that also bears on the reasonableness of the platform's advice to users.

- **Engineering controls already implemented**:
  - **Minimal permission set** — `apps/extension/manifest.json:7`: `["storage", "sidePanel", "activeTab"]`. No `cookies`, no `webRequest`, no `tabs`, no `scripting`, no `<all_urls>`. `activeTab` limits access to the tab the user explicitly invoked it on.
  - **Narrow `externally_connectable`** so only VisaAI origins can message the extension: `apps/extension/manifest.json:9-15`.
  - Host permissions are scoped to two domains rather than broad wildcards: `:8`.
  - The executor cannot click, submit, navigate, or touch file/password inputs, and a build-failing static invariant enforces it: `apps/extension/src/executor/safety-guards.ts:8,10,21-22`; `apps/api/test/execution-path-invariant.spec.ts:107-126` (see L-05).
  - An accurate scope statement is shown to the user: `apps/web/messages/en.json:385` — *"The extension only reads the government portal tab you open."*
  - An accurate manual-submission alternative is offered when the extension is unavailable: `apps/web/app/[locale]/(dashboard)/submission/[applicationId]/submission-client.tsx:240-247` — *"The Chrome Portal Assistant is an optional convenience… You stay in full control of payment and final submission."*
  - Every field write is audited into the append-only hash chain: `apps/api/src/modules/portal-fill/portal-fill-orchestrator.ts:95-113`.

- **Remaining legal question**: Must the extension's supported-destination scope be disclosed before purchase of any plan that lists Portal Auto-Fill? Does automated form-filling on a government portal require review against that portal's terms of use, and does any target jurisdiction attach consequences to breaching them? Should the sideload instructions be withdrawn in favour of the Web Store path only? Must the extension present its own consent screen before its first fill?

- **Counsel decision required**: Approve destination-scoping language for the auto-fill feature wherever it is marketed. Direct whether government portal terms of use must be reviewed per destination before the extension's scope is expanded. Approve the in-extension consent and disclaimer text, and rule on whether the developer-mode sideload path may remain documented.

---

## L-22 — Legal, safety and disclaimer copy is English-only across 15 locales

- **Severity**: Medium

- **Issue**: The product is offered in 15 languages, including two right-to-left locales, but every legally significant text — the Terms, the Privacy Policy, the signup acknowledgement, the AI disclaimer, and the data-rights controls — is hardcoded English. A Spanish, Arabic or Japanese user is served a localised product wrapped around English-only legal notices.

- **Current behavior**:
  - Locales configured: `apps/web/i18n/config.ts:5-20` — `en, fr, es, de, it, pt, nl, ar, tr, hi, ur, zh, zh-TW, ja, ko`; RTL locales at `:28`.
  - `/privacy` and `/terms` are **not translated** — both pages contain literal English JSX strings and never call `useTranslations`: `apps/web/app/[locale]/privacy/page.tsx:33-79`; `apps/web/app/[locale]/terms/page.tsx:29-71`.
  - Verified in production: `https://visaai.co/es/privacy` returns `<html lang="es" dir="ltr">` with an entirely English body, including the *"Template pending legal review"* line. The same holds for all 14 non-English locales, and both pages are in the sitemap for every locale (`apps/web/app/sitemap.ts:5,31-37`).
  - The signup acknowledgement — the text that carries the "not legal advice, no outcome guaranteed" representation — is hardcoded English: `apps/web/app/[locale]/(auth)/signup/page.tsx:163-167`.
  - The AI disclaimer is hardcoded English: `apps/web/app/[locale]/(dashboard)/narrative/[applicationId]/narrative-client.tsx:146-147`.
  - The auth-screen disclaimer is hardcoded English: `apps/web/components/auth/auth-split-layout.tsx:32`.
  - The entire data-rights UI is hardcoded English: `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:97-142`, including the deletion warning at `:114-115` and the `"Type DELETE to confirm"` instruction at `:118`.
  - The beta safety banner is translated, but is switched off (see L-23).

- **Jurisdiction / context**: GDPR Art. 12(1) requires transparency information in a *concise, transparent, intelligible and easily accessible form, using clear and plain language* — regulators consistently read that as requiring the language in which the service is offered. Consumer-contract language requirements are explicit in several markets: France (Loi Toubon), Poland, Belgium, Quebec (Charter of the French Language, strengthened by Law 96 — French-language contract obligations), Turkey, and others. Where a consumer contract is not supplied in the required language, national law may render terms unenforceable or void. A "Type DELETE to confirm" instruction presented in English to a user who does not read English is also a practical barrier to exercising an Art. 17 right.

- **Engineering controls already implemented**:
  - A complete, single-source-of-truth i18n system exists and works: `apps/web/i18n/config.ts:5-20`, with RTL handling (`:28,56-58`), locale persistence (`:30`), and `Accept-Language` matching (`:61-69`). All 15 message files are present in `apps/web/messages/`.
  - Per-locale canonical URLs and hreflang alternates are correctly emitted: `apps/web/lib/seo/alternates.ts` used at `apps/web/app/[locale]/privacy/page.tsx:16` and `terms/page.tsx:14`; sitemap alternates at `apps/web/app/sitemap.ts:28-35`.
  - Email templates **are** localised into all 15 languages, including unsubscribe copy: `apps/api/src/i18n/email/messages.ts:42,60,78,96,114,133,151` and following — demonstrating the localisation pipeline exists and is used elsewhere.
  - The beta banner copy is translated and ready (`apps/web/messages/en.json` `beta` namespace and its 14 counterparts).

- **Remaining legal question**: In which markets must the Terms and Privacy Policy be provided in the local language for the contract to be enforceable and the notice to be adequate? Does serving an English-only notice at a `lang="es"` URL create additional exposure by implying a localised document exists? Must the signup acknowledgement, the AI disclaimer and the data-rights UI be translated before launch in those markets, and who certifies translation accuracy for legal text?

- **Counsel decision required**: Specify which locales require translated legal documents, and confirm whether machine translation is acceptable or whether certified human translation is required for the Terms, Privacy Policy and disclaimers. Approve the authoritative-language clause. Direct whether untranslated locales must be de-indexed until translations exist.

---

## L-23 — The only "do not rely on this for a real filing" banner is feature-flagged off in production

- **Severity**: Medium

- **Issue**: The strongest and most explicit safety warning in the product — the one that tells users not to rely on it for a real immigration filing — is behind a feature flag that defaults to false and does not render on the live site.

- **Current behavior**:
  - The banner is gated: `apps/web/components/beta/beta-banner.tsx:20` — `const enabled = useFlag('beta_banner_enabled')`, returning `null` at `:23` when off.
  - **The flag defaults to false in both the client fallback and the server registry**: `apps/web/lib/api/feature-flags-client.ts:30` — `beta_banner_enabled: false`; `apps/api/src/modules/feature-flags/flag-registry.ts:91-97` — `defaultValue: false`, described at `:92` as *"Closed-beta banner: \"do not use for a real filing\"."*
  - **Verified absent in production**: fetching `https://visaai.co/` on 2026-08-21 returns no banner text.
  - The component itself is well built and mounted early in reading order: `apps/web/app/[locale]/layout.tsx:137`, with the rationale documented at `apps/web/components/beta/beta-banner.tsx:6-18` — *"the AI-safety review requires the product never to present itself as a licensed professional or as a substitute for one."*
  - Meanwhile the pricing page, which is the highest-intent public page, carries no disclaimer at all (`apps/web/app/[locale]/pricing/page.tsx` — see L-02), and the readiness page carries none either (see L-04).

- **Jurisdiction / context**: This is the mitigation that most directly addresses the L-03 (regulated advice) and L-04 (outcome claims) exposure, so its production state matters to how those items are assessed. Where a disclaimer is relied on as a mitigating control, its actual visibility to users — not its presence in the codebase — is what counts under UCPD Art. 7 (misleading omissions), CPUTR, and FTC "clear and conspicuous" doctrine. If the product is genuinely in closed beta, the banner's absence also affects the accuracy of any representation about the product's maturity.

- **Engineering controls already implemented**:
  - The banner exists, is correctly placed before main content for reading order, and uses `role="status"` rather than `role="alert"` for a message that never changes — a considered accessibility decision documented at `apps/web/components/beta/beta-banner.tsx:14-17`.
  - Its copy is translated into all 15 locales (the `beta` namespace in `apps/web/messages/`), unlike the other disclaimers (see L-22).
  - A complete feature-flag system with a typed registry, client exposure control and kill-switch support exists, so enabling it is a configuration change: `apps/api/src/modules/feature-flags/flag-registry.ts:91-97`; provider at `apps/web/components/providers/feature-flags-provider.tsx`.
  - Other disclaimers do render unconditionally in production — the auth screens (`apps/web/components/auth/auth-split-layout.tsx:32`), the signup checkbox (`apps/web/app/[locale]/(auth)/signup/page.tsx:163-167`), and the narrative surface (`narrative-client.tsx:146-147`).

- **Remaining legal question**: Is a beta or reliance warning required at launch, and if so on which surfaces and in what form? If VisaAI relies on disclaimers as a mitigation for the L-03 and L-04 exposure, does a disclaimer that is off by default in production count as a control at all? Should the banner be replaced by a permanent, non-flagged notice on the pricing and readiness surfaces?

- **Counsel decision required**: Decide whether the closed-beta banner must be enabled in production before or at launch. Approve the permanent disclaimer text and the surfaces it must appear on, and confirm whether any launch-critical disclaimer may remain behind a feature flag.

---

## L-24 — Accessibility: strong automated gate, but English public routes only, and no accessibility statement

- **Severity**: Medium

- **Issue**: The public marketing and legal pages are covered by a genuinely rigorous automated accessibility gate. That coverage does not extend to the authenticated product, to any non-English locale, or to the two right-to-left locales, and no accessibility statement or conformance claim is published.

- **Current behavior**:
  - Automated coverage is real and strict: `apps/web/e2e/design-system.spec.ts:18-26` defines seven public routes (`/`, `/login`, `/signup`, `/forgot-password`, `/pricing`, `/privacy`, `/terms`); `:135-160` runs axe against `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa` in **both light and dark themes**, asserting `expect(results.violations).toEqual([])` with **no rules disabled**.
  - Keyboard focus-visibility is separately tested: `apps/web/e2e/design-system.spec.ts:163-190`.
  - Ten e2e specs use `AxeBuilder` in total across `apps/web/e2e/`.
  - **The coverage gap**: all axe runs target unprefixed (English) routes. No spec exercises `/ar/`, `/ur/`, or any other locale, so RTL mirroring and translated-content layout are untested. The 51 authenticated routes (of 58 total) have partial coverage at best.
  - Two specs do disable a rule, with the reason recorded: `apps/web/e2e/smoke.spec.ts:13` and `apps/web/e2e/country-selector.spec.ts:131` disable `color-contrast`, documented at `smoke.spec.ts:7-10` as systemic token debt.
  - **That token debt appears to have been fixed since**: `--color-midtone-gray` is now `#6b6968` (`apps/web/app/globals.css:53`), which computes to roughly 4.9:1 against the `#f6f3f1` brand background — above the 4.5:1 AA threshold. The `disableRules` calls in those two specs now appear to be stale.
  - **No accessibility statement page exists** — the 58-route inventory contains no `/accessibility` route, and no WCAG conformance claim appears anywhere in `docs/`.

- **Jurisdiction / context**: European Accessibility Act (Directive 2019/882), applicable to consumer-facing e-commerce services in the EU since 28 June 2025, with EN 301 549 / WCAG 2.1 AA as the effective technical benchmark and a requirement to publish accessibility information. UK Equality Act 2010 (service-provider duty to make reasonable adjustments). US ADA Title III as applied to commercial websites, where WCAG 2.1 AA is the de facto litigation benchmark. Canada — Accessible Canada Act for federally regulated entities and Ontario's AODA (WCAG 2.0 AA for large private organisations), with Ontario's compliance-report regime. Several of these regimes expect a published accessibility statement, not merely conformance.

- **Engineering controls already implemented**:
  - The axe gate described above is stronger than most production web apps carry: full WCAG 2.0/2.1/2.2 A+AA tags, zero-violation assertion, dual-theme, on the highest-traffic public routes including both legal pages (`apps/web/e2e/design-system.spec.ts:135-160`).
  - A dedicated keyboard focus-indicator test: `apps/web/e2e/design-system.spec.ts:163-190`.
  - Visual-regression baselines across three viewports guard against layout regressions: `apps/web/e2e/design-system.spec.ts:28-32,63-93`.
  - Considered ARIA decisions rather than blanket role usage: `role="status"` over `role="alert"` with a documented rationale (`apps/web/components/beta/beta-banner.tsx:14-17`); decorative flags carry `alt=""` + `aria-hidden` with an explicit non-decorative escape hatch (`apps/web/components/ui/country-flag.tsx:45-48`); `role="alert"` on error output (`apps/web/app/[locale]/(dashboard)/prefill/[applicationId]/prefill-client.tsx:371`); labelled confirmation input (`apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:117-125`).
  - RTL is handled structurally rather than as an afterthought: `apps/web/i18n/config.ts:28,56-58` drive `<html dir>` and layout mirroring.
  - Contrast tokens were remediated at the design-system level: `apps/web/app/globals.css:53`.

- **Remaining legal question**: Which conformance standard and level must VisaAI meet in each market (EN 301 549 / WCAG 2.1 AA for the EAA; WCAG 2.0 AA for AODA; the practical WCAG 2.1 AA benchmark for ADA)? Is a published accessibility statement mandatory under the EAA for this service, and what must it contain? Does the automated-only, English-only testing posture meet the standard of a reasonable effort, or is manual assistive-technology testing required? Does the authenticated product fall within scope, given it is the service the consumer actually purchased?

- **Counsel decision required**: Set the target conformance standard and level per market, and the date by which it must be met. Approve the accessibility statement content and confirm whether a dedicated page is required. Direct whether manual screen-reader testing and non-English/RTL coverage must precede EU launch.

---

## L-25 — Government-source ingestion conduct

- **Severity**: Informational

- **Issue**: The crawler that keeps visa requirements and official forms current is well behaved by design, with two conduct details counsel may wish to be aware of: a host-specific user-agent override, and a measured rate-limit incident against a European Commission host.

- **Current behavior**:
  - Fetching is restricted to an explicit allowlist of government and reference hosts: `apps/api/src/modules/forms/http.ts:20-34`.
  - `robots.txt` is fetched, parsed, cached and honoured before any document fetch: `apps/api/src/modules/forms/robots.ts:17-84` (`parseRobots`, `isPathAllowed`, `RobotsGate`), enforced at `apps/api/src/modules/forms/form-refresh.service.ts:328` against the *resolved* PDF URL rather than the landing page (`:293-300`).
  - The default user agent identifies the bot and provides a contact: `apps/api/src/modules/forms/http.ts:52-58` — `VisaAIBot/1.0 (+https://visaai.co/bot; support@visaai.co)`.
  - A **host-specific user-agent override** exists to work around an anti-bot layer on at least one government host, replacing the identifying UA with a browser string for that host.
  - A **measured 429 incident against `ec.europa.eu`** is recorded in the project's own notes (see the template-cache work referenced in `docs/`), where shared pages returned HTTP 429 under sweep load. No `Retry-After` parsing or exponential backoff is implemented in `apps/api/src/modules/forms/http.ts`; per-host throttling and bounded sweep concurrency are the only controls.
  - The bot contact URL advertised in the UA, `https://visaai.co/bot`, does not correspond to any route in the 58-page inventory.

- **Jurisdiction / context**: Website terms of use and, in some jurisdictions, computer-misuse statutes govern automated access; the analysis varies materially between the US (narrowed after *Van Buren*), the UK (Computer Misuse Act 1990) and Canada (Criminal Code s.342.1). Circumventing an anti-bot control by misrepresenting the user agent is the fact most likely to matter to that analysis. Sustained load causing 429s from a public-sector host is separately a conduct and relationship question. Reuse of the fetched content is covered at L-09.

- **Engineering controls already implemented**:
  - Host allowlist, HTTPS-only, redirect re-validation and private-IP blocking (SSRF hardening): `apps/api/src/modules/forms/http.ts:20-49`.
  - `robots.txt` compliance implemented and enforced, not merely intended: `apps/api/src/modules/forms/robots.ts:17-84`; `apps/api/src/modules/forms/form-refresh.service.ts:328`.
  - Identifying, contactable user agent as the default: `apps/api/src/modules/forms/http.ts:52-58`.
  - Per-host rate limiting and bounded sweep concurrency: `apps/api/src/modules/forms/http.ts`; `apps/api/src/modules/forms/sweep/sweep.service.ts`.
  - Conditional revalidation rather than unconditional re-download, with `unchanged` modelled as a distinct outcome: `apps/api/src/modules/forms/form-refresh.service.ts:18,136`.
  - Content integrity and check-time recorded per fetch: `sha256`, `fetched_at` and `last_checked_at` at `supabase/migrations/20260811120000_form_templates.sql:66,74-75`; robots refusals persisted as a `blocked` status at `:83`.

- **Remaining legal question**: Does overriding the identifying user agent to pass an anti-bot control on a government host create exposure under any target jurisdiction's computer-misuse or terms-of-use regime? Should the crawler honour `Retry-After` and back off as a matter of policy rather than engineering preference? Should `https://visaai.co/bot` be published so the advertised contact resolves?

- **Counsel decision required**: Rule on whether the host-specific user-agent override may remain. Confirm whether government portal and publication terms of use must be reviewed per source before ingestion continues, and approve the bot-information page content if one is to be published.

---

## L-26 — Payments: no sanctions screening, no billing-country capture on the main checkouts, tax not configured

- **Severity**: Informational

- **Issue**: Recorded for completeness alongside L-10. The payment stack delegates heavily to Stripe, which absorbs much of the compliance burden, but three gaps are visible in the code.

- **Current behavior**:
  - **No sanctions or embargo screening** exists in the codebase — searches across `apps/api/src` for OFAC, sanctions, embargo, or denied-party screening return nothing. Given the product's subject matter, users will routinely be nationals of, or located in, sanctioned jurisdictions.
  - **Billing country is not captured or reconciled** against the user's locale or claimed nationality on the highest-volume checkout paths; the 402 handler redirects straight to Stripe Checkout (`apps/web/lib/payment-error.ts:16-30`).
  - **Stripe Tax is not enabled**: `automatic_tax` does not appear in `.env.example` or in the checkout session construction in `apps/api/src/modules/billing/billing.service.ts`. No VAT/GST registration configuration exists.
  - Prices are defined in a single currency set at `packages/types/src/index.ts:32-36` and `apps/api/src/modules/billing/billing.service.ts:32-35`.
  - `nationality` is collected on the user profile (`apps/web/messages/en.json:400`), so a signal that could inform screening exists but is unused for that purpose.

- **Jurisdiction / context**: US OFAC sanctions programmes apply extraterritorially to US-person and US-dollar transactions; EU and UK sanctions regimes apply to persons within their jurisdictions. Payment processors run their own screening, but that does not by itself discharge a merchant's obligations. EU/UK VAT on electronically supplied services to consumers is due in the consumer's member state, requiring OSS registration and two pieces of non-contradictory location evidence. Canadian GST/HST and provincial sales taxes have their own registration thresholds for non-resident digital suppliers.

- **Engineering controls already implemented**:
  - Payments run through Stripe Checkout and Stripe Connect rather than a bespoke flow, so card data never touches VisaAI systems and PCI scope is minimised: `apps/api/src/modules/billing/billing.service.ts`; consultant payouts via Connect.
  - Stripe performs its own sanctions and KYC screening on both payers and connected accounts as a matter of course.
  - Webhook signature validation and entitlement state are handled server-side; entitlement checks return a clean 402 rather than degrading silently: `apps/api/src/modules/prefill/prefill.controller.ts`.
  - Payments and subscriptions are included in the data-subject export: `apps/api/src/modules/privacy/privacy.service.ts:105,135`.
  - Internal pricing margin/COGS columns were hardened against anonymous read: `supabase/migrations/20260816120000_sec_rls_column_hardening.sql:6`.

- **Remaining legal question**: Does VisaAI need its own sanctions screening in addition to Stripe's, given the customer base? Are there jurisdictions into which the service must not be sold at all? What VAT/GST registrations are required before selling into EU, UK and Canadian consumer markets, and must Stripe Tax be enabled before launch? What location evidence must be captured and retained?

- **Counsel decision required**: Determine whether independent sanctions screening and geo-restriction are required, and identify any excluded jurisdictions. Confirm the tax registrations required and whether launch may proceed before Stripe Tax is configured.

---

## L-27 — Third-party asset licensing: the vendored `flag-icons` MIT notice is not shipped

- **Severity**: Informational

- **Issue**: Country flag SVGs are vendored into the public asset directory and served from production. The upstream package is MIT-licensed, which requires the copyright and permission notice to be included in copies or substantial portions of the software. No licence file accompanies the vendored assets and no attribution surface exists in the app.

- **Current behavior**:
  - Assets are vendored at `apps/web/public/flags/4x3/` and served publicly — verified 200 in production for `https://visaai.co/flags/4x3/eu.svg` and `.../un.svg`.
  - The upstream package `flag-icons` is MIT-licensed (`apps/web/node_modules/flag-icons/package.json`, `"license": "MIT"`).
  - No `LICENSE`, `NOTICE`, or attribution file exists under `apps/web/public/flags/`, and no attribution or open-source-notices page exists among the 58 routes.
  - The EU and UN emblem assets within that set raise a separate question addressed at L-20.

- **Jurisdiction / context**: MIT licence attribution is a contractual/copyright condition in every jurisdiction where the assets are distributed. Serving the files from a public origin is distribution. This is low-severity and cheaply remedied, but it is the kind of item that surfaces in due diligence or an acquirer's open-source audit.

- **Engineering controls already implemented**:
  - Flags are rendered through a single component rather than being referenced ad hoc, so an attribution change has one touch point: `apps/web/components/ui/country-flag.tsx`.
  - The dependency is declared in `apps/web/package.json` rather than being an anonymous copied asset, so provenance is traceable.
  - A reachability-based dependency-vulnerability gate runs in CI: `scripts/check-vulnerable-deps.mjs`, described in `docs/security/SECURITY_REMAINING_RISKS.md`.

- **Remaining legal question**: Does serving the vendored SVGs from visaai.co constitute distribution requiring the MIT notice to accompany them, and where should that notice live — a `NOTICE` file beside the assets, an open-source-notices page, or both? Is a broader open-source attribution review warranted before any financing or acquisition diligence?

- **Counsel decision required**: Confirm the required form and placement of the open-source attribution notice, and whether a full third-party licence inventory should be produced.

---

# Appendix A — Cross-cutting engineering controls that already exist

Recorded so counsel can see what the platform can already evidence. Each was located in code; none is offered as proof of compliance with anything.

| Control | Where | What it actually does |
|---|---|---|
| Production residency boot guard | `apps/api/src/config/configuration.ts:356-372` | API refuses to start unless data residency is pinned and OCR runs on a regional managed provider |
| Fail-closed egress gate | `apps/api/src/config/configuration.ts:100-110`; `apps/api/src/modules/documents/graphs/nodes/derive-fields.ts:84` | Secondary extraction that would ship document text out of region is off by default under any pinning mode |
| Submission impossibility, statically enforced | `apps/extension/src/executor/safety-guards.ts:8,10,21-22`; `apps/api/test/execution-path-invariant.spec.ts:107-126` | Build fails if the executor ever gains click/submit/navigate; server has no submit path |
| Minimal extension permissions | `apps/extension/manifest.json:7-15` | `storage`, `sidePanel`, `activeTab` only; two host domains; `externally_connectable` limited to VisaAI origins |
| Append-only hash-chained audit | `supabase/migrations/20260606000004_audit_events.sql:5-8`; `apps/api/src/modules/portal-fill/portal-fill-orchestrator.ts:95-113` | Every portal field write recorded as a value hash, not raw PII; trail cannot be rewritten |
| Erasure that survives append-only audit | `supabase/migrations/20260813140000_append_only_cascade_fix.sql:1-70` | A production-blocking Art. 17 failure was found and fixed; audit rows anonymise rather than block deletion |
| Recursive storage purge | `apps/api/src/modules/privacy/privacy.service.ts:200-235` | Depth-first purge of the user's object tree, hardened after identity documents in messaging were found surviving erasure |
| Self-service export and erasure | `apps/api/src/modules/privacy/privacy.controller.ts:35-52`; `apps/web/app/[locale]/(dashboard)/profile/privacy-section.tsx:33-150` | Working DSAR endpoints, reachable in web and mobile, server-enforced confirmation |
| Privacy-request audit log | `apps/api/src/modules/privacy/privacy.service.ts:196`; `supabase/migrations/20260805010000_privacy_requests.sql:13` | Every export and erasure recorded with status and outcome |
| Analytics retention job | `apps/api/src/modules/analytics/retention/analytics-retention.scheduler.ts:18-27` and service/processor | Real scheduled 90-day prune of raw events — the reference pattern for case-data retention |
| No third-party trackers | `apps/web/package.json`; rendered scripts | No GA/GTM, PostHog, Segment, Mixpanel, Hotjar, Clarity, FullStory or Sentry loaded in the browser |
| No-PII analytics property policy | `apps/web/lib/analytics/client.ts:6-8` | Event props restricted to ids, enums and paths by documented policy |
| Row-level security throughout | `supabase/migrations/20260531000000_initial_schema.sql:43,54-57,88`; `20260806100000_security_audit_db_hardening.sql`; `20260816120000_sec_rls_column_hardening.sql` | Owner-scoped access resolved through the parent application, plus a dedicated hardening pass |
| Consultant field-tampering block | `supabase/migrations/20260816120000_sec_rls_column_hardening.sql:47-56` | DB trigger prevents self-modification of verification, payout and rating columns |
| Anti-fabrication prompt constraints | `apps/api/src/modules/narrative/graphs/nodes/draft-document.ts:14,16,18`; `apps/api/src/modules/visa/visa.agents.ts:62-71` | Every generative path is instructed not to invent facts |
| Server-side anti-certainty clamp | `apps/api/src/modules/visa/visa.agents.ts:111-121,156-160` | Success probability clamped to 1–99 regardless of model output |
| Deterministic, explainable VRI | `apps/api/src/modules/vri/risk-config.types.ts:54-61`; `apps/api/src/modules/vri/graphs/nodes/aggregate-score.ts:15-40` | The headline score is rule-based with published weights — the logic can be disclosed |
| Human approval gate on AI drafts | `apps/api/src/modules/narrative/narrative.service.ts:98-125` | Drafts require explicit user review and approval before they are final |
| Voice privacy-by-design | `supabase/migrations/20260805050000_voice_assistant.sql:1-28` | Raw audio never persisted; text only; per-kind, per-version, revocable consent |
| Blocking non-advice acknowledgement | `apps/web/app/[locale]/(auth)/signup/page.tsx:163-170` | Unbundled, unchecked-by-default, submit-blocking acknowledgement on the standalone signup page |
| Crawler conduct | `apps/api/src/modules/forms/robots.ts:17-84`; `apps/api/src/modules/forms/http.ts:20-58` | robots.txt honoured, host allowlist, SSRF hardening, identifying contactable user agent |
| Accessibility gate on public routes | `apps/web/e2e/design-system.spec.ts:135-160` | Zero-violation axe assertion across WCAG 2.0/2.1/2.2 A+AA, light and dark, including `/privacy` and `/terms` |
| Honest correction precedent | `apps/web/app/[locale]/privacy/page.tsx:59-66` | A false backup claim was deleted rather than reworded when production evidence contradicted it |
| No fabricated trust signals | `apps/web/lib/seo/structured-data.ts:1-12` | No aggregate ratings, reviews, user counts or testimonials anywhere in the product |
| Documented security programme | `docs/security/THREAT_MODEL.md`, `SECURITY_ARCHITECTURE.md`, `SECURITY_OPERATIONS_RUNBOOK.md`, `SECURITY_REMAINING_RISKS.md` | Threat model, architecture, runbook and an honest open-risk register |

# Appendix B — Controls counsel may expect that do not exist

Searched for and **not found** anywhere in the repository. Listed so no reviewer credits a control that is absent.

| Absent control | Consequence | Related issue |
|---|---|---|
| Cookie/consent banner or consent manager | No lawful basis mechanism for terminal-equipment storage | L-06 |
| Terms/privacy acceptance record (version + timestamp) | Cannot prove which version any user agreed to | L-08, L-18 |
| Licence-verification pipeline against any regulator register | "Licensed consultant" claim is unevidenced | L-02 |
| Consultant agreement or acceptance flow | No contract governs marketplace professionals | L-17 |
| DPIA, ROPA/Art. 30 record, sub-processor list, DPA/SCC templates | No accountability documentation for Art. 9/10 processing | L-11 |
| Breach-response and regulator-notification runbook | No Art. 33/34 or PIPEDA procedure | L-11 |
| Retention schedule or TTL for any case data | Passports, statements, messages retained indefinitely | L-15 |
| Scheduled invocation of `cleanup_stale_anonymous_users` | Abandoned guest data accumulates without limit | L-08, L-15 |
| Document or field-level encryption | `documents.encrypted = true` is unbacked | L-13 |
| AI provenance in the data model | AI-generated documents carry no machine-readable marker | L-16 |
| Consumer refund path in code | Terms promise refunds "described at checkout"; nothing is | L-10 |
| Withdrawal-right notice or Art. 16(m) waiver | No cooling-off handling for EU/UK consumers | L-10 |
| `List-Unsubscribe` / `List-Unsubscribe-Post` headers | One-click unsubscribe absent | L-19 |
| Suppression / bounce / complaint-feedback handling | No record of who must not be emailed | L-19 |
| Support, contact, imprint or DSAR-intake route | The only advertised privacy contact does not exist | L-07 |
| Non-affiliation statement | No disclaimer of government connection anywhere | L-20 |
| Accessibility statement | No published conformance information | L-24 |
| Age gate or minimum-age representation | Product handles dependants and minors' data | L-08, L-11 |
| Licence/attribution metadata on cached government forms | No Crown copyright or OGL handling | L-09 |
| Sanctions or denied-party screening | Relies entirely on Stripe | L-26 |
| Translated legal documents | All 15 locales served English-only legal text | L-22 |

# Appendix C — Counsel decision register

Consolidated so each decision has one owner and one place to be recorded. Nothing in this register is a determination; each row is a question awaiting one.

| # | Decision | Blocks | Issues |
|---|---|---|---|
| D-01 | Approve final Terms of Service and Privacy Policy text; decide whether the pages may remain indexed meanwhile | Public launch | L-01, L-18 |
| D-02 | Rule on "licensed consultant" representations pending a verification pipeline; approve replacement wording | Pricing page live copy | L-02 |
| D-03 | Per-market determination on regulated immigration advice — which surfaces may operate, on what basis | CA/UK/AU/US launch | L-03 |
| D-04 | Approve or reject each outcome/likelihood string; mandate readiness-surface disclaimer | Readiness feature | L-04 |
| D-05 | Direct removal of "auto-submit" copy; confirm submission is a permanent product constraint | Prefill paywall copy | L-05 |
| D-06 | Specify the consent architecture for terminal-equipment storage per market | EU/EEA + UK launch | L-06 |
| D-07 | Name controller entity, address, DPO and Art. 27 representatives; approve DSAR intake channel | All markets | L-07 |
| D-08 | Approve pre-collection notice for the guest funnel; direct terms acceptance recording; rule on age gate | Guest funnel | L-08 |
| D-09 | Rule per source government on cache-and-serve and on paywalling official forms; approve attribution notice | Form downloads | L-09 |
| D-10 | Approve pre-contract disclosures, withdrawal mechanism and refund policy | EU/UK consumer sales | L-10 |
| D-11 | Direct DPIA; approve Art. 30 record, lawful-basis mapping, sub-processor list and DPAs; rule on criminal-history intake | EU/UK launch | L-11 |
| D-12 | Identify and execute transfer mechanisms; approve corrected residency statement | EU/UK/Quebec launch | L-12 |
| D-13 | Approve corrected encryption representation; direct fate of the `encrypted` column | Next DSAR export | L-13 |
| D-14 | Approve definitive export contents and post-erasure retention disclosure | DSAR handling | L-14 |
| D-15 | Provide the retention schedule per data category with legal basis | Retention implementation | L-15 |
| D-16 | Determine Art. 22 and EU AI Act classification; approve AI-disclosure text and placement | AI surfaces | L-16 |
| D-17 | Approve the consultant agreement and required tax-form collection | Marketplace payouts | L-17 |
| D-18 | Deliver complete Terms including governing law, forum, liability and subscription terms | Public launch | L-18 |
| D-19 | Classify transactional vs commercial messages; rule on re-permissioning the existing base | Email sending | L-19 |
| D-20 | Approve non-affiliation statement; rule on EU and UN emblem use | All public surfaces | L-20 |
| D-21 | Approve destination-scoping language and in-extension consent; rule on sideload path | Extension marketing | L-21 |
| D-22 | Specify locales requiring translated legal documents and the translation standard | Non-English launch | L-22 |
| D-23 | Decide whether the beta/reliance banner must be enabled in production | Launch | L-23 |
| D-24 | Set conformance standard per market; approve accessibility statement | EU launch | L-24 |
| D-25 | Rule on the crawler's host-specific user-agent override | Source ingestion | L-25 |
| D-26 | Determine sanctions-screening and tax-registration requirements | Payments | L-26 |
| D-27 | Confirm open-source attribution requirements | Asset serving | L-27 |

---

## Maintenance

This register reflects the repository and production site as at **2026-08-21**. It should be re-run against the code before any launch decision, since several items describe defaults and feature flags whose production state can change without a code change — specifically `beta_banner_enabled` (L-23), `NEXT_PUBLIC_ANALYTICS_ENABLED` (L-06), `DATA_RESIDENCY_MODE` and `OCR_PROVIDER` (L-12), and the unscheduled `cleanup_stale_anonymous_users` job (L-08, L-15).

Per spec §29, no statement in this document asserts that engineering has prevented legal action or achieved legal compliance. Every legal conclusion required by the issues above remains open and belongs to qualified counsel.
