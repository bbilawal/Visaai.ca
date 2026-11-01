# Replaying the migration chain from empty

`supabase db reset` used to fail at
`20260821120000_ca_visitor_visa_requirements.sql`, and every requirement
migration after it failed the same way. This describes the cause and the fix.

## The cause

`visa_requirements.source_version_id` is `not null` on purpose: a claim about
what a government demands is bound to the exact page version it was read from.
The 195 generated requirement migrations resolve that binding with a subquery on
the source's currently-active version.

Nothing in the chain ever created a version row. Versions come from the sync job
at runtime. So the chain only ever succeeded on a database that had already
synced — which every developer's database had, and a fresh one never does.

The schema was replayable. The data was not.

## The fix

Two migrations, no edits to the 195 generated files beyond one uniform change to
their closing assertion.

**`20260820170000_visa_source_versions_bootstrap.sql`** carries 306 fixtures —
the active source versions exported from production on 2026-09-04. They are real
fetch records: every hash is the hash of bytes an authority actually served.

It plants them through an `after insert` trigger on `visa_sources` rather than a
list of inserts, because sources are not all registered by that point in the
chain. 72 later migrations register more, each followed by the requirement
migrations that bind to them. A one-shot insert covers only what exists when it
runs — which is exactly how the first attempt at this fix failed, at
`20260821210001`.

**`20260903130000_drop_source_version_fixtures.sql`** removes the fixtures, both
triggers and both functions once the last requirement migration has run. The
chain therefore ends with none of it installed.

Dropping it matters. Left in place, the trigger would fire when the sync
registers a genuinely new source, and a URL that matched a fixture would be
handed a version dated 2026-08-25 that nobody fetched in this deployment. The
fixtures are evidence of what production once fetched; they are not a substitute
for fetching.

## Why not just write the version rows

Because `raw_sha256` and `normalized_sha256` are `not null`, and
`normalized_sha256` is the value a policy-change event keys on. Inventing a hash
for a page never retrieved does not degrade gracefully: it either suppresses a
real change or announces a fake one. Exporting hashes production genuinely
recorded is a different act from making them up.

## What replay does not reproduce, and why that is correct

79 of 385 registered sources have no version anywhere, production included.
Their authorities refuse the fetch: `migri.fi` and `immi.homeaffairs.gov.au`
answer the VPS with 403, `robots.txt` included. There is nothing to export.

Those sources still have requirement migrations written against them. During a
replay, each such row is recorded in `public.visa_requirement_bootstrap_skips`
and skipped, and the migration's closing assertion downgrades from `exception` to
`warning` — but only while the fixture table exists, which is only during a
replay. In normal operation a missing version still aborts the migration, which
is what it should do: it means the sync has not run and the extraction is
premature.

`visa_requirement_bootstrap_skips` outlives the chain deliberately. An empty
requirement list should be legible as "we could not read this authority", not as
"this route has no rules".

## The Finland and Australia gaps are already known

15 of 192 visa types in production have zero requirements — 10 Australian, 5
Finnish — and both were documented before this work:

- `20260826300000_finland_is_preview_not_supported.sql` states it outright ("5
  visa types, 12 registered sources, 0 source versions, 0 requirements") and
  demotes Finland to `preview` for exactly that reason.
- `docs/visa-data/GLOBAL_COVERAGE_EXCEPTIONS.md` lists the Australian routes
  against "56 consecutive failures; robots disallows".

So the replay work did not discover the gap. What it makes visible is narrower:
the five `promote_fi_*` migrations assert a publication state that **production
never reached** — they failed there too — and nothing recorded that, because
production applies migrations by piping files into `psql` and keeps no
`supabase_migrations.schema_migrations` ledger. A file that rolled back left no
trace, and the chain carried on.

Those five assertions are now guarded the same way: fatal in normal operation,
downgraded to a warning while the fixture table exists. That is faithful to what
production actually is, rather than to what the migration expected.

## Regenerating the fixtures

```bash
scripts/visa-registry/export-source-versions.sh
```

Read-only against production. Re-run it when the registry gains sources a fresh
database should start with — not on every sync. A stale fixture set is harmless:
planting is guarded on the source having no version at all, and the sync
supersedes anything it plants.
