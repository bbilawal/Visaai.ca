# VisaAI — SEO Baseline Audit (PRE-CHANGE)

**Baseline date: 2026-08-20.**
**Measurement window: 2026-08-20T17:0x UTC → 2026-08-21T0x UTC (single agent session).**
**Target: `https://visaai.co/` · Repo: `/Users/bilawalmuzaffar/Desktop/VisaAI/VisaAI` (web app at `apps/web`).**

This document is the **pre-change baseline**. Nothing in it is a recommendation and nothing
in it has been acted on. Every figure carries the URL or file that produced it. Where a
measurement required a credential or a tool that was not available in this session, it is
marked **BLOCKED** with the exact manual steps to close it.

---

## 0. Toolchain used, and its limits (read this before trusting any number)

**No shell/`curl` was available in this session.** Every live figure below was obtained over
HTTP through one of four fetchers. This constrains what could be measured and how, and the
constraint is stated inline on every affected item.

| Tool | What it gave | Known limitation |
|---|---|---|
| `WebFetch` (agent fetcher) | Rendered body text, headings, `<a href>` values | Converts HTML → markdown. **`<head>` is stripped**, so it cannot see `<title>`, `<meta>`, `<link>`. Heading *levels* are inferred from the markdown conversion, not from the DOM. |
| `api.microlink.io` free tier, with `data.<key>.selector` / `.attr` CSS rules | **Real DOM/head reads**: `<title>`, `meta[name=description]`, `link[rel=canonical]`, `link[hreflang=…]`, `script[type=application/ld+json]`, `h1`; plus `statusCode`, redirect chain, post-redirect `data.url`, `<html lang>` | Headless Chrome (JS **is** executed — see §3 caveat). A `data.*` selector rule returns **only the first match**, so it proves presence and value but cannot count elements. |
| `r.jina.ai` | Page text + a `Title:` line | Its `Title:` line prefers `og:title` over `<title>` — **do not read it as `<title>`** (this caused one false reading during the audit; corrected in §2). |
| `WebSearch` | §10 SERP observation | One location, one point in time. |

**Fetchers that failed** (recorded so they are not retried blindly):

| Attempt | Result |
|---|---|
| `https://api.allorigins.win/get?url=https%3A%2F%2Fvisaai.co%2F` | HTTP 522 |
| `https://api.allorigins.win/get?url=https%3A%2F%2Fvisaai.co%2Ffr%2Fpricing` | HTTP 500 |
| `https://api.codetabs.com/v1/proxy?quest=https://visaai.co/` | HTTP 522 |
| `https://api.codetabs.com/v1/proxy/?quest=https%3A%2F%2Fvisaai.co%2Ffr%2Fpricing` | HTTP 522 |
| `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fvisaai.co%2F&strategy=mobile&category=performance` | HTTP 429 |
| `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fvisaai.co%2Fpricing&strategy=mobile` | HTTP 429 (retry) |
| `https://api.microlink.io/?url=…&headers.user-agent=GPTBot%2F1.2&…` | HTTP 400 — free tier rejects custom request headers |

Consequence: **§1 timing, §6 Core Web Vitals and §7 crawler-UA testing are BLOCKED.** They
are the three sections that most need a shell. Exact commands to run are given in each.

---

## 1. HTTP status, redirects, and timing for the public surface

### 1a. Status + redirect chain — MEASURED

Evidence for every row: `https://api.microlink.io/?url=<encoded target>&…` (the `statusCode`,
`data.url` and redirect fields of the JSON response). Measured 2026-08-20.

| Requested URL | Status | Final URL | Redirect |
|---|---|---|---|
| `https://visaai.co/` | 200 (after redirect) | `https://visaai.co/applications/new` | **307**, 1 hop |
| `https://visaai.co/applications/new` | 200 | `https://visaai.co/applications/new` | none |
| `https://visaai.co/pricing` | 200 | `https://visaai.co/pricing` | none (empty `redirects[]`) |
| `https://visaai.co/privacy` | 200 | — | none |
| `https://visaai.co/terms` | 200 | — | none |
| `https://visaai.co/login` | 200 | `https://visaai.co/login` | none |
| `https://visaai.co/signup` | 200 | `https://visaai.co/signup` | none |
| `https://visaai.co/fr` | 200 (after redirect) | `https://visaai.co/fr/applications/new` | **307**, 1 hop |
| `https://visaai.co/fr/pricing` | 200 | — | none |
| `https://visaai.co/fr/login` | 200 | — | none |
| `https://visaai.co/de/pricing` | 200 | — | none |
| `https://visaai.co/ja/privacy` | 200 | — | none |

Locales covered: **en, fr, de, ja** (English + 3 others, as required).

**The `/` → `/applications/new` 307 is deliberate and is in source**, not an accident:

`apps/web/proxy.ts:124`
```ts
if (!user && path === '/') return redirectTo('/applications/new')
```

Every logged-out visitor — and therefore **every crawler** — is bounced off the site root.
The consequences are traced in §5 and §8.

Redirect chains are all length 1. **No chains ≥2 and no redirect loops were observed** on the
12 URLs probed. Not exhaustive: only 12 of the 90 sitemap URLs were probed.

### 1b. TTFB and total time — **BLOCKED — requires shell access (`curl`)**

No timing figure appears anywhere in this document, because none could be measured. Neither
`WebFetch` nor the microlink free tier exposes response timing, and inventing one would be
worse than leaving it blank.

Manual step to close, for each of the 12 URLs in §1a:

```bash
curl -s -o /dev/null -w '%{http_code} %{num_redirects} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total} size=%{size_download}\n' -L 'https://visaai.co/pricing'
```

Run 3× per URL and take the median; a single sample on a cold `force-dynamic` route (see §6c)
is not a measurement.

### 1c. Public routes that are reachable but absent from the sitemap — MEASURED (source)

`apps/web/proxy.ts:104-121` classifies these as public (no auth required):

- `/applications/new` — **the de-facto homepage** (307 target of `/`)
- `/intake/*`
- `/forgot-password`
- `/reset-password`
- `/privacy`, `/terms`, `/forbidden`, `/pricing`, `/login`, `/signup`

Cross-referenced against `https://visaai.co/robots.txt` (fetched 2026-08-20) and
`apps/web/app/sitemap.ts:5`:

| Public route | In sitemap? | Disallowed in robots.txt? | Net crawler state |
|---|---|---|---|
| `/applications/new` | **No** | No (explicitly `Allow`) | **Indexable, not declared** |
| `/forgot-password` | **No** | **No** | **Indexable, thin, undeclared** |
| `/reset-password` | **No** | **No** | **Indexable, thin, undeclared** |
| `/intake/*` | No | **No** (`/intake` is not in the disallow list) | **Crawlable session URLs — open crawl-budget sink** |
| `/forbidden` | No | Yes (`Disallow: /forbidden`) | Blocked ✅ |

`/intake/*` is the one to look at hard: it is per-session, unbounded in cardinality, and
nothing in `robots.txt` stops a crawler entering it.

---

## 2. Per-page head tags, headings and social markup

All values below are **verbatim reads of the served DOM** via microlink `data.*` selector
rules, measured 2026-08-20. `null` means the selector matched nothing.

> **Correction recorded for honesty.** An earlier pass in this audit read
> `https://r.jina.ai/https://visaai.co/pricing` and microlink's default `data.title`, both of
> which returned `VisaAI — AI-Powered Immigration Copilot`, and concluded every page shared one
> title. **That was wrong** — both fields prefer `og:title`. Re-reading the actual `<title>`
> element (`data.titletag.selector=title`) shows three pages *do* have unique titles. The
> duplication is real but it is in the **Open Graph / Twitter** layer, not in `<title>`.

### 2a. `<title>`, description, canonical, H1

| URL | `<title>` | `meta[name=description]` | `link[rel=canonical]` | first `<h1>` |
|---|---|---|---|---|
| `/applications/new` | `VisaAI — AI-Powered Immigration Copilot` | `Prepare stronger visa applications with AI-powered guidance.` | `https://visaai.co/applications/new` | `Where are you applying?` |
| `/pricing` | `Pricing — VisaAI` | `Take a free 3-minute eligibility assessment. No account or card required — see your options before you pay for anything.` | `https://visaai.co/pricing` | `Find out which visa you qualify for` |
| `/privacy` | `Privacy Policy — VisaAI` | `How VisaAI collects, uses, stores, and protects your personal information.` | `https://visaai.co/privacy` | `Privacy Policy` |
| `/terms` | `Terms of Service — VisaAI` | `The terms that govern your use of VisaAI.` | `https://visaai.co/terms` | `Terms of Service` |
| `/login` | `VisaAI — AI-Powered Immigration Copilot` | `Prepare stronger visa applications with AI-powered guidance.` | `https://visaai.co/login` | **`null` — no H1 on the page** |
| `/signup` | `VisaAI — AI-Powered Immigration Copilot` | `Prepare stronger visa applications with AI-powered guidance.` | `https://visaai.co/signup` | `Your AI immigration copilot` |
| `/fr/pricing` | `Pricing — VisaAI` | `Take a free 3-minute eligibility assessment. …` | **`https://visaai.co/pricing`** | `Find out which visa you qualify for` |
| `/de/pricing` | `Pricing — VisaAI` | (not probed) | **`https://visaai.co/pricing`** | `Find out which visa you qualify for` |
| `/ja/privacy` | (not probed) | (not probed) | **`https://visaai.co/privacy`** (via post-fetch `data.url`) | (not probed) |
| `/fr/login` | `VisaAI — AI-Powered Immigration Copilot` | (not probed) | `https://visaai.co/fr/login` | (not probed) |
| `/fr/applications/new` | `VisaAI — AI-Powered Immigration Copilot` | (not probed) | `https://visaai.co/fr/applications/new` | `Où faites-vous votre demande ?` |

Source of the generic values: `apps/web/app/[locale]/layout.tsx:41-42`. Source of the unique
ones: e.g. `apps/web/app/[locale]/pricing/page.tsx:13-14` (`title: \`${t('eyebrow')} — VisaAI\``).

### 2b. Duplicates across locales — MEASURED

`/pricing`, `/fr/pricing` and `/de/pricing` return **byte-identical** `<title>`, description and
`<h1>` — all three in **English**. The only things that differ are `<html lang>` and the link
prefix. Same pattern on `/ja/privacy`. See §3b for the content-level finding this implies.

### 2c. `meta[name=robots]` — MEASURED

`null` on `/pricing`, `/privacy`, `/login`, `/fr/pricing`, `/applications/new`. No page-level
robots directive anywhere on the public surface. Default (`index,follow`) applies. This is
correct for these pages, and is recorded so the absence is not mistaken for a gap.

### 2d. Open Graph / Twitter — MEASURED

Read on `/pricing` via `data.ogurl / ogdesc / twcard / twtitle / oglocale` selectors:

| Tag | Value on `/pricing` |
|---|---|
| `og:title` | `VisaAI — AI-Powered Immigration Copilot` ← **generic, not the page's own title** |
| `og:description` | `Prepare stronger visa applications with AI-powered guidance.` ← **generic** |
| `og:url` | **`null` — absent** |
| `og:locale` | **`null` — absent on all 15 locales** |
| `og:image` | `https://visaai.co/brand/og-v3.png` (1200×630, `image/png`, **139,545 bytes**) |
| `twitter:card` | `summary_large_image` ✅ |
| `twitter:title` | `VisaAI — AI-Powered Immigration Copilot` ← **generic** |

Root cause is documented in the code itself — `apps/web/app/[locale]/layout.tsx:53-65` sets a
complete `openGraph` and `twitter` block; Next merges metadata field-by-field, and no page
overrides `openGraph.title`, so the layout's value wins on every route. `/pricing`'s real title
never reaches a social card or an AI-answer-engine preview.

### 2e. H1 counts — **PARTIALLY BLOCKED**

A microlink `data.*` rule returns only the first match, so **`<h1>` counts could not be
measured**. Presence/absence and the first value are reliable (table 2a); "exactly one H1" is
not asserted anywhere in this document.

Manual step:
```bash
for u in / /applications/new /pricing /privacy /terms /login /signup; do
  printf '%s h1=%s\n' "$u" "$(curl -sL "https://visaai.co$u" | grep -o '<h1' | wc -l)"
done
```

One conflict worth resolving with that command: `WebFetch` rendered `/pricing`'s first heading
as `Pricing`, while the DOM read returns `<h1>` = `Find out which visa you qualify for`. The
source resolves it — `apps/web/app/[locale]/pricing/page.tsx:38-39` puts `Pricing` in
`<p class="eyebrow">` and the H1 below it — so the DOM read is correct and the markdown
conversion was misleading. Recorded because it is exactly the class of error that produces a
wrong audit.

---

## 3. Is content server-rendered?

### 3a. Caveat on the evidence — important

**This could not be tested the clean way.** The clean test is `curl` with no JS. Both fetchers
that succeeded execute JavaScript (microlink runs headless Chrome; the agent fetcher renders).
So content presence below is **confirmed**, but "present in the *raw* HTML" is **not proven** by
these measurements alone.

Manual step to prove it properly:
```bash
curl -sL 'https://visaai.co/pricing' | grep -c 'Find out which visa you qualify for'
curl -sL 'https://visaai.co/applications/new' | grep -c 'Where are you applying'
```

### 3b. What was observed, and the strong indirect evidence

Full content came back on every public page: `/pricing` returned all plan names and prices
(`$149`, `$349`, `$699 USD per application`), `/privacy` and `/terms` returned their full body
text, `/applications/new` returned its form and H1.

The source supports genuine SSR: `apps/web/app/[locale]/pricing/page.tsx` is an `async` server
component using `getTranslations` from `next-intl/server`, and
`apps/web/app/[locale]/layout.tsx:26-28,83` uses `generateStaticParams()` + `setRequestLocale()`
to prerender all 15 locales. Content is server-rendered by construction.

**One real client-side gap was observed.** On `/applications/new` the country list is **not** in
the server response — the page renders the status string `Loading supported countries.` The
single interactive element on the site's de-facto homepage is client-hydrated.

### 3c. Localisation is only partially applied — MEASURED, and this is a headline finding

| URL | `<html lang>` | Body language actually served |
|---|---|---|
| `/fr/applications/new` | `fr` | **French** — H1 `Où faites-vous votre demande ?` |
| `/fr/pricing` | `fr` | **English** — H1 `Find out which visa you qualify for`, lede `Take a free 3-minute eligibility assessment…` |
| `/de/pricing` | `de` | **English** — same H1 |
| `/ja/privacy` | `ja` | title/description identical to English |

The funnel is translated. **The marketing and legal pages are not.** 14 non-English locales are
being advertised in the sitemap for `/pricing`, `/privacy` and `/terms` while serving English.

Likely cause (**hypothesis, not measured** — no `grep` available this session): the `pricing`
namespace is missing from `apps/web/messages/<locale>.json` and next-intl is falling back to
English. Verify with:
```bash
for l in fr de es ja ar; do
  printf '%s pricing-keys=%s\n' "$l" "$(node -e "console.log(Object.keys((require('./apps/web/messages/$l.json').pricing)||{}).length)")"
done
```

---

## 4. Structured data (JSON-LD)

**The premise that there is none is FALSE. JSON-LD is live in production.**

Measured on `https://visaai.co/applications/new` and `https://visaai.co/fr/pricing` via
`data.ld.selector=script[type="application/ld+json"]`, 2026-08-20 — returned verbatim:

```json
{"@context":"https://schema.org","@type":"Organization","name":"VisaAI","url":"https://visaai.co","logo":"https://visaai.co/brand/mark-v3-512.png","image":"https://visaai.co/brand/og-v3.png","description":"AI-powered immigration copilot for preparing and verifying visa applications."}
```

Source: `apps/web/app/[locale]/layout.tsx:98-105` injects **two** blocks —
`organizationSchema()` and `webApplicationSchema()`, both from
`apps/web/lib/seo/structured-data.ts`. The selector returns only the first match, so the
`WebApplication` block is **present in source and expected in the served HTML but not
independently confirmed live**.

Confirm with:
```bash
curl -sL 'https://visaai.co/pricing' | grep -c 'application/ld+json'   # expect 2
```

Quality assessment of what exists:

- `Organization` and `WebApplication` are well-formed and use absolute URLs (required for `logo`).
- The file deliberately omits `aggregateRating`, `review`, `offers` and `foundingDate`
  (`structured-data.ts:6-11,42-45`). That is the correct call — fabricated structured data gets
  quoted back as fact by AI answer engines.
- **Gaps, stated as observations:** no `BreadcrumbList` anywhere; no `FAQPage`; no `Product`/
  `Offer` on `/pricing` despite real published prices; no `WebSite` + `SearchAction`; no `Article`
  or author/`Person` entity anywhere — and no author entity is possible today because there is no
  editorial content to attach one to (§5c).

---

## 5. Internal link graph of the public surface

### 5a. Edges — MEASURED

Every `<a href>` on each page, read 2026-08-20 (`WebFetch` on each public URL):

| Page | Outbound internal links |
|---|---|
| `/applications/new` (de-facto homepage) | **`#main-content` only** (skip link). Wordmark is an `<img>` via `/_next/image?url=%2Fbrand%2Fwordmark-v3.png&w=3840&q=75`, **not a link**. No header nav, no footer. |
| `/pricing` | `/applications/new` × 12. Nothing else. |
| `/privacy` | `/terms` |
| `/terms` | `/privacy` |
| `/login` | `/`, `/forgot-password`, `/signup` |
| `/signup` | `/`, `/terms`, `/privacy`, `/login` |

### 5b. Inbound degree — DERIVED from 5a

| Page | Inbound links from the public surface |
|---|---|
| `/` → 307 → `/applications/new` | 2 (`/login`, `/signup`) |
| `/applications/new` | 1 direct (`/pricing`) + 2 via the `/` 307 |
| **`/pricing`** | **0 — ORPHAN** |
| `/privacy` | 2 (`/terms`, `/signup`) |
| `/terms` | 2 (`/privacy`, `/signup`) |
| `/login` | 1 (`/signup`) |
| `/signup` | 1 (`/login`) |
| `/forgot-password` | 1 (`/login`) — and it is in neither the sitemap nor `robots.txt` |

Two structural facts fall out of this:

1. **`/pricing` is orphaned.** It is the only content-rich, commercially relevant public page on
   the domain, it carries the only unique title and description worth ranking, and **no page on
   the site links to it.** Its sole discovery path is `sitemap.xml`.
2. **The de-facto homepage is a dead end.** `/applications/new` receives whatever authority the
   domain has (it is the 307 target of the root, which is the URL external links point at) and
   passes **zero** of it onward — it has no outbound internal links at all. There is no global
   header or footer on the public surface; this is confirmed structurally in
   `apps/web/app/[locale]/layout.tsx:114-144`, whose `<body>` contains providers and `{children}`
   and no nav or footer component.

### 5c. Content inventory — MEASURED

| Page | Approx. word count | Note |
|---|---|---|
| `/privacy` | ~220 (WebFetch estimate) | Body reads **"Template pending legal review."** |
| `/terms` | ~210 (WebFetch estimate) | Body reads **"Template pending legal review. Last updated: 2026-06-04."** |
| `/pricing` | not counted | Only page with substantive marketing copy |
| `/applications/new` | minimal | Form + one lede sentence |

Word counts are conversion-based estimates, not `wc -w` on rendered text — treat as
order-of-magnitude.

Two live, indexable pages tell every visitor and every crawler that the site's own legal terms
are an unreviewed template. For a product handling passport data and immigration filings, that
is a trust signal, not a cosmetic issue.

**Confirmed: zero public visa-content pages.** No `/visa/*`, `/guides/*`, `/blog/*`, `/countries/*`
or equivalent exists in the sitemap, in `apps/web/app/sitemap.ts:5`, or in any link discovered
during crawling. The public surface is 6 declared paths plus the funnel entry.

---

## 6. Core Web Vitals

### 6a. Field data — **BLOCKED — requires a PageSpeed Insights / CrUX API key**

Both unauthenticated calls returned **HTTP 429**:
```
https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fvisaai.co%2F&strategy=mobile&category=performance
https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fvisaai.co%2Fpricing&strategy=mobile
```

**No LCP, INP or CLS figure is stated anywhere in this document.** CWV status is **UNKNOWN**.

Manual steps:
1. Get a key at `https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com`.
2. ```bash
   curl -s "https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=https%3A%2F%2Fvisaai.co%2Fpricing&strategy=mobile&key=$PSI_KEY" \
     | jq '{fetchTime:.analysisUTCTimestamp, perf:.lighthouseResult.categories.performance.score, field:.loadingExperience.metrics, origin:.originLoadingExperience.metrics}'
   ```
3. Repeat with `strategy=desktop` and for `/applications/new`.
4. If `loadingExperience` comes back absent, the origin has **insufficient CrUX traffic** — that
   is itself the baseline finding, and lab-only Lighthouse must be labelled as such.

Given a public surface of 6 pages with no organic content, expect step 4.

### 6b. Resource weight actually measured

| Resource | Measured value | How |
|---|---|---|
| `/brand/og-v3.png` | **139,545 bytes**, 1200×630, `image/png` | microlink `data.image` on `https://visaai.co/` |
| `/brand/mark-v3-512.png` | **205,280 bytes**, 512×512, `image/png` | microlink `data.logo` on `https://visaai.co/` |
| `/_next/image?url=%2Fbrand%2Fwordmark-v3.png&w=3840&q=75` | **51,284 bytes**, 1109×325, `content-type: image/png`, HTTP 200 | microlink on that exact URL |

Three observations from those numbers:

- **`mark-v3-512.png` (205 KB) is declared as a favicon.** `apps/web/app/[locale]/layout.tsx:47-51`
  lists it in `icons.icon` alongside the 32px mark. Browsers that pick the largest icon pull
  205 KB of PNG on first paint, on every page.
- The wordmark is requested through `next/image` at **`w=3840`** and comes back as **PNG, not
  WebP/AVIF**, for a 1109×325 source. The `w=3840` bucket for a header logo means the `sizes`
  attribute is unset or wrong.
- `og-v3.png` at 139 KB is fine for an OG card but oversized as a PNG; AVIF/WebP would cut it.

Full page weight and JS transfer size were **not measurable** — no tool available returned a
resource manifest.

```bash
# JS transfer size + request count
curl -sL 'https://visaai.co/pricing' | grep -o '/_next/static/[^"]*\.js' | sort -u \
  | while read -r p; do curl -so /dev/null -w "%{size_download} $p\n" "https://visaai.co$p"; done \
  | awk '{s+=$1; n++} END {print n" js files, "s" bytes"}'
```

### 6c. Rendering strategy — a measured performance risk

`apps/web/app/[locale]/pricing/page.tsx:8`
```ts
export const dynamic = 'force-dynamic'
```

The only content-rich public page **opts out of static generation entirely** and blocks its
response on a live call to `${NEXT_PUBLIC_API_URL}/pricing/quotes` (`page.tsx:19-28`). Two
consequences, both from source:

1. Every crawler hit pays a server round-trip plus an upstream API round-trip. TTFB will be
   materially worse than a static route — magnitude unmeasured (§1b).
2. `getQuotes()` swallows failures and returns `[]` (`page.tsx:24-27`), and the component then
   renders only `t('unavailable')` (`page.tsx:52-56`). **If the API is down when Googlebot
   crawls, `/pricing` serves HTTP 200 with its entire pricing table missing** — a soft-404 with
   a success status. There is no `revalidate` and no stale fallback.

### 6d. Fonts — MEASURED (source)

`apps/web/app/[locale]/layout.tsx:21-23` loads **three** families via `next/font/google`:
IBM Plex Mono (400, 500), Noto Serif (400), Inter (variable). All use `display: 'swap'` ✅ and
are self-hosted by `next/font` ✅ (no render-blocking third-party font request).

**All three declare `subsets: ['latin']` only.** The site ships 15 locales including `ar`, `ur`,
`hi`, `zh`, `zh-TW`, `ja`, `ko` — **none of which are covered by the Latin subset.** Those seven
locales render in system fallback fonts, and the Latin font payload is downloaded anyway.

### 6e. Viewport — MEASURED

`meta[name=viewport]` on `/applications/new` = `width=device-width, initial-scale=1` ✅

---

## 7. Crawler / AI-bot user-agent access

### **BLOCKED — requires shell access (`curl`) to set the `User-Agent` header**

The agent fetcher does not allow setting request headers, and microlink's free tier rejected
`headers.user-agent` with **HTTP 400**. **No per-UA result is claimed for any of
`OAI-SearchBot`, `GPTBot`, `ChatGPT-User`, `PerplexityBot`, `Googlebot`, `bingbot`, `ClaudeBot`.**

**Indirect evidence, offered as weak signal only:** four independent non-browser fetchers —
`r.jina.ai`, `api.microlink.io` (headless Chrome), `api.allorigins.win`, and the agent fetcher
itself — all received **HTTP 200 with full HTML** from `visaai.co` on 2026-08-20 from different
IPs. That rules out a blanket non-browser block. It does **not** rule out UA-specific rules, and
UA-specific bot blocking at nginx/Cloudflare is exactly the kind of thing that would not show up
in any of those four requests.

Manual step:
```bash
for ua in "OAI-SearchBot/1.0" "GPTBot/1.2" "ChatGPT-User/1.0" "PerplexityBot/1.0" \
          "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)" \
          "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" \
          "ClaudeBot/1.0"; do
  code=$(curl -s -o /tmp/ua.html -w '%{http_code}' -A "$ua" -L 'https://visaai.co/pricing')
  printf '%-70s %s bytes=%s h1=%s\n' "$ua" "$code" "$(wc -c </tmp/ua.html)" \
    "$(grep -c 'Find out which visa you qualify for' /tmp/ua.html)"
done
```
A 200 with a small byte count and `h1=0` is a challenge/interstitial page, not real HTML — that
is the failure mode to watch for, not a 403.

Also worth checking in the same pass: **`robots.txt` has no AI-crawler rules at all** (full text
fetched 2026-08-20 — single `User-Agent: *` group). Neither opt-in nor opt-out is expressed for
`GPTBot`, `ClaudeBot`, `PerplexityBot`, `OAI-SearchBot` or `Google-Extended`. Recorded as an
observation; it is a policy decision, not a defect.

---

## 8. hreflang correctness — sitemap vs. on-page

### 8a. What the sitemap declares — MEASURED

`https://visaai.co/sitemap.xml`, fetched 2026-08-20. Opening element, verbatim:
```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
```
First entry, verbatim:
```xml
<url>
<loc>https://visaai.co</loc>
<xhtml:link rel="alternate" hreflang="en" href="https://visaai.co" />
<xhtml:link rel="alternate" hreflang="fr" href="https://visaai.co/fr" />
… (es, de, it, pt, nl, ar, tr, hi, ur, zh, zh-TW, ja, ko) …
<lastmod>2026-08-20T17:06:08.145Z</lastmod>
</url>
```
- xhtml namespace correctly declared ✅
- 15 `hreflang` alternates per entry ✅
- **No `x-default` anywhere in the sitemap** ❌
- No `<changefreq>`, no `<priority>` (fine — Google ignores both)
- URL count: **90 expected** = 6 paths × 15 locales, derived from `apps/web/app/sitemap.ts:5,31-37`
  and `apps/web/i18n/config.ts:5-21`. The XML was fetched and its structure confirmed, but **a
  hard count was not performed** — an automated read of the document returned "160", which
  contradicts the code and is not trusted. Settle it with
  `curl -s https://visaai.co/sitemap.xml | grep -c '<loc>'`.

### 8b. What the pages declare — MEASURED

| URL | on-page `hreflang` set | `x-default` |
|---|---|---|
| `/pricing` | present (`hreflang="ja"` → `https://visaai.co/ja/pricing` confirmed) | **`https://visaai.co/pricing`** ✅ |
| `/fr/pricing` | present — `fr` → `https://visaai.co/fr/pricing`, `ja` → `https://visaai.co/ja/pricing` ✅ | **`https://visaai.co/pricing`** ✅ |
| `/applications/new` | **`link[hreflang="fr"]` → `null` — no hreflang at all** ❌ | **`null`** ❌ |
| `/login` / `/fr/login` | not emitted | **`null`** ❌ |

Source: `apps/web/lib/seo/alternates.ts:21-33` (`localeAlternates()`) is called by
`/pricing`, `/privacy` and `/terms`. It is **not** called by `/applications/new`, `/login` or
`/signup` — those emit a per-locale self-referencing canonical (confirmed live: `/fr/login`
canonical = `https://visaai.co/fr/login`) and **no** hreflang. The mechanism producing that
self-canonical was not located in source this session (no `grep`/`glob` available) — resolve
with `grep -rn "alternates" apps/web/app`.

### 8c. The three mismatches

1. **`x-default` is inverted between the two channels.** Sitemap: absent. On-page (on the 3
   pages that emit hreflang): present. The two channels disagree.
2. **The sitemap declares 15 alternates for `/`, `/login` and `/signup`, but those pages emit no
   on-page hreflang whatsoever.** Google requires bidirectional confirmation; one-sided
   declarations are discarded. So the hreflang cluster is live for 3 of 6 declared paths.
3. **The sitemap's 15 root URLs all 307-redirect.** `<loc>https://visaai.co</loc>` and
   `https://visaai.co/fr` … resolve to `/applications/new` and `/fr/applications/new` (§1a). A
   sitemap must list canonical 200 URLs. Meanwhile the actual destination, `/applications/new`,
   is **not in the sitemap at all** (§1c).

### 8d. The cross-locale canonical — the single most damaging finding

`apps/web/lib/seo/alternates.ts:21-33`:
```ts
export function localeAlternates(path: string) {
  const suffix = path === '/' ? '' : path
  const languages = Object.fromEntries(
    LOCALES.map((locale) => [locale, locale === DEFAULT_LOCALE ? path : `/${locale}${suffix}`]),
  )
  return { canonical: path, languages: { ...languages, 'x-default': path } }
}
```

`canonical: path` has **no locale prefix**. The `languages` map is built per-locale, the
canonical is not. Every localized page therefore declares the **English** URL as its canonical.

Confirmed live on three independent locales, 2026-08-20:

| Requested URL | `<html lang>` | `link[rel=canonical]` |
|---|---|---|
| `https://visaai.co/fr/pricing` | `fr` | **`https://visaai.co/pricing`** |
| `https://visaai.co/de/pricing` | `de` | **`https://visaai.co/pricing`** |
| `https://visaai.co/ja/privacy` | `ja` | **`https://visaai.co/privacy`** |

Compounding it: `hreflang` on those same pages points *to* the localized URLs while `canonical`
points *away* from them. A canonical that points to a different URL overrides the hreflang
cluster — Google drops the alternates and consolidates everything onto the English page.

Net effect: **42 URLs** (14 non-English locales × `/pricing`, `/privacy`, `/terms`) are
instructed to remove themselves from the index. And per §3c they serve English content anyway,
so the instruction is currently *correct* — fixing the canonical without fixing the translations
would replace a deindexing bug with 42 pages of duplicate English content.

The file's own docblock (`alternates.ts:3-19`) records that an *earlier* version of this bug —
a layout-level `canonical: '/'` that every page inherited — was already found and fixed once.
This is that bug's surviving half.

### 8e. `lastModified` — MEASURED, with the experiment that settles it

`apps/web/app/sitemap.ts:34` sets `lastModified: new Date()` on all 90 entries.

Two fetches, second with a cache-busting query string to force a distinct request:

| Fetch | URL | First entry `<lastmod>` |
|---|---|---|
| 1 | `https://visaai.co/sitemap.xml` | `2026-08-20T17:06:08.145Z` |
| 2 | `https://visaai.co/sitemap.xml?cachebust=20260821` | `2026-08-20T17:06:08.145Z` |

**Identical** across both fetches → the value is frozen at **build time**, not regenerated per
request. (Adjacent entries differ by 1 ms — `.145` vs `.146` — the signature of `new Date()`
being called inside the `.map()` loop.)

So: `2026-08-20T17:06:08Z` is when the production bundle was last built, and **every deploy
resets `lastmod` on all 90 URLs simultaneously**, whether or not any content changed. The signal
crawlers receive is "the entire site changed", every deploy, forever — which is the same as no
signal. This also serves as a useful ground truth: **the code read in this audit is the code
running in production as of 2026-08-20T17:06:08Z.**

---

## 9. Search Console / Bing Webmaster verification

### On-site verification tags — MEASURED, all absent

Read on `https://visaai.co/applications/new`, 2026-08-20:

| Selector | Value |
|---|---|
| `meta[name="google-site-verification"]` | **`null`** |
| `meta[name="msvalidate.01"]` | **`null`** |
| `meta[name="yandex-verification"]` | **`null`** |

`apps/web/app/[locale]/layout.tsx:36-70` — the `Metadata` object has **no `verification` key**.
There is no other place in the app that could emit one.

HTML-file verification (`/google<token>.html`, `/BingSiteAuth.xml`) could not be tested — the
token filename is unguessable, and no directory listing tool was available to inspect
`apps/web/public/`. Check with `ls apps/web/public/`.

Note that `apps/web/proxy.ts:152` **does** exclude `/.well-known` and `robots.txt`/`sitemap.xml`
from the locale rewrite, so a verification file dropped in `public/` would be served correctly —
but any file **not** matching that exclusion pattern would be 307'd into the localized app and
verification would silently fail. A `.html` verification token is not in the exclusion list.
Prefer DNS TXT or the meta-tag method here.

### **BLOCKED — requires Google Search Console and Bing Webmaster Tools credentials**

No property access. **This audit makes no claim about index coverage, impressions, clicks,
average position, manual actions, or whether any sitemap has ever been submitted.** None of it
was observed.

Manual steps:
1. GSC → Add property → **Domain property `visaai.co`** (not URL-prefix; a domain property
   covers all 15 locale paths and both schemes in one).
2. Verify by **DNS TXT** at the registrar — avoids the proxy-rewrite trap above entirely.
3. GSC → Sitemaps → submit `https://visaai.co/sitemap.xml`. Record the reported *Discovered URLs*
   count and compare against the 90 expected (§8a).
4. GSC → Pages → export Indexed vs. Not-indexed with reasons. **Expect a large
   "Alternate page with proper canonical tag" bucket** — that will be §8d showing up in the data,
   and it is the confirmation that the canonical bug is costing real index coverage.
5. GSC → Settings → Crawl stats: record daily crawl requests, average response time and any
   host-status errors. This is the first real TTFB dataset the project will have (§1b).
6. Bing Webmaster Tools → import from GSC (fastest path), then submit the same sitemap.
7. Export a baseline **before** any remediation lands, so the pre/post comparison is honest.

**Until steps 1-7 are done, there is no index-coverage or traffic baseline for this project —
only the technical baseline in this document.**

---

## 10. SERP context for the target query families

**Observation from one location (US), on 2026-08-20, via `WebSearch`. A single sample, not a
ranking study. No position, volume, difficulty or traffic figure is claimed — none were
measured, and none of the four queries returned `visaai.co` in the results seen.**

| Query family | Query sampled | Who actually appeared |
|---|---|---|
| `[country] visa requirements` | `Canada tourist visa requirements` | **Government**: travel.gc.ca (×2), travel.state.gov. **Encyclopaedic**: Wikipedia "Visa policy of Canada". **Commercial/aggregator**: coverme.com, skyscanner.com. **Institutional**: daemen.edu, ieee.org |
| `do I need a visa for [country]` | `do I need a visa for Japan` | **Government/official**: japan.travel (JNTO), us.emb-japan.go.jp, seattle.us.emb-japan.go.jp, jp.usembassy.gov, travel.state.gov. **Commercial**: intrepidtravel.com, us.iasservices.org.uk, timeout.com |
| `[country] visa application form` | `Schengen visa application form download` | **Aggregator/affiliate dominant**: schengenvisainfo.com, axa-schengen.com (×2), pdffiller.com, visareservation.com, scribd.com. **No government result in the sample** |
| `[country] tourist visa` / `[country] visa requirements for [nationality]` | `India visa requirements for US citizens 2026` | **Aggregator/commercial dominant**: india-online-visa.com, evisaindians.com, lowfaretravel.com, visarequirements.info. **Legal/professional**: lexology.com. **Government**: travel.state.gov. **Encyclopaedic**: Wikipedia |

Three factual patterns in this sample, offered as observations rather than conclusions:

1. **The two SERPs skew government-heavy are the "requirements" and "do I need a visa" families.**
   Displacing an embassy or a `.gc.ca` page is not a realistic near-term objective.
2. **The two SERPs skew aggregator-heavy are "application form" and nationality-qualified
   "requirements for [nationality]".** In the Schengen form sample, no government result appeared
   at all — the slots were held by commercial sites. These are the families where a non-government
   commercial site demonstrably ranks.
3. **Nationality-qualified and year-qualified phrasing recurs** in the ranking titles
   (`for US Citizens`, `2026`, `Latest Rules and Updates in 2026`). This is a structural
   observation about the corpus, not a keyword recommendation.

A real assessment of these families needs volume, difficulty and SERP-feature data from a
credentialed tool. **BLOCKED — requires Ahrefs / Semrush / DataForSEO access.**

---

## 11. Baseline summary table

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | 14 non-English locales canonicalize to the English URL (42 URLs) | **MEASURED** | §8d — `alternates.ts:21-33` + live on fr/de/ja |
| 2 | `/pricing`, `/privacy`, `/terms` serve English under `lang="fr"`/`"de"`/`"ja"` | **MEASURED** | §3c |
| 3 | `/` 307s to `/applications/new`, which is not in the sitemap | **MEASURED** | §1a, §1c — `proxy.ts:124` |
| 4 | 15 sitemap root URLs all redirect | **MEASURED** | §8c |
| 5 | `/pricing` has zero inbound internal links (orphan) | **MEASURED** | §5b |
| 6 | De-facto homepage has zero outbound internal links | **MEASURED** | §5a |
| 7 | Zero public visa-content pages | **CONFIRMED** | §5c |
| 8 | Sitemap has no `x-default`; on-page has one on 3 of 6 paths | **MEASURED** | §8a, §8b |
| 9 | `/privacy` + `/terms` publicly say "Template pending legal review" | **MEASURED** | §5c |
| 10 | JSON-LD Organization live (premise of "none" is false); no Breadcrumb/FAQ/Product | **MEASURED** | §4 |
| 11 | `og:title`/`og:description`/`twitter:title` generic on every page; no `og:url`, no `og:locale` | **MEASURED** | §2d |
| 12 | `/login` has no H1; `/login`+`/signup`+`/applications/new` use the fallback title | **MEASURED** | §2a |
| 13 | `/pricing` is `force-dynamic` and renders empty if the API is down | **MEASURED (source)** | §6c |
| 14 | 205 KB PNG declared as a favicon; wordmark served as PNG at `w=3840` | **MEASURED** | §6b |
| 15 | 3 font families, `latin` subset only, across 15 locales incl. ar/ur/hi/zh/ja/ko | **MEASURED (source)** | §6d |
| 16 | `lastmod` = build timestamp on all 90 URLs; resets every deploy | **MEASURED (2 fetches)** | §8e |
| 17 | `/intake/*`, `/forgot-password`, `/reset-password` crawlable, undeclared | **MEASURED** | §1c |
| 18 | No GSC / Bing / Yandex verification tag | **MEASURED** | §9 |
| 19 | No AI-crawler rules in `robots.txt` | **MEASURED** | §7 |
| 20 | Core Web Vitals | **BLOCKED** — PSI/CrUX key | §6a |
| 21 | TTFB / total time | **BLOCKED** — shell access | §1b |
| 22 | Crawler UA access (7 bots) | **BLOCKED** — shell access | §7 |
| 23 | Index coverage, impressions, positions, traffic | **BLOCKED** — GSC/Bing credentials | §9 |
| 24 | Keyword volume / difficulty | **BLOCKED** — Ahrefs/Semrush/DataForSEO | §10 |
| 25 | H1 counts per page | **PARTIALLY BLOCKED** — presence known, counts not | §2e |
| 26 | Sitemap URL count (90 expected from source, not counted live) | **UNVERIFIED** | §8a |
| 27 | Raw-HTML (JS-disabled) SSR proof | **UNVERIFIED** — fetchers execute JS | §3a |
| 28 | Source of the self-referencing canonical on login/signup/applications-new | **UNVERIFIED** | §8b |

---

## 12. What must be run to complete this baseline

Ordered by how much they unblock. Nothing here has been executed.

1. **Shell pass** — closes §1b, §2e, §3a, §4, §7, §8a, §9 (public dir) and §8b in one sitting.
   Every command is already written inline above.
2. **GSC + Bing domain property, DNS-TXT verified, sitemap submitted, coverage exported**
   (§9 steps 1-7). This is the only way to get an index and traffic baseline, and it must
   happen **before** any remediation so the comparison is real.
3. **PSI/CrUX API key**, then §6a for `/pricing` and `/applications/new`, mobile + desktop.
4. **Keyword-tool access** for §10.

---

*Compiled 2026-08-20 / 2026-08-21. Pre-change baseline — no site or repo change was made in
producing it, and the only file written was this one.*
