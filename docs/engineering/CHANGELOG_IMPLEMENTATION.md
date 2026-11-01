# Implementation changelog

Branch `master-exec/visaai-2026-08-20`, 2026-08-20/21.
12 commits, 115 files, +18,447 / −280.

## Migrations (5)

| File | What |
|---|---|
| `20260820120000_visa_registry_core` | 8 tables + `visa_publishable_pages` view: country registry, visa catalog, official-source registry, versioned snapshots, check log, sync runs, typed requirements, change-promotion queue |
| `20260820130000_ai_usage_cache_tokens` | `cached_input_tokens`, `cache_write_tokens` on `ai_usage_events` + a partial index |
| `20260820140000_visa_registry_seed` | generated: 4 countries, 32 visa types, 134 source rows |
| `20260820150000_visa_registry_rls_fix` | closes the "staff_read = every authenticated user" exposure |
| `20260820160000_visa_sources_per_visa_type` | one page may serve several visa types |

All additive. `country_frameworks` and every existing reader untouched.

## API

**New modules**
- `visa-rules/` — typed conditional-requirement engine, three-valued (29 tests)
- `visa-sync/` — fetcher with SSRF controls, RFC 9309 robots, normalizer,
  change classifier, sync orchestration (71 tests)
- `shared/ai/evals/` — eval harness (18 tests)

**New in `shared/ai/`**
- `task-registry.ts` — 18 AI tasks with schema, latency, sensitivity, budget,
  cost ceiling, cache policy, eval threshold
- `model-policy.ts` — the only file containing a model ID
- `model-factory.ts` — the only place a `ChatOpenAI` is constructed

**Changed**
- 9 callsites migrated off hardcoded model names
- `ai-usage.pricing.ts` — cached input, cache writes, the 272K surcharge
- `metering-callback.ts` — reads cache detail from all four SDK shapes
- `ai.service.ts` — model literal replaced by tier resolution
- `consultant/ai-review-assistant`, `messaging/messaging-ai`,
  `voice/voice-orchestration` — untrusted-input fencing
- `prompt-injection-coverage.spec.ts` — now sees both calling conventions

## Web

**New routes** `/visas`, `/visas/{country}`, `/visas/{country}/{visa}`
**New** `lib/visa-registry.ts`, `lib/seo/site.ts`, `components/visas/*`,
`app/layout.tsx`, `app/not-found.tsx`, `app/global-error.tsx`

**Changed**
- `lib/seo/alternates.ts` — locale-aware canonicals
- `app/sitemap.ts` — registry-backed, real lastmod, 90 → 180 URLs
- `app/robots.ts` — `/visas`, AI-crawler groups, shared SITE_URL
- `proxy.ts` — `/visas*` public
- `pricing/page.tsx` — `revalidate: 300`
- `lib/plan-error.ts` — derives from the shared price catalog
- `messages/*.json` (15) — false consultant claim removed
- `e2e/design-system.spec.ts` — `/visas` in the a11y gate

## Shared types

`PLAN_PRICE_CENTS`, `PLAN_LABELS`, `formatPlanPrice`, `planLabelWithPrice`.

## Scripts

- `scripts/visa-registry/generate-seed.mjs`
- `scripts/visa-registry/coverage-matrix.mjs`
- `apps/api/scripts/print-routing-table.ts`

## CI

`visa_registry_rls_test.sql` added to the RLS job.

## Tests

| | Before | After |
|---|---|---|
| API | 2,822 | **2,916** |
| Web | 321 | **352** |
| E2E | 54 | 54 (+2 a11y checks) |
| SQL RLS suites | 1 | 2 |

## Docs

25 files under `docs/` — architecture, visa-data (4), ai (5), operations (3),
testing (5), performance, security (12 incl. the new review), legal, product,
engineering (3), seo (8), exec ledger.
