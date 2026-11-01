# Programmatic SEO architecture

## The rule

**A generated page is indexable only when it is backed by verified official
data.** Enforced in SQL, not by convention:

```sql
create view visa_publishable_pages as
  ... where c.support_state = 'supported'
        and t.lifecycle_state = 'active'
  having count(active AND officially_required requirements) > 0
     and count(active sources) > 0;
```

The sitemap, the page renderer and the data-quality report all read this one
view. They cannot drift into disagreeing about which pages exist, because there
is only one definition.

A page that fails the gate still **renders** — useful to a person who lands on
it — with `robots: noindex, follow`.

## What is NOT generated

The spec is explicit that not every theoretical combination should exist, and
this is where most programmatic SEO goes wrong.

**No nationality × destination × visa matrix.** 200 nationalities × 13
researched destinations × 79 visa types is over 200,000 URLs, and VisaAI has
verified nationality-specific data for approximately none of them. (The figures
were 4 and 32 when this was written; the argument only gets stronger as the
registry grows, which is the point — the combinatorial pages multiply faster
than the verified facts behind them ever could.) Those pages would be
templated near-duplicates, which is the thin-content pattern search engines
penalise and the spec bans.

Nationality-specific pages become defensible only when a requirement carries a
nationality rule (`visa_requirements.rule` with `{fact: 'nationality', op:
'in'}`) sourced from a government page that states it. At that point the page
has materially distinct, sourced content and earns its URL. Not before.

**No filter or parameter pages.** No `?sort=`, no faceted combinations.

**No "best visa for X" pages.** VisaAI cannot rank government programs against
each other without making a recommendation it is not authorised to make.

## Route families

| Route | Cardinality today | Gate |
|---|---|---|
| `/visas` | 1 | always |
| `/visas/{country}` | 4 | country not `unsupported` and has visa types |
| `/visas/{country}/{visa}` | 32 | `visa_publishable_pages` |

× 15 locales.

Country hubs publish on a **weaker** gate than detail pages, deliberately: a
verified authority, a verified visa catalog in the government's own wording, and
verified official links is a complete and useful page. It makes no claim about
requirements, so it needs no requirement data.

## Quality gate coverage

The spec's §37 checklist, against what the view and the templates enforce:

| Requirement | Enforced by |
|---|---|
| valid country | FK + `support_state` |
| valid active visa type | `lifecycle_state = 'active'` |
| sufficient unique official information | ≥1 official requirement (view) |
| official source(s) | ≥1 active source (view) |
| unique useful title | generated from `official_name` + country, unique by construction |
| useful description | generated from the requirement count and authority |
| canonical URL | `localeAlternates(path, locale)` |
| last verified date | `VerifiedStamp`, renders "not yet verified" rather than a fake date |
| correct language variant | locale-aware canonical + hreflang |
| internal links | breadcrumbs up, siblings across, funnel out |
| no placeholder text | a visa with no requirements says so explicitly rather than rendering an empty list |
| no hallucinated facts | every field is a database column sourced to a URL |

Two remain unenforced in CI: **no conflicting requirements** (needs requirement
data to conflict) and **no duplicate titles across the corpus** (a crawl-time
check; the generation scheme makes collisions structurally unlikely but does not
prove it).

## Current state

**Zero indexable detail pages.** `visa_publishable_pages` returns no rows,
because no requirement has been extracted and reviewed. 4 country hubs × 15
locales publish; 32 detail pages × 15 locales render noindex.

This is the gate doing its job. The number goes up when requirement extraction
runs, not when someone lowers the bar.

## Scaling path

1. Extract requirements for one visa type; review; it becomes publishable.
2. Repeat per visa type — 32 detail pages available from the current registry.
3. Add destinations to `data/official-sources/`, regenerate the seed.
4. Nationality-specific pages only where a sourced nationality rule exists.

Growth is bounded by verified data, which is the intended constraint.
