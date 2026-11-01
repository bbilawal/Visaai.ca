# Performance report

**Reporting date:** 2026-08-21.
**Status: baseline captured for the public surface; no load test on this branch.**

## What was measured

Production `visaai.co`, 2026-08-20, via `curl -w`:

| URL | Status | Total time | Bytes |
|---|---|---|---|
| `/` | 200 | 0.330 s | 67,671 |
| `/robots.txt` | 200 | 0.114 s | 503 |
| `/sitemap.xml` | 200 | 0.210 s | 115,383 |
| `/applications/new` | 200 | 0.206 s | 67,671 |
| `/pricing` | 200 | 0.257 s | 101,186 |

Single-sample, one location, no cache control — a smoke baseline, not a
distribution. Treat as "the origin is up and responds in the low hundreds of
milliseconds", nothing finer.

## What changed, and its expected effect

**`/pricing` moved from `force-dynamic` to `revalidate: 300`.** Previously every
request re-fetched the quote API with `cache: 'no-store'`, so TTFB included a
full API round trip on every hit. Now the cached render serves while the refresh
happens behind it. This should reduce p95 TTFB on the page materially and
removes a hard dependency of page render on API availability. **Not
re-measured** — it needs a deploy.

**New `/visas*` routes** are `revalidate: 3600`, and
`/visas/{country}/{visa}` is statically generated for publishable pages via
`generateStaticParams`. Verified in the build output.

**Sitemap grew 90 → 180 URLs.** Generated with `revalidate: 3600` rather than
per-request, and it degrades to the static entries if the registry is
unreachable, so a database problem cannot take the route down.

## Known weight problems, not fixed here

From the SEO baseline, each verified in the code:

- a **205,280-byte** 512×512 PNG declared as a favicon
- the wordmark requested through `next/image` at `w=3840`, returning **PNG, not
  WebP/AVIF** (51,284 bytes)
- three font families loading `subsets: ['latin']` **only**, across 15 locales
  including `ar`, `ur`, `hi`, `zh`, `zh-TW`, `ja`, `ko` — those locales get no
  subset for their own script

All three are asset-pipeline fixes independent of this branch's work, and all
three affect LCP on every page.

## Core Web Vitals

**Not measured.** Requires either field data (CrUX, needs Search Console
ownership) or a credentialed lab run. The SEO baseline records this as blocked
with the exact manual steps. **No CWV number is claimed anywhere in this
program's output.**

## Database

New indexes, each justified by a specific query in this branch rather than added
speculatively:

| Index | Serves |
|---|---|
| `visa_countries_slug_idx` | page lookup by URL slug |
| `visa_countries_support_idx` (partial) | published-country listing |
| `visa_types_country_active_idx` (partial) | country hub listing |
| `visa_sources_due_idx` (partial, nulls first) | the sync worklist |
| `visa_source_versions_one_active_idx` (partial unique) | active-version pointer + the one-active invariant |
| `visa_source_changes_pending_idx` (partial) | review queue |
| `ai_usage_events_cache_idx` (partial) | cache-effectiveness reporting |

Every one is partial where the query is partial, so the index covers the rows
the query actually reads.

The public read path uses an anon client with **no cookie store**
(`lib/visa-registry.ts`), specifically so these routes stay statically
renderable — `cookies()` would opt every one of them out of caching for nothing.

## Not done

- **No load test.** Requires a staging environment; none is configured on this
  branch. Government sites must never be load-tested.
- **No API latency percentiles.** `ai_usage_events` records per-call latency
  once traffic flows; there is no post-migration traffic yet.
- **No bundle-size delta.** The new routes add three pages and two components,
  all server components with no client JavaScript, so the client bundle should
  be unchanged — stated as an expectation, not a measurement.
