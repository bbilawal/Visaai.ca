# SEO results

**Date:** 2026-08-21. Baseline: `SEO_AUDIT_BASELINE.md` (2026-08-20).

This document separates what shipped and was verified, what needs recrawling,
and what is blocked on credentials. Nothing in the first section is a
projection; nothing in the second is claimed as a result.

---

## A. Shipped and verified now

Verified against a production build of this branch running on local Postgres
plus the seeded registry.

### Defects fixed

| | Before | After |
|---|---|---|
| Localized canonicals | all 15 locales → the English URL (**42 URLs told to deindex**, hreflang cluster discarded) | each page canonical to its own URL |
| `/visas*` for logged-out visitors | 307 → `/login` (verified with `curl -L`) | **200 with content** |
| `/pricing` when the API blips | 200 with the pricing table replaced by "unavailable" | cached render serves, `revalidate: 300` |
| `sitemap lastmod` | build time on every entry (proven: two fetches, identical `2026-08-20T17:06:08.145Z`) | real verification dates; **omitted** where unknown |
| `/applications/new` in sitemap | absent | present |
| `SITE_URL` | two files, **different fallbacks** | one module |
| every 404 / error document | no `lang`, no `<title>` (axe: 2× `serious`) | root layout, `not-found`, `global-error` |

### Counts

| | Before | After |
|---|---|---|
| Sitemap URLs | 90 | **315** |
| Public content pages (non-app) | 0 | **5 paths × 15 locales** |
| Country hub pages | 0 | **4 × 15 locales** |
| Verified official source URLs surfaced | 0 | **111** |
| JSON-LD types | Organization, WebApplication | + **BreadcrumbList, ItemList** |
| Public routes in the a11y gate | 7 | **8** |

### Verified behaviours

```
/visas, /visas/canada, /visas/australia, /fr/visas/canada     200
Canada hub raw HTML: government visa names + 18 canada.ca links
canonical on /fr/visas/canada  = https://visaai.co/fr/visas/canada
OAI-SearchBot, GPTBot, Googlebot, bingbot                     200, full content
sitemap                                                       180 URLs, lastmod 2026-08-20
a11y (axe WCAG 2.0/2.1/2.2 A+AA, light and dark)              /visas passes
```

### Content and data

4 country hubs backed by 32 visa types and 111 verified government URLs, every
one fetched on 2026-08-20 from a government-owned domain. Every page shows a
last-verified date and an explicit disclaimer that VisaAI is not a government
body and cannot decide or guarantee an outcome.

---

## B. Requires recrawling — NOT results

These follow from section A but cannot be observed yet. Weeks, not days.

- discovery and indexation of the ~90 new URLs
- re-indexation of the 42 previously self-deindexing localized URLs
- whether Google's *chosen* canonical now matches the declared one
- any ranking movement for any query
- any AI-answer citation

**No ranking, impression, click or index-count figure is claimed anywhere in
this program's output, because none was observed.** There is no Search Console
property, so there is not even a baseline to compare against.

---

## C. Blocked on credentials or data

| Blocked | On | Where the steps are |
|---|---|---|
| Search Console property, sitemap submission, index coverage, CWV field data | domain DNS control | `SEO_MEASUREMENT.md` |
| Bing Webmaster | same (import from GSC) | same |
| AI referral measurement | analytics segmentation not built | `AI_SEARCH_GEO_AEO.md` |
| Indexable pages for AU and 4 US routes | **authority WAF allowlisting** | `docs/operations/SOURCE_ACCESS.md` |

### The gating item — now partially cleared

`visa_publishable_pages` returned **zero rows** when this document was first
written. It now returns **nine**: Canada's visitor visa, six UK routes and two
US routes, carrying 166 sourced requirements between them.

The remaining 23 visa types are still `noindex`, and the reason has changed from
"nobody has extracted them yet" to something more stubborn — see
`docs/operations/SOURCE_ACCESS.md`. 56 of 134 sources return HTTP 403 to the
monitor because their WAFs block self-identified crawlers, and VisaAI does not
disguise itself to get past that.

This is the programmatic-SEO quality gate working as specified, not a bug and
not an oversight. Mass-indexing pages that list no sourced requirements is
exactly the thin-content behaviour the spec bans. The count rises when
extraction runs — not when someone lowers the bar.

Sourced requirements for a single visa type would move that page to indexable
and unblock the largest query families in `KEYWORD_CONTENT_MAP.md`. It is the
highest-value next action for search, by a wide margin.

---

## D. Backlog, in priority order

1. Requirement extraction (unblocks everything above)
2. Translate marketing and legal pages, or noindex untranslated locale variants
   — see `INTERNATIONAL_SEO.md`; the canonical fix made these eligible to be
   indexed as duplicates rather than ineligible as false duplicates
3. `hreflang` on `/`, `/login`, `/signup` (sitemap declares 15 alternates; the
   pages emit none — one-sided declarations are discarded)
4. Asset weight: a 205KB PNG favicon, a `w=3840` PNG wordmark, latin-only font
   subsets across 15 locales including 7 non-latin scripts
5. Search Console setup
6. AI referral segmentation
