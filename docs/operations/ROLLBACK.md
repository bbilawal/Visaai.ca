# Rollback

## Model routing

The fastest and safest lever, and the one most likely to be needed.

```bash
# In apps/api/.env on the VPS, then restart. No deploy, no code change.
AI_MODEL_NANO=gpt-4o-mini
AI_MODEL_SMALL=gpt-4o-mini
AI_MODEL_BALANCED=gpt-4o
AI_MODEL_FRONTIER=gpt-4o
```

Unset a variable to return that tier to the policy default. Partial rollback is
supported and expected — if only the `nano` tier regresses, pin only `nano`.

The legacy rates are still in `AI_MODEL_PRICES`, so metering stays correct
after a rollback rather than silently pricing at $0.

## Migrations

All five are **additive**. None drops a column, alters an existing type, or
touches a row outside the `visa_*` tables and `ai_usage_events`.

| Migration | Rollback |
|---|---|
| `20260820120000_visa_registry_core` | `drop table` the 8 `visa_*` tables + the view, cascade |
| `20260820130000_ai_usage_cache_tokens` | `alter table ai_usage_events drop column cached_input_tokens, drop column cache_write_tokens` |
| `20260820140000_visa_registry_seed` | data only; `delete from visa_countries where code in (...)` cascades |
| `20260820150000_visa_registry_rls_fix` | **do not roll back** — it closes a data-exposure defect |
| `20260820160000_visa_sources_per_visa_type` | recreate the single-column unique index, but see below |

Rolling back `20260820160000` requires deleting the duplicate `(url, visa_type)`
rows first, and doing so re-introduces the bug where a shared government page
attaches to only one visa type. Prefer forward fixes.

`country_frameworks` and every existing reader are untouched, so a full
`visa_*` teardown returns the application to its pre-branch behaviour.

## Web routes

`/visas*` renders from the registry. If the registry is unreachable:

- the **sitemap** degrades to its static entries (wrapped in try/catch) rather
  than 500ing the route
- the **pages** will error, since a visa page with no data has nothing to show

To disable them without a deploy, remove `/visas` from the public-route list in
`proxy.ts` — they revert to redirecting to `/login`. That is a code change but a
one-line one. A cleaner lever would be a feature flag; the flag system exists
(`modules/feature-flags`) and these routes are not wired to it.

## The canonical fix

`localeAlternates` now requires a locale argument, so reverting it is a compile
error rather than a silent regression — intentional. If localized pages must be
de-indexed for a legal reason (see `docs/legal/LEGAL_REVIEW_REQUIRED.md` L-01),
do it with `robots: { index: false }` in the page's metadata, not by reverting
the canonical.

## The copy fix

`messages/claims.test.ts` fails the build if the approval or licensure claims
return. Reverting the copy requires deleting the test, which is the intended
friction — the claim was false, and it should be hard to reinstate.

## Verification after any rollback

```bash
pnpm --filter api exec jest          # expect 2916 passed
pnpm --filter web exec vitest run    # expect 352 passed
docker exec -i supabase_db_VisaAI psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  < supabase/tests/security/visa_registry_rls_test.sql
```
