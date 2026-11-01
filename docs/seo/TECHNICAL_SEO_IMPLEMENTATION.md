# Technical SEO implementation

Changes made 2026-08-20/21. Baseline they are measured against:
`SEO_AUDIT_BASELINE.md`.

## 1. Locale canonicals — the deindexing bug

`apps/web/lib/seo/alternates.ts`

`localeAlternates()` returned `canonical: path` with no locale prefix, so
`/fr/pricing`, `/de/pricing` and twelve others all emitted
`<link rel="canonical" href="/pricing">`. That is an instruction to index only
the English page and drop the rest — 42 URLs (14 non-default locales × 3 routes)
pointing away from themselves.

It also contradicted the hreflang block in the same `<head>`, which declared the
15 URLs equivalent alternates. Google resolves that conflict by discarding the
hreflang cluster, so the localized pages lost their canonical *and* their
language targeting.

Fixed: the function requires a locale and canonicalises each page to its own
URL. The four callers became `generateMetadata` so they receive it from `params`
— no `headers()` read, so static rendering is unaffected.

**Verified live** on a local build: canonical on `/fr/visas/canada` is
`https://visaai.co/fr/visas/canada`.

Locked by `lib/seo/alternates.test.ts` (9 tests), including the invariant that
was violated: canonical always equals the page's own hreflang entry.

## 2. Public visa pages

Three new route families, all rendering from the sourced registry:

| Route | Rendering | Indexable |
|---|---|---|
| `/visas` | ISR, 1h | yes |
| `/visas/{country}` | ISR, 1h | yes |
| `/visas/{country}/{visa}` | SSG for publishable, ISR otherwise | **only when publishable** |

`lib/visa-registry.ts` reads through an anon Supabase client with **no cookie
store**, specifically so these routes stay statically renderable — `cookies()`
would opt every one of them out of caching for nothing.

## 3. The publication gate

`visa_publishable_pages` (SQL view) is the single definition of an indexable
visa page: supported country, active visa type, ≥1 active **official**
requirement, ≥1 active official source.

The sitemap and the renderer both read it, so they cannot drift into
disagreeing. A page failing the gate renders with `robots: noindex, follow` —
still useful and followable for a person who lands on it, not offered to an
index.

**The view currently returns zero rows.** No requirement has been extracted from
a source version and reviewed yet, so every visa *detail* page is noindex today
while country *hub* pages publish. That is the programmatic-SEO quality gate
working, not a gap — mass-indexing near-empty pages is precisely the thin-content
behaviour the spec bans.

## 4. Sitemap

`apps/web/app/sitemap.ts`, rewritten.

| Before | After |
|---|---|
| 90 URLs | **180 URLs** |
| `lastModified: new Date()` on every entry | real verification dates from the data; **no `lastmod` at all** where the change date is unknown |
| `/applications/new` absent | present |
| no `x-default` | `x-default` on every entry |

The old behaviour was proven at runtime: two fetches of the live sitemap
returned an identical `2026-08-20T17:06:08.145Z`, so every deploy reset
freshness on all 90 URLs simultaneously. A `lastmod` that moves when nothing
changed is noise, and a crawler that learns the dates are meaningless stops
using them — including on the day a page really did change. Omitting it is
explicitly better than inventing one.

The registry read is wrapped in try/catch: a database problem costs the visa
URLs, not the whole route.

## 5. robots.txt

`/visas` allowed. `host` added. `SITE_URL` deduplicated — it had **different
fallbacks** in robots and sitemap (`http://localhost:3000` vs
`https://visaai.co`), so with `NEXT_PUBLIC_SITE_URL` unset the two files
disagreed about what site this is.

AI-crawler groups added — see `AI_SEARCH_GEO_AEO.md`.

## 6. proxy.ts — the bug that would have voided all of the above

`/visas` 307'd logged-out visitors to `/login`. Verified with `curl -L` before
the fix: the redirect chain ended at `/login` with a 200.

A public page that redirects a logged-out visitor to login is invisible to
search — the crawler follows, indexes the login page, and every one of these
URLs is worth nothing. The public-route list in `proxy.ts` is the entire gate, so
a route that is public by intent is private by default until it appears there.

## 7. `/pricing` soft-404 risk

`force-dynamic` + `cache: 'no-store'` meant every request re-fetched the quote
API with nothing to fall back on. `getQuotes()` swallows failures and returns
`[]`, so an API blip during a crawl published a **successful page whose pricing
table was replaced by a one-line "unavailable" string**.

Now `revalidate: 300`. Public quotes carry no user context, so the cached render
is both correct and strictly better.

## 8. Structured data

`BreadcrumbList` on country and visa pages; `ItemList` on `/visas`. Both
describe exactly what is visible on the page. No rating, review or offer schema
— nothing is claimed that a user cannot see.

Pre-existing `Organization` and `WebApplication` in the locale layout are
untouched.

## Verification (local production build, local Supabase)

```
/visas, /visas/canada, /visas/australia, /fr/visas/canada    200
Canada hub raw HTML: government visa names + 18 canada.ca links
canonical on /fr/visas/canada: https://visaai.co/fr/visas/canada
OAI-SearchBot, GPTBot, Googlebot, bingbot                    200, full content
sitemap                                                      180 URLs, lastmod 2026-08-20
JSON-LD                                                      BreadcrumbList, ItemList
```

## Not done

- **`hreflang` is emitted only where `localeAlternates` is called** — the four
  pages plus the new visa routes. `/`, `/login`, `/signup` still emit none
  despite the sitemap declaring 15 alternates for each; a one-sided declaration
  is discarded.
- **Marketing and legal pages serve English under `lang="fr"` etc.** The funnel
  is translated; `/pricing`, `/privacy`, `/terms` are not. Fixing the canonical
  without fixing this converts a deindexing bug into 42 duplicate English pages
  — they must be sequenced together. See `INTERNATIONAL_SEO.md`.
- **No Search Console property.** No verification tag exists in the repo or on
  the live site, so there is no index or traffic baseline at all.
