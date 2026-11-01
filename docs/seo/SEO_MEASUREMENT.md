# SEO measurement

## What can be measured today

| Metric | Source | Available now |
|---|---|---|
| indexable URL count | `sitemap.xml` | **yes** — 180 |
| publishable visa pages | `select count(*) from visa_publishable_pages` | **yes** — 0 |
| canonical correctness | `alternates.test.ts` (9 tests) | **yes**, in CI |
| crawler access | UA-header probe per bot | **yes**, verified |
| server-rendered content | `curl` without JS | **yes**, verified |
| structured data validity | Google Rich Results Test | manual |

## What is blocked, and on what

| Metric | Blocked on | Manual steps |
|---|---|---|
| impressions, clicks, CTR, position | **Search Console ownership** | see below |
| index coverage | same | |
| Core Web Vitals field data | same (CrUX via GSC) | |
| Bing metrics | Bing Webmaster ownership | import from GSC once GSC exists |
| AI referral sessions | analytics segmentation not built | see `AI_SEARCH_GEO_AEO.md` |
| backlink profile | no tool with a licence | — |

**No index count, position or traffic figure appears anywhere in this
program's output**, because none was observed. There is currently no
verification tag in the repository or on the live site for Google, Bing or
Yandex, so there is no baseline at all — only the technical one.

### Search Console setup (manual, requires domain control)

1. `search.google.com/search-console` → add property → **Domain** property for
   `visaai.co` (covers all subdomains and protocols; the URL-prefix variant
   would need a separate property per host).
2. Verify by DNS TXT record at the registrar. Prefer this over the HTML-file or
   meta-tag methods — it survives a redeploy.
3. Submit `https://visaai.co/sitemap.xml`.
4. URL-inspect one page per template: `/`, `/pricing`, `/visas`,
   `/visas/canada`. Confirm the rendered HTML Google sees contains the content,
   and that the canonical Google *chose* matches the one declared — a mismatch
   is the symptom the canonical bug produced.
5. Record the first 28-day window as the true baseline. It will be near zero
   and that is the correct starting point.
6. Bing Webmaster Tools supports importing the verified GSC property; do that
   rather than verifying separately.

## Queries to run once data exists

```sql
-- publishable pages, which is the SEO-relevant count
select count(*) from visa_publishable_pages;

-- why the rest are not publishable
select country_code, official_name, official_requirement_count, source_count
from visa_publishable_pages;  -- rows here PASS; compare against visa_types

-- freshness actually backing the lastmod dates
select c.name, c.last_verified_at,
       count(*) filter (where s.last_success_at > now() - interval '7 days') as fresh_sources,
       count(*) as total_sources
from visa_countries c join visa_sources s on s.country_id = c.id
group by c.name, c.last_verified_at;
```

```bash
# sitemap size
curl -s https://visaai.co/sitemap.xml | grep -c '<loc>'

# crawler access — must be 200 with real content, not a login page
for ua in "OAI-SearchBot/1.4" "GPTBot/1.4" "Googlebot/2.1" "bingbot/2.0"; do
  curl -s -o /dev/null -w "$ua %{http_code}\n" -A "$ua" https://visaai.co/visas/canada
done

# canonical per locale — each must name ITS OWN url
for l in "" "fr/" "de/" "ja/"; do
  curl -s "https://visaai.co/${l}visas/canada" | grep -o 'rel="canonical" href="[^"]*"'
done
```

## Leading indicators, before rankings move

Rankings take weeks of recrawling. These move first and are worth watching:

1. **Pages discovered / crawled** in GSC — should rise as the 90 new URLs are
   found.
2. **Canonical chosen = canonical declared** on localized URLs — the direct
   check that the deindexing fix worked.
3. **Publishable page count** — the internal gate. It rises when requirement
   extraction runs, and it is the input to everything downstream.
4. **Crawler 200-rate per AI user-agent** at the edge — catches a WAF change
   that starts blocking `OAI-SearchBot`.

## Honest expectation

180 sitemap URLs of which ~90 are new, four country hubs of genuinely sourced
content, and zero indexable visa detail pages. That is a foundation. Traffic
from it will be small until requirement extraction fills the detail pages, and
any forecast beyond "more than zero, which is what exists today" would be
invented.
