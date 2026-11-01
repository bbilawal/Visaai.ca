# Master execution status — §84 checklist

Spec: `VisaAI_Claude_Master_Execution_Spec.md` (Part XVI, §84).
Last updated **2026-08-24** (overnight run of 2026-08-23). Companion to
`COORDINATION_LEDGER.md`, which holds the baseline and the agent assignments.

## How to read the Evidence column

Every row is one of three things, and the difference matters more than the tick:

- **verified 2026-08-23** — re-checked in this session, command and result named.
- **carried** — the evidence is in the linked document, written when the work was
  done, and was **not** re-run today. A carried tick is a claim about the past.
- **blocked** — the work cannot be done here, with the reason and what would
  unblock it.

Nothing is ticked on the strength of a document existing. `docs/ai/AI_EVALS.md`
describes a harness that has never had a funded key pointed at it, and that row
says so.

## Measured state, 2026-08-24

| | Spec baseline (2026-08-20) | Previous (2026-08-23) | Now | How |
|---|---|---|---|---|
| Destinations in the registry | 4 | 10 | **13** | `visa_countries` |
| Visa types | 32 | 64 | **79** | `visa_types` |
| Published pages (registry-backed) | 0 | 48 | **63** | `visa_publishable_pages` |
| Active sourced requirements | 0 | 846 | **1,149** | `visa_requirements where status='active'` |
| Active official sources | 134 | 197 | **235** | `visa_sources where active` |
| Source versions | — | 130 | **185** | `visa_source_versions` |
| Extraction files | 0 | 55 | **70** | `data/requirements/` |
| Migrations | 108 | 241 | **289** | `ls supabase/migrations` |
| API tests | 2,822 | 3,024 | **3,051** | `pnpm --filter api test` |
| Web unit tests | 321 | 406 | **415** | `pnpm --filter web test:unit` |
| Locales | 15 | 16 | **16** | `apps/web/messages/` |
| Production sitemap URLs | 90 | 930 | **1,200** | `curl https://visaai.co/sitemap.xml` |
| Production published pages | 0 | 43 | **58** | `visa_publishable_pages` on `selfhosted_db` |
| Production active requirements | 0 | 720 | **1,023** | same |

**Three destinations were added: Singapore (11th), Malaysia (12th) and Hong Kong
SAR (13th).** Thirteen routes, 267 requirements, 36 sources, every excerpt
verified verbatim against the live authority pages by
`scripts/verify-excerpts.ts`, and Hong Kong's two additionally bound-checked. All
three deployed to production the same night — see *Production deployment,
2026-08-24* below.

## Production deployment, 2026-08-24

**Singapore, Malaysia and Hong Kong are live on `visaai.co`.** Production
carries **13 destinations, 79 visa types, 1,023 active requirements and 58
published pages**, with **zero** active requirements lacking provenance and
**every one of them able to quote its authority**. Sitemap: 930 → **1,200**
URLs. All 58 detail pages and all 13 country hubs return 200, swept after each
deploy.

**The third sweep caught a 502 on every page**, and that is the reason to sweep.
`next build` deletes and rewrites `.next`, and the deploy restarted pm2 while it
was mid-write; `next start` found no `prerender-manifest.json`, crashed, and pm2
crash-looped it 282 times. Fixed by confirming `prerender-manifest.json` existed
before restarting. Recorded in
`docs/operations/VISA_REGISTRY_PRODUCTION_CUTOVER.md` — a spot-check of two
pages would have found it too, but only because it was total; a partial failure
would not have shown up.

The order was the one the cutover runbook's "phase 3 splits in two" lesson
generalises to, because requirement migrations need source versions that only a
sync can create:

1. **Probe from the VPS first.** All 31 Singapore source URLs re-fetched from
   the VPS with the monitor's own User-Agent: 31 × HTTP 200, byte counts within
   a percent of the local reads. This is the check Finland failed, and skipping
   it is how a destination gets registered that production can never sync.
2. **8 registration migrations** piped into `selfhosted_db` as `supabase_admin`.
3. **The source monitor run ON the VPS**, not from a laptop — 228 sources
   checked, 149 ok, 0 changed, 74 blocked (the known AU/US WAFs), 4 unavailable,
   1 parse error. This is what created the 31 Singapore source versions, from
   the egress IP that will re-fetch them every morning.
4. **8 requirement + 8 promotion migrations** in timestamp order. Every
   promotion asserts its own claims before committing; all 16 committed.
5. **Web rebuilt on the VPS** (`.next/cache` cleared first) and restarted under
   pm2.

Verified by request after each deploy — the figures above are the final state
after all three. `/visas/singapore/employment-pass` renders its requirements,
cites all four `mom.gov.sg` source URLs, quotes the authority verbatim, and has
no `noindex`.

### The monitor raised eight changes, and they were one edit

Malaysia's production sync reported `changed: 8, changesRaisedForReview: 8` —
the first non-zero change count this registry has seen on production. Every one
was `immigration.govt.nz`, every one "N lines added, 0 removed", every one
escalated as **material** for "obligation wording changed", "a duration or
deadline changed" or "fee wording changed".

**No requirement had changed.** INZ had added a service banner and navigation to
every page: *"planned upgrade ... from 08:00 to 21:00 sunday 23 august (nzst)"*
and *"call 0508 558 855 (toll free from nz landlines)"*. "sunday 23 august"
trips the duration marker; "toll free" trips the fee marker. All **88** New
Zealand excerpts re-verified verbatim against the live pages afterwards.

The classifier was not wrong to escalate — it compares one page against its own
previous version, where a banner and a new obligation are indistinguishable, and
a false 'cosmetic' would ship a stale requirement to every applicant. But the
RUN can see what the page cannot: a line added to several sources at once is
chrome by construction. `detectSiteWideChanges` now annotates those records, and
deliberately does **not** clear the review — a genuine site-wide policy change
has exactly the same shape.

### And the next run found a deadlock the first one had created

The sync after Hong Kong reported `parseErrors` **1 → 9**. Eight of the nine were
the same `immigration.govt.nz` sources that had raised the service-banner change
two runs earlier — and every one of them had parsed perfectly.

A material change inserts a version **without** activating it; the previous one
keeps serving until a human reviews it, which is the whole point of the
promotion queue. The next version number was computed as
`active.version_number + 1`. So a source with a pending review has version 2
sitting inactive above active version 1, the next content change computes
1 + 1 = 2, and it collides on `visa_source_versions_seq_idx`.

**Permanently.** Every later run fails identically, so a source silently stops
being versioned from the moment it was flagged as changing — the moment
monitoring matters most. Confirmed against production:
`immigration.govt.nz/visit/` had version 1 active (21 Aug) and version 2
inactive (23 Aug), with a live page that was a third state and could never be
recorded.

Fixed (B-23) by numbering from `max(version_number)`, plus a guard against the
bug that fix would otherwise introduce — while a review is pending the active
hash never matches the live page, so "differs from active, therefore new" would
file the same change every night. The API was rebuilt and restarted on the VPS,
because it runs the scheduled job.

**The parse-error count was the only thing that showed it.** Both changes on
those sources were correctly filed, both syncs reported success overall, and the
one number that moved was a bucket the run summary prints and nobody reads
closely. Worth saying plainly: the site-wide-banner annotation shipped hours
earlier made the review queue legible, and it still would not have surfaced
this — the queue was fine, the versioning underneath it was not.

### Both sync fixes confirmed on production

The run after the dependant route reported `ok 155, changed 0, parseErrors 1`.

* **`parseErrors` back to its baseline of 1** — the ESTA page, which normalizes
  to no text and always has. The B-23 deadlock stays fixed: the eight New Zealand
  sources version normally again.
* **`changed: 0`, with those eight reviews still pending.** That is the B-23
  duplicate-filing guard working. Their live content still differs from their
  ACTIVE version, so the old code would have filed the same eight changes again,
  and again every night until somebody reviewed them. The service now recognises
  content it has already queued.

One run filed eight; the next filed none; nothing was reviewed in between. That
is the behaviour the guard was written for, observed rather than asserted.

### The one gap that remains, and why

**Production carries 58 published pages against 63 locally. The five missing are
Finland's, and they are deliberate.**
migri.fi sits behind a Cloudflare managed challenge that 403s the VPS's
datacentre IP, including on `/robots.txt`, while serving the real (permissive)
file to an ordinary client. No requirement could be fetched from production, so
none was created there. Inserting versions fetched from a developer machine was
refused: it would launder a read the daily monitor can never repeat, leaving
provenance decorative and the rows unmaintainable. Finland's hub page publishes
normally; its detail pages render `noindex, follow` and are absent from the
sitemap. See `docs/visa-data/COUNTRY_EXPANSION_RESEARCH.md`.

Singapore is the counter-example that makes Finland's refusal legible rather
than precious: when the VPS *can* read the authority, the route ships the same
night. The gap is about what production can verify, not about caution.

### And building the missing artifact found four wrong countries

Item 66 — reproducible exports — was one of the six never transcribed. Building
it exposed **B-25**: Benin, Burkina Faso, France and Serbia were in the registry,
and on production, under ISO codes that no longer exist (Dahomey, Upper Volta,
France Metropolitan, Yugoslavia).

`Intl.DisplayNames` answers for formerly-used codes exactly as confidently as
for current ones, and each dead code sorts after the live one, so it overwrote
it. **The generator's own verification could not catch it**: it round-trips
every code back through ICU and compares the name, and `DY` → "Benin"
round-trips perfectly. Wrong code, right name — the class of error a
self-consistency check cannot see, because the check and the bug shared an
assumption. I wrote that round-trip so the codes would be "established, not
guessed", and it established four wrong ones.

Two lessons, and the second is the general one:

1. A checklist that omits the items you have not done will always report that
   you are finished.
2. **A check built from the same assumption as the thing it checks will confirm
   it.** What caught this was a different question asked of the same data — "does
   any name resolve to more than one code?" — not a more careful version of the
   same one.

### The same lesson found a second defect, in what users read

B-25 said: a check built from the same assumption as the thing it checks will
confirm it. So I pointed that at the quotations now shown to applicants.

Every check on them compared our text against our own text.
`verify-excerpts.ts` re-fetches the page and normalizes it with the SAME
function that produced the excerpt; the display test compares the display
excerpt to the matching one. Both would agree with a mistake made once.

Reading the raw HTML a different way — tags stripped, entities deleted, nothing
else, no code shared with the normalizer — found **B-26**: three published
Hong Kong quotations contained `fianc&eacute;/fianc&eacute;e`. Literal markup,
inside quotation marks, attributed to a government. `&eacute;` was simply
missing from the entity table.

Fixed: `decodeEntities` gains the Latin-1 letters, `EXTRACTOR_VERSION` goes
v1 → v2 because affected pages now normalize differently, and both databases are
corrected. **Verified live** — the page reads "fiancé/fiancée" and contains zero
`eacute`.

Two guards, and the difference between them matters:

* A **shape check** over the whole corpus: no stored excerpt may contain an
  entity reference, whichever entity it is. It failed on the live data before
  the fix and passes after.
* `scripts/verify-quotes-against-raw.ts`, checked in, because the one-off probe
  is what found this and a one-off finds nothing next time.

Worth recording that the probe's own first two runs were wrong — it left
entities undecoded in ITS reading and reported four false divergences. An
independent check needs the same scrutiny as the thing it checks.

**Full-corpus result.** The check then ran over every extraction file:
**1,127 quotations found verbatim in the raw HTML, 0 not found.** B-26 was the
only one.

That is 1,127 of the **1,149** quotations the corpus holds, and the missing 22
are the honest part of the number. They sit on sources that could not be read
during the run — the migri.fi and Australian pages that block automated reading
— so they were not checked at all. An unchecked quotation is not a passing one,
and the script now NAMES every source it had to skip rather than only counting
them, because a gap you cannot name is a gap you cannot close.

### Nine of them, as it turns out

Having found one missing row, I diffed the whole §84 checklist against the
spec's own text rather than assuming it was the only one. The spec lists **68**
items. This document tracked **60**.

Six were never transcribed at all:

* Current repository work reconciled against every requirement
* Existing verified work preserved and remaining backlog generated from evidence
* Durable execution state, ledger, next-session prompt and resume entry point
* Every baseline country researched or named in an evidence-backed exception ledger
* Global country, visa, source and exception exports generated reproducibly
* Final state file shows no safe actionable work remaining

Two were transcribed with their **scope trimmed**, which is worse than omission
because they read as done:

* "Country registry normalized" — the spec says *across database, API, UI, SEO
  and tests*. The evidence recorded here only ever covered the database.
* "Visa catalog implemented/validated" — the spec says *with exact generated
  totals and official-source provenance*.

And one — separately administered visa jurisdictions — was being satisfied by
the work without ever being tracked.

Three of the six are **NOT DONE** and now say so: there is no exception ledger,
no exports, and no final state file. A checklist that omits the items you have
not done will always report that you are finished.

### A checklist item that had no row

§84 asks that "all 195 baseline countries" be present exactly once in the
canonical registry. This document tracked 60 items and that was not one of them
— so the gap was invisible in the very artefact built to make gaps visible, and
stayed invisible while three destinations were added on top of it.

It is rows 6a and 6b below now. Worth naming the failure mode rather than
quietly fixing it: **a checklist derived from a spec can omit an item, and then
nothing downstream ever asks about it again.** The other rows were transcribed
when the document was written; this one was not, and no amount of re-verifying
the sixty said anything about the sixty-first.

## §84, item by item

| # | Item | State | Evidence |
|---|---|---|---|
| 1 | Existing Claude agents inventoried and used appropriately | done | `COORDINATION_LEDGER.md` agent table — 6 delivered, 2 lost to session limits and mitigated. Carried. |
| 2 | Production application audited | done | `docs/seo/SEO_AUDIT_BASELINE.md`, `docs/overnight/BASELINE.md`. Carried; production reachability re-checked 2026-08-23 (`/en/visas` 200, 9 destinations listed). |
| 3 | Documentation repository inspected | done | `docs/repository-separation/REPOSITORY_SEPARATION_VALIDATION.md`. Carried. |
| 4 | Implementation repository inspected | done | `docs/architecture/ARCHITECTURE.md` (1,524 lines). Carried. |
| 5 | Current architecture documented | done | as above. Carried. |
| 6 | Baseline defects recorded | done | `docs/engineering/BUG_LOG.md`. Carried. |
| 6a | **All 195 baseline countries present exactly once** | done | **This row did not exist until 2026-08-24, and neither did the countries.** §4.1's floor — 193 UN member states plus the Holy See and the State of Palestine — is now in `visa_countries`: 196 rows, being the 195 plus Hong Kong SAR, which §4.1 expressly permits as a separately administered jurisdiction. Generated by `scripts/visa-registry/generate-country-baseline.mjs`, which reads the list out of the spec itself and round-trips every ISO code through Node's ICU database against the spec's name, refusing to emit anything it cannot map. **Verified on production:** 196 countries, 13 publishable, 183 baseline-only, 0 carrying an authority nobody verified. |
| 6b | The baseline publishes nothing | done | `support_state = 'unsupported'`, and `listPublishedCountries` filters those out. **Verified live 2026-08-24**: the sitemap is unchanged at 1,200 URLs, `/visas` still lists 13 countries, and `/visas/chad`, `/visas/bhutan` and `/visas/paraguay` all return **404**. 182 empty country hubs would have been the thin-content regression the programmatic-SEO gate exists to prevent. |
| 7 | Country registry normalized **across database, API, UI, SEO and tests** | done | `visa_countries`, **196 rows**; the 13 researched carry authority, portal, languages, currency and jurisdiction notes, the other 183 a name, code and slug and nothing else. **API/UI**: the destination dropdown reads the STRATEGY registry — a second country list — and `test/country-registry-strategy-parity.spec.ts` asserts every country the product accepts an application for exists in `visa_countries` under the same name; two names differ deliberately and each must carry a written reason. **SEO**: the live sitemap was compared to the registry member by member, not by count — 13 hubs and 58 detail pages, slugs identical in both directions — and `scripts/verify-deploy.sh` now enforces that on every deploy, reporting URLs the sitemap advertises that the registry does not publish and pages the registry publishes that the sitemap omits. **Tests**: the parity spec above, plus the deploy sweep which now covers country hubs as well as detail pages (71, not 58 — hubs publish on different criteria and were never checked). **Verified 2026-08-24.** |
| 8 | Visa catalog implemented/validated **with exact generated totals and official-source provenance** | done | `visa_types`, **79 rows**. **Verified 2026-08-24** via the regenerated coverage matrix, which now also states the denominator: 13 countries researched, 183 in the registry and not yet researched. |
| 9 | Official-source provenance implemented | done | **235 active sources**; every active requirement carries a non-null `source_version_id` — asserted by every promotion migration. **Verified 2026-08-24.** |
| 10 | Structured requirements engine implemented/validated | done | **1,018 active requirements**, typed (`condition`/`evidence`/`form`/`fee`/`step`/`recommended`) with `parameters`. `validate-stored-rules.ts` **run clean 2026-08-24**. |
| 11 | Official form/document library implemented | **blocked on evidence** | `form_templates` holds 66 rows, each now carrying a version history (**B-27**). The 265-form sweep queue is triaged as far as evidence allows — 8 `added`, 19 `acknowledged`, 238 open. **Re-measured 2026-08-24**: the citation basis is exhausted, and that is now a measurement rather than an inference — `triage-sweep-findings.ts` read 157 pages across 229 registered sources and found **0 of 238** cited, after correctly discarding 36 matches that were site navigation (uscis.gov prints a "most accessed forms" menu on every page; without that filter the queue would have been cleared on furniture). The remaining 238 are blocked on evidence, not effort: no triage time moves them because there is nothing to triage them against. What would move them is tracking more pages per authority, or regaining access to the 72 unreadable sources — neither of which is triage. Nothing is marked `ignored`, because that would convert our coverage gap into a decision about a government form. |
| 12 | Document versioning implemented | done | `visa_source_versions` (**162 rows**, sha256 + extractor version + is_active chain); `docs/visa-data/DOCUMENT_VERSIONING.md`. **Verified 2026-08-24.** |
| 13 | Morning source monitoring implemented | **partial** | `visa-sync.scheduler.ts` + `visa_sync_runs`; runs execute against the full registry — the latest checked 235 sources with 0 parse errors and 1 client-rendered. The monitor RUNS, and until **B-29** it produced fiction: every change was diffed against the empty string, so it had never once answered "what changed on this page". Fixed and deployed 2026-08-24. `backfill-version-text.ts` then recovered the text for **154 versions** whose stored hash still matches the live page — provably the same content, which is the only condition under which a backfill is honest; 129 were left NULL because their pages have moved on and inventing that text would assert the version said what the page says today. **38 of 156 ACTIVE versions now carry text**, so those sources produce a real diff on their next change and the rest say "cannot be characterised" once more each. This row closes when a real diff — a change record with a non-empty `removed` array — is observed in production. |
| 14 | Safe change-promotion workflow implemented | done | The MECHANISM was always sound and is verified: draft → review → active, the generator refuses to emit `active`, each promotion migration asserts its own claims before committing and one REFUSED to, the previous version keeps serving while a review is pending, and B-23's numbering deadlock and duplicate-filing traps are both closed and tested. The two things that made this row dishonest are now fixed. **B-29**: every classification handed to the reviewer was fiction, drawn from a diff against the empty string; fixed, 127 production records corrected, and an unattributable change now says so instead of inventing counts. **§74**: the human this workflow depends on had no screen anywhere in the product; `/registry` exists, is admin-guarded (401 unauthenticated, 307 to /login), and renders an uncharacterised change as "Unknown — previous text not retained" rather than laundering it. A gate now has a gatekeeper. **Verified 2026-08-24.** |
| 15 | Personalized recommendation logic audited/improved | done | `docs/product/UX_IMPROVEMENTS.md`, `docs/overnight/PRODUCT_IMPROVEMENTS.md`. Carried. |
| 16 | Personalized checklist implemented/improved | done | as above. Carried. |
| 17 | User-effort reductions implemented | done | `docs/product/FEATURES_IMPLEMENTED.md`. Carried. |
| 18 | High-value product improvements implemented | done | as above, plus `docs/product/VISAAI_FUTURE_HIGH_VALUE_IDEAS.md` for what was deliberately deferred. Carried. |
| 19 | OpenAI callsites inventoried | done | `docs/ai/OPENAI_ARCHITECTURE.md`. Carried. |
| 20 | Central gateway / model routing implemented | done | `model-policy.ts`; zero hardcoded model literals in feature code. Carried. |
| 21 | Prompt/token optimization implemented | done | `docs/ai/PROMPT_TOKEN_OPTIMIZATION.md`. Carried. |
| 22 | Structured Outputs used where appropriate | done | Carried (`docs/ai/OPENAI_ARCHITECTURE.md`). |
| 23 | Prompt/application caching implemented where justified | done | Carried. |
| 24 | Duplicate AI calls eliminated | done | Carried. |
| 25 | Batch processing evaluated/used | done | Carried. |
| 26 | AI evals implemented | **harness only** | `scripts/run-evals.ts` + `docs/ai/AI_EVALS.md` exist and the harness is tested. **No eval has ever run against a funded key** (BL-1), so every model-tier assignment is a reasoned choice, labelled as such, not a measurement. |
| 27 | AI cost observability implemented | done | `ai_usage_events` + `AiUsageMeter` (failure paths covered in the API suite). Carried. |
| 28 | AI before/after cost report completed | **projected, not measured** | `docs/ai/AI_COST_REPORT.md` — figures are computed from published prices and token counts, not from billed usage. Same blocker as #26. |
| 29 | Legal/compliance risks reviewed | done | `docs/legal/LEGAL_REVIEW_REQUIRED.md`, 21 issues. Carried. |
| 30 | Counsel-required decisions documented | done | 11 Critical-before-launch items in the same document (BL-6). Carried. |
| 31 | Security review completed | done | `docs/security/` — 15 documents including `SECURITY_FINAL_GATE.md`. Carried. |
| 32 | Privacy/retention workflows validated | done | Carried. |
| 33 | SEO baseline completed | done | `docs/seo/SEO_AUDIT_BASELINE.md`. Carried. |
| 34 | Technical SEO implemented | done | `docs/seo/TECHNICAL_SEO_IMPLEMENTATION.md`. Carried. |
| 35 | Public visa information architecture improved | done | `/visas` → country hub → visa detail, **56 detail pages** × 16 locales locally. **Verified 2026-08-24** locally; production still carries the 9 live destinations and 43 pages. |
| 36 | Programmatic SEO quality gates implemented | done | `visa_publishable_pages` is a VIEW requiring ≥1 active *official* requirement and ≥1 active source; a type without extracted requirements renders `noindex`. **Verified 2026-08-23.** |
| 37 | Canonicals/sitemaps/indexation validated | done | 855 production sitemap URLs. Carried for the canonical fix. |
| 38 | International SEO validated | done | `docs/seo/INTERNATIONAL_SEO.md`. Carried. |
| 39 | Structured data validated | done | `docs/seo/PROGRAMMATIC_SEO_ARCHITECTURE.md`. Carried. **Every published requirement now also renders the authority's own words as a `<blockquote>` (B-22)**, which is the citation an answer engine can lift. |
| 40 | OAI-SearchBot / AI crawlability checked | done | `docs/seo/AI_SEARCH_GEO_AEO.md`. Carried. |
| 41 | AI-search / GEO / AEO documentation completed | done | as above. Carried. |
| 42 | Search Console workflow completed **or** blocker documented | **blocked, documented** | BL-2: no Search Console ownership. Manual steps in `docs/seo/SEO_MEASUREMENT.md`. No index, position or traffic figure is claimed anywhere. |
| 43 | Accessibility tested | done | axe (WCAG 2.2 AA) over the public routes, and **as of 2026-08-23 over the registry-backed pages too** — `e2e/visa-registry-a11y.spec.ts`, 2 passed, 0 violations. Closes BL-5. |
| 44 | Localization tested | done | 16 locales, `e2e/public-route-locale.spec.ts`. Carried. |
| 45 | Country × visa automated coverage generated | done | `scripts/visa-registry/coverage-matrix.mjs` → `docs/testing/COUNTRY_VISA_COVERAGE.md`. **Regenerated 2026-08-24**: 72 rows, 56 PASS, 16 BLOCKED. Every cell read from the registry. |
| 46 | Profile equivalence classes tested | done | `docs/testing/PROFILE_COVERAGE.md`. Carried. |
| 47 | Browser E2E completed | done | Playwright, two CI jobs (one against a live API + seeded Supabase). Carried; the new a11y spec **run locally 2026-08-23**. |
| 48 | Field-level QA completed | done | `docs/testing/TEST_STRATEGY.md`, `qa/`. Carried. |
| 49 | Security tests completed | done | `docs/security/SECURITY_TEST_RESULTS.md`; RLS suites gated in CI. Carried. **Anon-read RLS on the new Finnish rows verified 2026-08-23** through PostgREST with the anon key. |
| 50 | Performance baseline captured | done | `docs/performance/PERFORMANCE_REPORT.md`. Carried. |
| 51 | Performance optimization implemented | done | as above. Carried. |
| 52 | Performance re-tested | **partial** | Lighthouse budgets run in CI. Backend load testing is BL-4 — no staging environment, and load-testing production is not on the table. |
| 53 | Dead code safely removed | done | `docs/engineering/CODE_CLEANUP.md`. Carried. |
| 54 | Dependencies cleaned | done | `scripts/check-vulnerable-deps.mjs`, workspace overrides. Carried. |
| 55 | CI/CD gates verified | done | `.github/workflows/agent-tests.yml` — typecheck, unit, RLS, E2E, a11y, plus no-skip gates that fail the build when a suite silently stops running. Carried. |
| 56 | Migrations validated | done | **266 migrations**; the 24 added 2026-08-23/24 **applied and asserted locally**. Every promotion migration asserts its own claims before committing, and one of them refused to. |
| 57 | Build passes | done | `pnpm --filter web build` **exit 0, 2026-08-24**; `tsc --noEmit` clean for api and web. |
| 58 | Test suites pass or failures documented | done | api **3,051 passed / 43 skipped**, web **415 passed** — both run 2026-08-24. The new tests cover `detectSiteWideChanges` (6) and the display-excerpt derivation (12 in the API suite, 5 in the web suite reading the whole extraction corpus). One `pnpm --filter api test` run exited non-zero on a Jest teardown warning with every test passing; two subsequent runs were clean, so it is recorded as a flake rather than papered over. |
| 59 | Final documentation complete | done | 74 documents under `docs/`. This file is the §84 index. |
| 60 | Final limitations/blockers listed | done | below, and in `docs/overnight/BLOCKED_ITEMS.md`. |

| 61 | Current repository work reconciled against every requirement in this specification | done | `docs/execution/CURRENT_STATE_AUDIT.md` maps **all 89 numbered sections** to a §0.1 status, and its section list is READ OUT OF THE SPEC at generation time so a section cannot be omitted the way eight §84 rows were. **0 remain `NOT_ASSESSED`**: 64 `VERIFIED_COMPLETE`, 11 `PARTIAL`, 9 `IMPLEMENTED_NOT_VERIFIED`, 4 `BLOCKED`, 1 `NOT_STARTED` (§42 `llms.txt`, which the spec marks optional). The 9 unverified ones are the reconciliation's most useful output — sections where an artefact was confirmed to exist but its behaviour was never checked, which looks like done from a distance. They are now backlog entry `SEC-INV`. **Verified 2026-08-24.** |
| 62 | Existing verified work preserved and remaining backlog generated from evidence | done | Preservation holds — nothing verified has been deleted. The backlog artefact now exists: `docs/execution/execution-assertions.json` carries **8 ordered entries and 5 blockers**, each derived from a §84 row that is not `done` and each carrying its own verification command. An entry whose verification command cannot be written is treated as not yet understood well enough to work, which keeps the list from filling with intentions. **Verified 2026-08-24.** |
| 63 | Durable execution state, ledger, next-session prompt and resume entry point validated | done | All four artefacts §0.1 names now exist **at the paths the spec names** — which is the part that was wrong: two analogues lived at `docs/exec/` under different names and the required files did not exist at all. `MASTER_EXECUTION_STATE.json` is GENERATED from git, the database and the test run, with the measured and asserted halves kept apart so an assertion cannot inherit a measurement's authority; it records WHICH database it read, because local carries 63 pages and production 58. `scripts/resume-visaai-master-execution.sh` validates the four files, compares the state's commit and the spec's hash against reality, and **exits non-zero when the state cannot be trusted** — it reports, it does not repair, and it claims no recovery from a powered-off machine. **Run 2026-08-24**: it correctly flagged its own uncommitted slice and the absent test evidence. |
| 64 | Separately administered visa jurisdictions assessed and documented | done | Hong Kong SAR is registered in its own right with a `jurisdiction_note` on the Basic Law position, and §4.1 expressly permits it. Sabah and Sarawak are documented inside Malaysia's routes — the Student's Pass records their extra documents, the Residence Pass records that they require a sponsor **of Sabah or Sarawak origin**. Macao, Taiwan and the six non-passport travel documents ICA names are recorded as *not extracted* rather than assessed. **Verified 2026-08-24.** |
| 65 | Every in-scope country's official visa/type hierarchy researched, or named in the evidence-backed exception ledger | **done** | Scope is **37 countries** (spec §4.1, list in `data/country-scope.json`). **19 researched; the other 18 all carry probe evidence — ZERO unexamined**, and the coverage matrix now reports those two states on separate lines instead of collapsing them into "not yet researched", which had been making an evidenced refusal and an unopened file look identical. Conclusions across the 18: 6 `blocked_by_authority` · 6 `blocked_by_client_rendering` · 2 `blocked_by_our_egress` · 1 `blocked_unresolvable_redirect_loop` · 1 `readable_but_catalogue_not_enumerable` · 1 `authority_reachable_publishes_no_entry_requirements` · 1 `unresolved_no_reachable_authority`. Seven conclusions rather than one, because an IP-level block that is ours to fix, a page that renders by script, a robots.txt that redirects to itself and an outright refusal have four different futures. **2026-08-26 second pass**: the fourteen countries previously filed `needs_deeper_research` were re-probed by ENUMERATING each site rather than stopping at its landing page. Four turned out to publish extractable requirements two clicks away and are now live — Türkiye, Egypt, Lebanon, China, 16 routes, 303 verbatim requirements. Two earlier verdicts were corrected: China's freshness rejection (its datelines are in the page BODY, which `probe-authority.ts` does not read) and Palestine's "no authority identified" (moi.gov.ps answers, permits us, and publishes no entry requirements — a finding about the authority rather than about our search). **What this row does NOT claim**: that all 37 are publishable. Eighteen are not, each for a measured reason. **Verified 2026-08-26.** |
| 66 | Global country, visa, source and exception exports generated reproducibly | done | `scripts/visa-registry/generate-global-catalog.mjs` writes all seven §5.1 artifacts from the database: `GLOBAL_COUNTRY_SCOPE.md`, `GLOBAL_VISA_CATALOG.md`, `GLOBAL_COVERAGE_EXCEPTIONS.md`, and `artifacts/visa-data/` holding the country registry JSON, the catalog JSON and CSV, and the official source ledger CSV. Derived, so they cannot disagree with the registry — only be stale, and re-running fixes stale. **Generated 2026-08-26**: 196 countries (19 researched), 109 visa types, 276 sources, 16 blocked, 177 out of scope or unresearched. The exceptions file now states the §84-item-65 condition explicitly in BOTH directions — it used to say "the row stays open until this number reaches zero" and go on saying it after the number reached zero. |
| 67 | Final state file shows no safe actionable work remaining | **NOT DONE** | `MASTER_EXECUTION_STATE.json` exists and is generated from git and the database, so the state file itself is no longer the gap. The claim it would have to support is still false: safe actionable work remains and is now NAMED rather than estimated — roughly a dozen further readable Lebanese routes, two more Chinese service guides, Türkiye's enumerated-but-undescribed subtypes, and a re-measurement of the 238 form-sweep findings against a citation basis that just widened by 27 sources. Recording this as done would be false. |

## Known gaps, stated plainly

**16 visa types are BLOCKED BY OFFICIAL SOURCE** — 10 Australian, 6 American.
`immi.homeaffairs.gov.au` returns 403 to an identified agent and its
`robots.txt` is 403 too, so we cannot even read what is permitted. Both
countries were re-probed and the calls confirmed. This is not an engineering
problem and no amount of work here changes it.

**238 sweep findings remain open.** 19 were confirmed in scope on evidence and
marked `acknowledged`; nothing was marked `ignored`, because absence of a
mention is weak evidence either way.

Zero of the 166 IRCC findings are named on any page we track, and the first
explanation for that — thin canada.ca coverage — was **wrong**.
`SweepService.knownCodes()` excludes every code the catalogue already covers, so
the queue is by construction the forms VisaAI does not already handle; a form our
pages cite is already catalogued and never enters it. Verified: the registered
`imm5257.html` source cites IMM 5257, IMM 5409 and IMM 5476, and none of the
three is in the queue. This evidence basis therefore cannot triage the IRCC half
at all — the basis and the queue are disjoint by design. See
`docs/operations/FORM_SWEEP_TRIAGE.md`.

**No AI eval has measured anything** (BL-1). The harness works; the tiers are
reasoned, not measured; the cost report is projected, not billed.

**No search-performance figure exists** (BL-2) and none is claimed.

**No load test** (BL-4) — there is no staging environment.

**11 legal items need counsel** (BL-6). Engineering controls were implemented
where the issue had one; the rest are decisions, not code.

## Manual actions

1. **Restore production access to migri.fi** — the only thing standing between
   Finland's five verified extractions and five live pages. Either an allowlist
   for the VPS egress IP via the outreach process in
   `docs/operations/SOURCE_ACCESS.md`, or an egress path for the monitor that
   Migri's WAF does not challenge. Until then the extractions sit verified and
   unpublished, which is the honest state. The cutover procedure —
   including the `supabase_admin` role and Node 20 WebSocket gotchas — is in
   `docs/operations/VISA_REGISTRY_PRODUCTION_CUTOVER.md`.
2. **Run the probe from the VPS, not from a laptop**, before admitting the next
   destination. Every criterion in `probe-authority.ts` is evaluated from
   wherever it runs; Finland passed locally and failed in production, and only
   trying from the syncing host can catch that. **Done for Singapore on
   2026-08-24** — 31/31 sources HTTP 200 from the VPS before anything was
   deployed — and it is now a step in the deployment section above rather than
   a note here.
3. **Claim Search Console** (BL-2) — the only thing standing between the SEO work
   and a measurement of it.
4. **Fund an OpenAI key** for the eval harness (BL-1), which turns the model tiers
   from reasoned into measured.

## What changed on 2026-08-24

**Three destinations: Singapore (11th), Malaysia (12th), Hong Kong SAR (13th).**
Twelve routes, 254 requirements, 35 sources, every excerpt verified verbatim.

**"Can a spouse work?" now has five different answers in this registry**, none of
the five authorities referring to any other: Singapore's Dependant's Pass needs
an employer-lodged work pass and getting an Employment Pass *cancels* the
dependency; Singapore's ONE Pass restores a Letter of Consent; Malaysia's LTSVP
permits work on the same pass by endorsement; Hong Kong's dependants need no
separate permission at all; Ireland's family route is different again. That
comparison exists only because the routes sit in one registry.

**Hong Kong SAR, the thirteenth — four routes, 67 requirements, all bounded.**

It was never blocked. `hk.gov.hk/robots.txt` is unreadable, but that is GovHK,
the portal; `immd.gov.hk`, the actual authority, returns 404 on robots.txt —
no restrictions — and the two paths tried simply did not exist. Reading its own
service index returned thirty real visa pages in one fetch. **Fourth time a
"blocked" call has been a guessed URL**, and the sharper form of the rule is now
written down: check you are probing the AUTHORITY, not the government portal
that links to it.

| Route | Why it was worth adding |
|---|---|
| `hk-residence-as-dependant` | **Who your sponsor is decides whether your parents can come.** A visa holder never can; a permanent resident can, once the parent turns 60. And it corrects what the work routes imply: a **student's** dependant is the one who needs the Director's permission to work. |
| `hk-non-local-graduates` (IANG) | **Six months from graduation decides whether you need a job.** Inside it: no offer required, 24 months, no employment condition. Outside it: a graduate-level offer at market pay. The second deadline in this registry whose consequence is invisible until it has passed. |
| `hk-general-employment-policy` | **The authority disclaims its own checklist**: "the director of immigration reserves absolute discretion to refuse any application even if the application meets all eligibility criteria." Stored first, ahead of the criteria it qualifies. Three of the five criteria are about the employer and the labour market, not the candidate. |
| `hk-quality-migrant-admission-scheme` | **The points are not the decision.** Threshold → periodic *selection exercise* → panel weighing Hong Kong's manpower needs. Singapore's COMPASS is 40 points and you are through; here the points get you considered. And no job offer is required at all — the opposite premise to the GEP, same authority, neither page mentioning the other. |

Both pages carry entry AND extension of stay on one URL, so both extractions are
bounded — and the bounds caught three excerpts that also appear outside them.

**Malaysia, the twelfth — three routes, 64 requirements, and a check it forced
into existence before it was admitted.**

`imi.gov.my` passed every check the probe had — 227KB of HTML, ~11,000
characters normalized, all five requirement markers, current year — and its
Employment Pass page is **three unique lines inside an 820-line shared menu**.
The markers are menu labels. Boilerplate is by definition what pages SHARE, so
no single-page check could ever have seen it; `probe-authority.ts` now diffs
pages from the same host against each other. `my-employment-pass` is
deliberately not registered.

| Route | Why it was worth adding |
|---|---|
| `my-residence-pass` | **The sponsor's state of origin is a condition.** An application made in Sabah or Sarawak needs a sponsor *of Sabah or Sarawak origin* — the first time in this registry that their separate immigration authority changes who qualifies rather than what paperwork is needed. Three years' residence for a citizen's family, five for a permanent resident's. |
| `my-student-pass` | **The ordering is the requirement**: outside Malaysia → EMGS screening → eVAL → eVisa → entry → medical within 7 days → institution submits. Each step gates the next. One pass, three sets of rights by institution type. |
| `my-long-term-social-visit-pass` | A family pass that lets a spouse **work without converting** — the opposite of Singapore's Dependant's Pass, registered hours earlier. Plus *naziran*, an authority publishing its own home-visit inspection regime, and a child age ceiling of **7**. |

**Singapore, the eleventh — eight routes, 172 requirements, 31 sources, live on
production the same night.**

| Route | Why it was worth adding |
|---|---|
| `sg-employment-pass` | The first route where **the applicant is the employer**. Half the checklist is the hiring firm's and cannot be satisfied by the candidate at all. Two live salary regimes, one dated 1 Jan 2027. |
| `sg-entry-visa` | One visa, 33 per-nationality pages, **two regimes**. 19 nationalities need a Form V39A sponsor letter; 14 do not. Two pages read as one template — all 33 disproved it. |
| `sg-student-pass` | The **EduTrust rule**: an uncertified private school cannot take a foreign student at all, published only by the immigration authority. Religious study inverts the pass exemptions. |
| `sg-entrepass` | The one MOM pass **you apply for yourself**. No salary floor, because there is no employer to gate on — it gates on the business, and six trades are excluded outright. |
| `sg-dependants-pass` | First `dependant` route. Needs the sponsor on **$6,000** against an Employment Pass floor of **$5,600** — a gap visible only with both routes registered. |
| `sg-s-pass` | A lower bar that **costs the employer more**: quota, levy, mandatory insurance, Primary Care Plan. Three salary regimes bind at once. |
| `sg-one-pass` | Tops a ladder that **inverts** — S$30,000 a month and exempt from COMPASS, advertising, levy and the one-employer rule. Restores the Letter of Consent the Dependant's Pass had lost. |
| `sg-long-term-visit-pass` | A **deadline that expires before you know the process exists**: six weeks instead of six months, decided by a free assessment only available before the wedding. |

Two categories publish for the first time: `dependant` and `skilled_worker` for
Singapore.

What extracting a country's routes **together** made visible, none of it on any
single government page:

* The Employment Pass floor ($5,600) sits below the Dependant's Pass threshold
  ($6,000), so an EP holder at the bottom of MOM's own schedule cannot bring a
  spouse. The promotion migration asserts the gap, and fails if MOM closes it.
* The Dependant's Pass expiring with the main work pass is the *cause* of the
  Student's Pass rule ICA publishes as a *consequence*.
* The Letter of Consent was not abolished, it was restricted to the ONE Pass —
  which reads as a flat contradiction unless both routes are read the same day.

Two quality gates earned their keep rather than merely existing:

1. **A promotion migration refused to commit.** The EntrePass migration asserts
   exactly five innovation criteria; a `criterion_%` prefix match counted six
   because an evidence row shared the prefix. Rolled back until renamed.
2. **`verify-excerpts.ts` was calling an unreadable page a lie.** A full-repo run
   reported "8 excerpt problem(s) … unpublishable as-is" and all eight were the
   Australian 403 — routes that publish nothing anyway. Drift and unreadability
   are now separate counters; only drift fails the run. A gate that is always red
   is a gate nobody reads, and real drift would have been invisible inside the
   noise.
3. **`probe-authority.ts` could not tell a page from a menu.** Malaysia's
   `imi.gov.my` passed every check with a page that is 3 unique lines inside an
   820-line shared navigation. The check is now comparative, because boilerplate
   is by definition what pages share.
4. **The sync raised eight escalations for one edit.** Recorded above.
   `detectSiteWideChanges` annotates them without clearing the review.
5. **`verify-extraction-bounds.ts` caught three mis-attributions before they
   shipped.** Hong Kong's GEP and QMAS pages each carry the entry application
   AND the extension of stay on one URL; 1 of GEP's 19 excerpts and 2 of QMAS's
   19 also appear verbatim outside their bound. Unbounded they would have
   verified clean while attributing a first-application rule to a renewal.

**And one finding that was found, recorded, and then fixed — D-11 / B-22.**

The public visa page never showed the government's own words.
`apps/web/lib/visa-registry.ts` did not select `source_excerpt`, so no page
could render it: **0 of 19** excerpts appeared on Hong Kong's QMAS page, and the
3 of 18 on Canada's visitor visa page were coincidental overlaps with VisaAI's
own description prose. Every requirement here exists only because it is bound to
a verbatim quote, and the applicant was shown the paraphrase.

Selecting that column would have been worse than the bug. `normalizeContent`
lowercases and re-spaces, so quoting it would have put our processing artifacts
inside a quotation attributed to a government.

The text is now stored twice, for two different jobs. `source_excerpt` is
untouched — verification, hashing and change detection compare exactly what they
compared before. `source_excerpt_display` carries the same span of the same page
with the authority's own capitalisation, derived exactly rather than re-matched:
`.toLowerCase()` is the last operation in `normalizeContent`, so the two
normalizations correspond character-for-character.

**1,149 of 1,149 active requirements can quote their authority** (1,023 of 1,023 on
production; the 104 skipped are Australia's WAF-blocked routes, which publish
nothing). NULL renders no quotation and is never back-filled from the matching
text — that fallback is the defect.

One character nearly cost a country. A single Turkish dotted `İ` on migri.fi
lowercases to TWO code units and shifted every later offset, and the first
version's length check refused all 126 Finnish requirements wholesale. Replaced
with an explicit offset map. Finland recovered all 126.

Verified live: the exact IRCC sentence `You must: have a valid travel document,
like a passport` renders on `visaai.co`, the lowercased artifact does not, and
18/18, 19/19, 21/21 and 22/22 quotes render on Canada, Hong Kong, Singapore and
Malaysia. See `docs/engineering/BUG_LOG.md` B-22.

## Manual actions

1. **Restore production access to migri.fi** — the only thing standing between
   Finland's five verified extractions and five live pages. Either an allowlist
   for the VPS egress IP via the outreach process in
   `docs/operations/SOURCE_ACCESS.md`, or an egress path for the monitor that
   Migri's WAF does not challenge. Until then the extractions sit verified and
   unpublished, which is the honest state. The cutover procedure —
   including the `supabase_admin` role and Node 20 WebSocket gotchas — is in
   `docs/operations/VISA_REGISTRY_PRODUCTION_CUTOVER.md`.
2. **Run the probe from the VPS, not from a laptop**, before admitting the next
   destination. Every criterion in `probe-authority.ts` is evaluated from
   wherever it runs; Finland passed locally and failed in production, and only
   trying from the syncing host can catch that. **Done for Singapore on
   2026-08-24** — 31/31 sources HTTP 200 from the VPS before anything was
   deployed — and it is now a step in the deployment section above rather than
   a note here.
3. **Claim Search Console** (BL-2) — the only thing standing between the SEO work
   and a measurement of it.
4. **Fund an OpenAI key** for the eval harness (BL-1), which turns the model tiers
   from reasoned into measured.

## What changed on 2026-08-24

**Three destinations: Singapore (11th), Malaysia (12th), Hong Kong SAR (13th).**
Twelve routes, 254 requirements, 35 sources, every excerpt verified verbatim.

**"Can a spouse work?" now has five different answers in this registry**, none of
the five authorities referring to any other: Singapore's Dependant's Pass needs
an employer-lodged work pass and getting an Employment Pass *cancels* the
dependency; Singapore's ONE Pass restores a Letter of Consent; Malaysia's LTSVP
permits work on the same pass by endorsement; Hong Kong's dependants need no
separate permission at all; Ireland's family route is different again. That
comparison exists only because the routes sit in one registry.

**Hong Kong SAR, the thirteenth — four routes, 67 requirements, all bounded.**

It was never blocked. `hk.gov.hk/robots.txt` is unreadable, but that is GovHK,
the portal; `immd.gov.hk`, the actual authority, returns 404 on robots.txt —
no restrictions — and the two paths tried simply did not exist. Reading its own
service index returned thirty real visa pages in one fetch. **Fourth time a
"blocked" call has been a guessed URL**, and the sharper form of the rule is now
written down: check you are probing the AUTHORITY, not the government portal
that links to it.

| Route | Why it was worth adding |
|---|---|
| `hk-general-employment-policy` | **The authority disclaims its own checklist**: "the director of immigration reserves absolute discretion to refuse any application even if the application meets all eligibility criteria." Stored first, ahead of the criteria it qualifies. Three of the five criteria are about the employer and the labour market, not the candidate. |
| `hk-quality-migrant-admission-scheme` | **The points are not the decision.** Threshold → periodic *selection exercise* → panel weighing Hong Kong's manpower needs. Singapore's COMPASS is 40 points and you are through; here the points get you considered. And no job offer is required at all — the opposite premise to the GEP, same authority, neither page mentioning the other. |

Both pages carry entry AND extension of stay on one URL, so both extractions are
bounded — and the bounds caught three excerpts that also appear outside them.

**Malaysia, the twelfth — three routes, 64 requirements, and a check it forced
into existence before it was admitted.**

`imi.gov.my` passed every check the probe had — 227KB of HTML, ~11,000
characters normalized, all five requirement markers, current year — and its
Employment Pass page is **three unique lines inside an 820-line shared menu**.
The markers are menu labels. Boilerplate is by definition what pages SHARE, so
no single-page check could ever have seen it; `probe-authority.ts` now diffs
pages from the same host against each other. `my-employment-pass` is
deliberately not registered.

| Route | Why it was worth adding |
|---|---|
| `my-student-pass` | **The ordering is the requirement**: outside Malaysia → EMGS screening → eVAL → eVisa → entry → medical within 7 days → institution submits. Each step gates the next. One pass, three sets of rights by institution type. |
| `my-long-term-social-visit-pass` | A family pass that lets a spouse **work without converting** — the opposite of Singapore's Dependant's Pass, registered hours earlier. Plus *naziran*, an authority publishing its own home-visit inspection regime, and a child age ceiling of **7**. |

**Singapore, the eleventh — eight routes, 172 requirements, 31 sources, live on
production the same night.**

| Route | Why it was worth adding |
|---|---|
| `sg-employment-pass` | The first route where **the applicant is the employer**. Half the checklist is the hiring firm's and cannot be satisfied by the candidate at all. Two live salary regimes, one dated 1 Jan 2027. |
| `sg-entry-visa` | One visa, 33 per-nationality pages, **two regimes**. 19 nationalities need a Form V39A sponsor letter; 14 do not. Two pages read as one template — all 33 disproved it. |
| `sg-student-pass` | The **EduTrust rule**: an uncertified private school cannot take a foreign student at all, published only by the immigration authority. Religious study inverts the pass exemptions. |
| `sg-entrepass` | The one MOM pass **you apply for yourself**. No salary floor, because there is no employer to gate on — it gates on the business, and six trades are excluded outright. |
| `sg-dependants-pass` | First `dependant` route. Needs the sponsor on **$6,000** against an Employment Pass floor of **$5,600** — a gap visible only with both routes registered. |
| `sg-s-pass` | A lower bar that **costs the employer more**: quota, levy, mandatory insurance, Primary Care Plan. Three salary regimes bind at once. |
| `sg-one-pass` | Tops a ladder that **inverts** — S$30,000 a month and exempt from COMPASS, advertising, levy and the one-employer rule. Restores the Letter of Consent the Dependant's Pass had lost. |
| `sg-long-term-visit-pass` | A **deadline that expires before you know the process exists**: six weeks instead of six months, decided by a free assessment only available before the wedding. |

Two categories publish for the first time: `dependant` and `skilled_worker` for
Singapore.

What extracting a country's routes **together** made visible, none of it on any
single government page:

* The Employment Pass floor ($5,600) sits below the Dependant's Pass threshold
  ($6,000), so an EP holder at the bottom of MOM's own schedule cannot bring a
  spouse. The promotion migration asserts the gap, and fails if MOM closes it.
* The Dependant's Pass expiring with the main work pass is the *cause* of the
  Student's Pass rule ICA publishes as a *consequence*.
* The Letter of Consent was not abolished, it was restricted to the ONE Pass —
  which reads as a flat contradiction unless both routes are read the same day.

Two quality gates earned their keep rather than merely existing:

1. **A promotion migration refused to commit.** The EntrePass migration asserts
   exactly five innovation criteria; a `criterion_%` prefix match counted six
   because an evidence row shared the prefix. Rolled back until renamed.
2. **`verify-excerpts.ts` was calling an unreadable page a lie.** A full-repo run
   reported "8 excerpt problem(s) … unpublishable as-is" and all eight were the
   Australian 403 — routes that publish nothing anyway. Drift and unreadability
   are now separate counters; only drift fails the run. A gate that is always red
   is a gate nobody reads, and real drift would have been invisible inside the
   noise.
3. **`probe-authority.ts` could not tell a page from a menu.** Malaysia's
   `imi.gov.my` passed every check with a page that is 3 unique lines inside an
   820-line shared navigation. The check is now comparative, because boilerplate
   is by definition what pages share.
4. **The sync raised eight escalations for one edit.** Recorded above.
   `detectSiteWideChanges` annotates them without clearing the review.
5. **`verify-extraction-bounds.ts` caught three mis-attributions before they
   shipped.** Hong Kong's GEP and QMAS pages each carry the entry application
   AND the extension of stay on one URL; 1 of GEP's 19 excerpts and 2 of QMAS's
   19 also appear verbatim outside their bound. Unbounded they would have
   verified clean while attributing a first-application rule to a renewal.

**And one finding that is NOT fixed, deliberately — D-11.** The public visa page
never shows the government's own words: `apps/web/lib/visa-registry.ts` does not
select `source_excerpt`. Verified live — 0 of 19 excerpts render on Hong Kong's
QMAS page; the 3 of 18 that appear on Canada's visitor visa page are
coincidental overlaps with VisaAI's own description text. Every requirement here
exists only because it is bound to a verbatim quote, and the applicant is shown
the paraphrase.

It is recorded rather than fixed because the obvious fix is subtly wrong:
`normalizeContent` lowercases and re-spaces the text, so rendering the stored
excerpt inside quotation marks would misquote a government in the very feature
meant to prove VisaAI does not. The honest fix — storing an unnormalized excerpt
beside the normalized one used for matching — is a schema and pipeline change
across 67 extraction files. See `docs/engineering/BUG_LOG.md` D-11.

Three of those four are the same lesson in different places: **a check that
looks at one thing in isolation cannot see what that thing has in common with
its neighbours.** Boilerplate, site-wide banners and the two entry-visa regimes
were all invisible to per-item checks and obvious to comparative ones.

One new checked-in artifact: `scripts/visa-registry/sg-entry-visa-groups.mjs`,
which re-derives the entry visa's two nationality regimes from all 33 ICA pages
and exits non-zero if the membership moves or a third variant appears. It exists
because the registry watches 2 of those 33 pages, and saying so is not the same
as being able to check it.

## What changed on 2026-08-23

Nine visa types were added, each one extracted by hand from the authority's own
pages, every excerpt verified verbatim against the live source, and every
promotion migration asserting its own claims before it commits:

| Route | Why it was worth adding |
|---|---|
| `fi-employed-person` | Finland, the tenth destination. First permit whose general conditions live on a second page the authority names. |
| `fi-residence-permit-studies` | One application, two different permits out of it (A/B). |
| `fi-family-spouse` | One page carrying **two legal regimes** — the superseded one printed in full, three requirements word-for-word identical. Only the bound tells them apart. |
| `fi-specialist` | The registry now holds **both sides** of one authority's salary threshold, and a rule that inverts between the sibling pages. |
| `fi-entrepreneur` | First `entrepreneur` route. Two authorities decide in sequence, and the order costs weeks if you get it wrong. |
| `ca-super-visa` | First `parent` route, and the first checklist where **half the requirements bind somebody else** — the host. |
| `gb-youth-mobility-scheme` | First `youth_mobility` route. Nationality changes the rule, not just the paperwork. |
| `nz-working-holiday-visa` | First `working_holiday` route. ~45 bilateral schemes behind one page, and the country list is unreadable to us — which the page says. |
| `ie-family-reunification-non-eea` | First `family_reunification` route, and the highest thresholds here. Incomes cannot be combined. |

Four new categories publish for the first time: `entrepreneur`, `parent`,
`youth_mobility`, `working_holiday`, `family_reunification` — five, counting
Ireland's.

Three things were also fixed rather than added:

1. **The renderer priced a multiplier.** Sweden's Blue Card page read
   "SEK 53,625 per month · SEK 1.25 multiplier of average salary". Fixed, and the
   whole class — multiplier, ratio, percent, share, factor — now swept over the
   real extraction files by a test.
2. **BL-5 closed**: `/visas/{country}` and the visa detail page are under the axe
   gate, via a spec that discovers its paths from the live index so it cannot
   assert against a 404.
3. **The form-sweep queue was triaged on evidence**, and 71 matches that were
   site navigation rather than page text were thrown out. A conclusion drawn from
   it was then found wrong and corrected in place.
