# Document and source versioning

## Never silently overwrite

A government page is never updated in place. Each fetch that differs inserts a
**new** `visa_source_versions` row; the previous row is marked
`superseded_by` and loses `is_active`. Nothing is deleted.

Without the old version there is no diff, and without a diff a fee change is
indistinguishable from a CSS refresh.

## The two hashes

| Column | Over | Purpose |
|---|---|---|
| `raw_sha256` | bytes as served | forensic — proves what was received |
| `normalized_sha256` | extracted, boilerplate-stripped text | the **only** hash that may raise a change event |

Hashing raw bytes does not work on real government sites. CSRF tokens, asset
fingerprints, cache-busters and "page last reviewed" widgets change per request,
so every nightly run would report a change on every page. A monitor that cries
wolf nightly is one nobody reads, and the night a real eligibility rule changes
it is indistinguishable from the noise.

`normalize.ts` strips what a reader would not see and keeps what a caseworker
would: amounts, durations, form identifiers, list structure. Structure comes
from the tags — source whitespace is collapsed first, so a CMS reflowing a
paragraph does not read as a line removed and two added.

Idempotent by test: `normalize(normalize(x)) === normalize(x)`. An extractor
whose second pass differed would report a change against its own previous run.

## Promotion lifecycle

```
detected → parsed → validated → tested → approved → active
                                    ↘ rejected / failed
```

`visa_source_changes` holds the queue. A new version is inserted **inactive**;
the previous, reviewed version keeps serving until the change is promoted. A
stale-but-reviewed requirement beats a fresh-but-unreviewed one.

### Classification

| Class | Meaning | Auto-promotes |
|---|---|---|
| `cosmetic` | identical after normalization, or reordered | yes |
| `editorial` | wording changed, no requirement touched | yes |
| `material` | obligation, amount, duration, form id or eligibility changed | **no** |
| `structural` | page moved or restructured; mass deletion | **no** |

Conservative by design: a false `material` costs a reviewer two minutes, a false
`cosmetic` ships a stale requirement to every applicant.

A mass deletion is `structural` regardless of wording — it usually means a
restructure or a partial fetch, and either way a person should look before
requirements are re-derived.

A 200 that normalizes to no text is a **parse error**, not a change. Treating it
as a change would raise a review item claiming the government deleted the page.

### Escalation reasons

The queue records *why* a human is needed, not just that one is: obligation
wording changed, eligibility wording changed, a monetary amount changed, a
duration or deadline changed, an official form identifier changed, a procedural
requirement changed, a document requirement changed, a route may have been
discontinued, or N of M lines disappeared.

## Cached files

When `redistribution = 'permitted'`, bytes go to object storage and
`storage_path` is set. `NULL` is the normal case and is not an error: metadata
plus a link to the official page is the default posture, not a degraded one.

Relational BLOBs are not used. The database holds metadata, provenance, hashes
and relationships; object storage holds permitted files.

## Dependent revalidation

When a version is promoted, requirements citing the superseded version must be
re-verified. Their `source_version_id` still points at the old version, which is
correct — that IS where they were read from — and `last_verified_at` becomes
stale until someone re-reads them against the new version.

## Related

- `visa_source_checks` — per-run outcome per source (ok / changed / unavailable
  / blocked / parse_error / redirected), the input to freshness SLAs and
  persistent-failure alerts.
- `visa_sync_runs` — one row per morning run with the metric counters.
