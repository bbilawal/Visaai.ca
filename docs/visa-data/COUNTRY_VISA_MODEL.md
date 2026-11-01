# Country and visa data model

Migrations `20260820120000_visa_registry_core.sql`,
`20260820150000_visa_registry_rls_fix.sql`,
`20260820160000_visa_sources_per_visa_type.sql`.

## What existed before

The entire notion of "which countries and visas does VisaAI support" lived in
TypeScript under `apps/api/src/strategies`: four country strategy classes, a
Schengen member array, six visa program classes. The only visa-requirement table
was `country_frameworks(country_code, visa_type, purpose, requirements_json)` —
one row, seeded in the initial migration, requirements as an untyped blob.

Three things were impossible in that shape:

1. **Provenance.** Nothing recorded where a requirement came from, so no
   requirement could be traced to the page that mandates it and no page could
   show a defensible "last verified" date.
2. **Versioning.** When a government replaced a form the old text was gone. No
   history means no diff, and no diff means no change detection.
3. **Query.** A catalog expressed as classes cannot be joined, counted,
   validated in SQL, or turned into public pages.

`country_frameworks` is **left in place and untouched.** Live paths read it
(`intake/graphs/nodes/load-framework.ts`, `forms/form-catalog.ts`,
`vri/graphs/nodes/load-vri-data.ts`, matching, billing). Migrating those readers
is a separate staged change; breaking them here would take the product down for
a schema improvement.

## Tables

```
visa_countries ──┬── visa_types ──┬── visa_requirements ──┐
                 │                │                       │
                 └── visa_sources ┴───────────────────────┐│
                          │                               ││
                          ├── visa_source_versions ◄──────┘│  (provenance,
                          │        │                       │   NOT NULL)
                          │        └── visa_source_changes ─┘  (promotion queue)
                          └── visa_source_checks              (per-run outcome)

visa_sync_runs        one row per morning run
visa_publishable_pages  VIEW — the only definition of an indexable page
```

### `visa_countries`

ISO 3166-1 alpha-2, or an uppercase pseudo-code for a bloc that issues a shared
authorization (`is_bloc`), so callers never treat `SCHENGEN` as a nationality.
Carries the immigration authority and the foreign-affairs authority separately
because they differ in most jurisdictions, plus the official visa index and any
eVisa/ETA portal. `slug` is stored rather than derived so a rename never breaks
a live URL.

`jurisdiction_note` exists for contested classifications. VisaAI models the
**entry rule as the controlling authority publishes it** and makes no
sovereignty claim; this column records that framing so it is visible rather than
implied.

### `visa_types`

`visaai_id` is a stable human-readable identifier (`au-visitor-visa-subclass-600`),
deliberately not the uuid — a uuid in a URL or a test fixture tells a reader
nothing, and re-seeding must not churn identifiers that pages are indexed under.

`official_name` is the authority's exact wording and is quoted to users, so it
is never a VisaAI paraphrase. `official_code` is a **single** code; a route with
several (US family: IR1, CR1, F1, F2A, F2B, F3, F4) stores NULL and puts the
individual codes in `aliases`. **A missing code is a fact; a fabricated one is a
defect.**

`category` is a closed CHECK list. Adding a category is a migration, which
forces "does an authority actually offer this?" to be answered once rather than
per row.

### `visa_sources`

Registry of official pages VisaAI monitors. `authority_rank` 1–5 spans
immigration authority → other official government source; **anything above 5 is
not an official source and cannot be stored here.** Third-party sites may help
*discover* an official URL and may never be cited as one.

`canonical_url` is what VisaAI links and cites; `source_url` is what the fetcher
retrieves. They differ when an authority serves a versioned PDF from a stable
landing page.

Unique on `(source_url, coalesce(visa_type_id, sentinel))`, not on `source_url`
alone. One authority page routinely covers several visas — IRCC's eligibility
page covers the visitor visa and business visitors; GOV.UK's Standard Visitor
page covers tourism, business and study. A global unique index silently left the
second claimant with zero sources, which the generated coverage matrix caught as
five phantom "no official source registered" failures.

### `visa_source_versions`

Immutable snapshots. **Two hashes, deliberately.** `raw_sha256` is the bytes as
served (forensic). `normalized_sha256` is the extracted, boilerplate-stripped
text and is the **only** hash that may raise a change event — without the split,
every nightly run reports a policy change on every page that stamps a nonce.

`extractor_version` is stored because a parser upgrade changes normalized text
without the government changing anything, so the diff engine must compare like
with like.

A partial unique index allows exactly one `is_active` version per source.

### `visa_requirements`

`source_version_id` is **NOT NULL** — a requirement with no provenance is
structurally impossible, which is the point of the whole migration.

`kind = 'recommended'` is a separate kind rather than a boolean, and a CHECK
constraint forces `officially_required = false` for it. A template cannot render
VisaAI's advice as a government rule by forgetting a flag.

`rule` holds the conditional expression evaluated by
`apps/api/src/modules/visa-rules/` — data, not TypeScript conditionals, so it
can be validated on write, diffed against a source version, tested, and
explained to the user as the reason a document appeared.

### `visa_publishable_pages`

The single definition of an indexable visa page: supported country, active visa
type, ≥1 active **official** requirement, ≥1 active official source. The sitemap,
the page renderer and the data-quality report all read this view, so they cannot
drift into disagreeing about which pages exist.

## RLS

| Table | anon | authenticated | admin |
|---|---|---|---|
| `visa_countries`, `visa_types` | read | read | read |
| `visa_sources` (active) | read | read | read |
| `visa_requirements` | **`status='active'` only** | same | all |
| `visa_source_versions`, `_checks`, `_changes`, `visa_sync_runs` | — | — | read |

No role has INSERT/UPDATE/DELETE anywhere. Writes are service-role only, from
migrations and the sync job. Verified by
`supabase/tests/security/visa_registry_rls_test.sql`, which also asserts an
admin JWT cannot write directly.

## Current contents

4 countries, 32 visa types, 134 official source rows (111 distinct URLs), and
**166 active requirements across 9 visa types**. See
`docs/testing/COUNTRY_VISA_COVERAGE.md` — regenerate rather than trusting these
numbers.

The other 23 visa types have no requirements, and the gate is doing exactly what
it should: 13 are `BLOCKED BY OFFICIAL SOURCE` because the authority's WAF
returns 403 to the monitor (see `docs/operations/SOURCE_ACCESS.md`), and the
rest await extraction. A requirement exists only after extraction from a
specific source version and human review.

## Seeding

`data/official-sources/priority-destinations.json` is the input of record;
`scripts/visa-registry/generate-seed.mjs` is the only thing that writes the seed
migration. Hand-written SQL would break the link between a stored URL and the
URL someone actually verified the moment anyone edited it.
