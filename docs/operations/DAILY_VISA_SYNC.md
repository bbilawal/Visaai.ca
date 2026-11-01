# Daily visa source synchronization

`apps/api/src/modules/visa-sync/` — 71 tests.

## What it does

Checks every due official source, versions what it finds, and files a review
item for anything that materially changed. It **never edits a live
requirement**: the most it can do is queue a change for a human, or auto-promote
one it has classified as editorial.

## Components

| File | Responsibility |
|---|---|
| `source-fetcher.ts` | safe egress — SSRF controls, redirect handling, caps |
| `robots.ts` | RFC 9309 evaluation, per URL, per run |
| `normalize.ts` | stable text extraction, hashing, change classification |
| `visa-sync.service.ts` | orchestration and database writes |

## The run

1. Open a `visa_sync_runs` row so every check belongs to a run.
2. Select active sources, **oldest check first** — a source that keeps failing
   goes to the back of the queue as soon as it is attempted, so it cannot
   starve the rest.
3. Per source:
   - fetch `robots.txt` (once per host per run), evaluate for this exact URL;
     `disallowed` → record and stop
   - politeness delay since the last request **to that host**
   - fetch with the egress controls
   - normalize; empty → `parse_error`
   - hash; unchanged → record an `ok` check, **no version row**
   - changed → insert an inactive version, classify, queue the change
   - editorial → auto-promote; material or structural → wait for a human
4. Close the run with the counters.

## Three invariants

**A government edit never reaches an applicant unreviewed.** New versions are
inserted inactive. Getting this backwards would let a scraper silently rewrite
what VisaAI tells people a government demands.

**History is append-only.** An unchanged page writes a check row, not a version
row — versions are for content that differs; proof of liveness is what
`visa_source_checks` is for.

**One source's failure degrades one source.** Across 134 source rows on four
governments, a 503 must not cost the others their check.

## Scheduling

Not yet wired to a scheduler. `VisaSyncService.run()` is callable and tested;
what remains is a cron entry point and an admin trigger.

Recommended: daily, early morning in the deployment's timezone, configurable.
Government sites publish overnight and a morning run means a reviewer sees the
queue at the start of their day.

**Single-instance caution:** the app has no separate worker entry point, so
every instance registers every schedule. Scaling to two instances would run the
sync twice. Fix before scaling: a dedicated worker process, or a database
advisory lock around the run.

## Metrics

`visa_sync_runs`: `sources_checked`, `ok_count`, `changed_count`,
`unavailable_count`, `blocked_count`, `parse_error_count`, duration, status.
`visa_source_checks` carries per-source status, HTTP status, duration and error.

```sql
-- last 7 runs
select started_at, status, sources_checked, ok_count, changed_count,
       unavailable_count, blocked_count, parse_error_count,
       extract(epoch from (finished_at - started_at))::int as seconds
from visa_sync_runs order by started_at desc limit 7;

-- sources failing persistently (alert threshold)
select country_id, source_url, failure_streak, last_success_at
from visa_sources where failure_streak >= 3 and active order by failure_streak desc;

-- stale against SLA
select c.name, s.source_url, s.last_success_at, s.freshness_sla
from visa_sources s join visa_countries c on c.id = s.country_id
where s.active and (s.last_success_at is null
   or s.last_success_at < now() - s.freshness_sla);

-- review queue
select state, classification, count(*)
from visa_source_changes
where state in ('detected','parsed','validated','tested')
group by state, classification;
```

## Alerts to configure

| Condition | Severity |
|---|---|
| a run fails outright | high |
| `failure_streak >= 3` on any source | medium |
| any country past its freshness SLA | medium |
| `parse_error_count > 0` | medium — a VisaAI bug, not the authority's |
| a `material` change pending review > 48h | high — a real rule may have changed |

## Politeness

- `robots.txt` per URL per run; `Crawl-delay` honoured
- fixed delay between requests to the same host
- 403/429 → `blocked`, backed off, never retried harder
- honest User-Agent with a contact URL
- no credentials, no cookies
- **never** bypass CAPTCHA, auth, paywall or bot protection

## What is not done

- no scheduler entry point
- no admin UI for the review queue (the tables and RLS exist)
- source text is not stored unless redistribution is permitted, so the first
  diff after a fetch has no previous text to compare against and deliberately
  escalates to a human — over-escalating a first diff is the safe direction
- no requirement extraction. The sync detects and versions changes; turning a
  source version into typed `visa_requirements` rows is the next stage and is
  what moves visa detail pages from noindex to indexable.
