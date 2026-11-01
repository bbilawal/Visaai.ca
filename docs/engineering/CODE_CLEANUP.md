# Code cleanup

## What was removed

**Deliberately little.** The spec's rule 24 is "remove code only after proving
it is obsolete", and this branch's remit was additive: a new data model, a new
routing layer, a new sync engine, new public pages. Deleting code in the same
change would have made every regression ambiguous.

| Removed | Where | Proof it was obsolete |
|---|---|---|
| `MODEL_MINI` / `MODEL_REASON` constants | `visa/visa.agents.ts` | replaced by registry lookups; grep shows no other reader |
| `const model = 'gpt-4o'` | `shared/ai/ai.service.ts:61` | replaced by `resolveModel(tier)` |
| Per-node `new ChatOpenAI({...})` blocks | 6 LangGraph files | replaced by `chatModelForTask`; `ChatOpenAI` import removed from each, typecheck clean |
| Duplicated `SITE_URL` | `app/robots.ts`, `app/sitemap.ts` | had **different fallbacks** (`https://visaai.co` vs `http://localhost:3000`), so with the env var unset the two files disagreed about what site this is |
| Duplicated plan price literals | `web/lib/plan-error.ts` | had **drifted**: quoted $100 where billing charged $250 |
| `visa_sources_url_idx` | migration `20260820160000` | encoded a false assumption; replaced by a per-visa-type index |

## Duplication collapsed

**Plan prices.** Two independent literal sets in two packages, drifted. Now one
`PLAN_PRICE_CENTS` in `@visaai/types`, both apps derive. Cents because that is
what Stripe charges in — deriving display from the charged amount is the only
ordering that cannot drift again.

**Model identifiers.** 12 files with string literals → one `model-policy.ts`.

**The publishable-page predicate.** Would have been re-implemented in the
sitemap, the renderer and the data-quality report. It is one SQL view all three
read.

## Debt found and NOT fixed on this branch

Recorded rather than silently carried. Each was verified in the code.

**`framework_id` is never populated.** `intake.service.ts` creates applications
without it, so the tested deterministic branch-rule engine in
`update-checklist.ts` has never run in production and every requirements
decision falls to an LLM. Fixing it changes what applicants are asked, so it
needs its own change and its own tests.

**Country/visa knowledge lives in five incompatible places**: TypeScript
strategies, a one-row `country_frameworks`, model weights inside prompts,
scraped portals, and now the `visa_*` registry — which currently has **no
production readers**. Consolidation is staged deliberately; breaking the live
readers for a schema improvement would take the product down.

**The intake prompt and the validator disagree about supported countries.**
`ask-question.ts` names JP/KR/SG/CN/IN/BR that `intake.service.ts` rejects, so
the chat interviews for visas the product cannot create.

**Plan gating parses English error prose with a regex** (`plan-error.ts`).
Rewording a NestJS exception silently breaks it. The claims test now at least
pins the price strings.

**~289 service-role references across 89 files** vs 19 files using the
per-request scoped client. RLS is not the primary enforcement layer it is
documented to be.

**Single-instance-only realtime**: four in-process RxJS buses, in-memory
presence and throttling, no separate worker entry point. Scaling to two
instances silently breaks SSE and would double-run the sync.

**Three unrelated "readiness" notions** — VRI, `documentsCompletion()`,
`preflight.complete()` — none of which reads the others.

## Dependencies

None removed. `postmark` remains an unused dependency (0 source references,
email actually sends over SMTP) — flagged in `CLAUDE.md` as ARCH-002 and left
for a dedicated dependency pass, since removing it is unrelated to this work.

## Verification

Full API suite (2,916) and web suite (352) green after every removal; `tsc
--noEmit` clean in both packages.
