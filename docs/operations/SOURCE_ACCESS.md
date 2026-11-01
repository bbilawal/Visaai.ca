# Source access: the 403 problem

**Measured 2026-08-21.** 56 of 134 registered sources return HTTP 403 to the
source monitor. This document exists because the workaround is trivial and
taking it would be wrong, and that needs to be written down somewhere a future
engineer will find it before they "fix" the sync.

## What was measured

Against `immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/visitor-600`:

| User-Agent sent | Response |
|---|---|
| *(none)* | **200** |
| `curl/8.4.0` | **200** |
| `VisaAI-SourceMonitor/1.0 (+https://visaai.co/bots; …)` | **403** |
| `SomeGenericBot/1.0` | **403** |
| `Googlebot/2.1 (+http://www.google.com/bot.html)` | **403** |

`travel.state.gov` returns 403 to everything including `/robots.txt`, with no
User-Agent that gets through — Cloudflare, keyed on something other than the UA
string.

## What it means

The Home Affairs rule blocks **self-identified crawlers from unverified IP
ranges**. It blocks Googlebot too, because a real Googlebot is verified by
reverse DNS from Google's IPs, and anything claiming to be Googlebot from
elsewhere is presumed to be lying. VisaAI is not being singled out; it is being
caught by a blanket rule aimed at exactly the category it honestly belongs to.

## Why the obvious fix is not applied

Sending `curl/8.4.0`, or no User-Agent, returns 200 today. One flag in
`source-fetcher.ts` would "fix" 28 sources.

That is bypassing anti-bot protection. The execution spec forbids it in as many
words, and the ease of the workaround is the reason the control exists rather
than an argument against respecting it. Concretely, it would mean:

- deliberately removing the identifier that lets a government administrator see
  who is fetching their site and contact us
- defeating a control the authority chose to apply
- building the product's data pipeline on a posture that breaks the moment they
  tighten the rule, with no relationship to fall back on

The monitor therefore keeps announcing itself, and takes the 403.

## What happens instead

A blocked source is not a broken source. `visa_sources.robots_state` and the
check log record it, and the product degrades the way it was designed to: the
source keeps its metadata, no requirement is invented for it, and the applicant
is linked to the authority's own page. The coverage matrix reports those visa
types as `BLOCKED BY OFFICIAL SOURCE` — an explicit status, not a silent gap.

## Current impact

| Host | Sources | Status | Effect |
|---|---|---|---|
| `immi.homeaffairs.gov.au` | 28 | 403, UA-keyed | all 12 AU visa types unversioned; AU stays `preview` |
| `travel.state.gov` | 28 | 403, not UA-keyed | 4 US visa types have no readable source at all |
| `online.immi.gov.au` | 4 | robots `Disallow: /` | never fetched; correct |
| `visas-immigration.service.gov.uk` | 2 | robots `Disallow: /` | never fetched; correct |
| `ceac.state.gov` | 4 | TLS reset mid-response | unavailable |
| `esta.cbp.dhs.gov` | 1 | 200, but an Angular shell with no content | parse error |

`www.canada.ca` (28), `www.gov.uk` (27), `www.uscis.gov` (6) and
`ircc.canada.ca` (6) all return 200 and are fully monitored.

## The legitimate routes forward

**1. Ask each authority to allowlist the monitor.** This is the intended path
and the reason the User-Agent carries a contact URL.

Researched 2026-08-21 and **found to have no destination**: neither Home Affairs
nor the State Department publishes a channel that accepts a third-party crawler
request. Home Affairs offers visa-applicant enquiry lines and a Global Feedback
Unit explicitly scoped to *"feedback from clients about their interaction with
the Department"*; the State Department's website-issues form scopes itself to
broken links and incorrect content. Canada, the third authority, is not blocked
at all.

Drafts and the full finding: `SOURCE_ACCESS_OUTREACH.md`. They are held pending
counsel's answer on LEGAL_REVIEW_REQUIRED L-03 — writing to a regulator's own
department to introduce a service whose regulatory status in that jurisdiction
is an open question is the wrong order.

**2. Publish and verify a stable egress IP range**, the way Google and OpenAI
do, so an authority can allowlist by IP rather than by trust in a UA string.
Requires a static egress address the VPS does not currently guarantee.

   **The disclosure half of this is DONE**: https://visaai.co/bots now exists.
   The agent's User-Agent has always pointed there and the URL 404'd — so an
   administrator who followed it got nothing, which is a fair reason to treat
   the traffic as anonymous. The page states the exact User-Agent, the real
   limits, a copy-pasteable robots.txt block, and an offer to stop on request.
   The IP range is the remaining half.

**3. Accept link-out for those sources.** Already the behaviour. It costs the
change-detection and the "last verified" date for those visa types, and nothing
else. For an authority that has clearly signalled it does not want automated
readers, this may simply be the right answer.

**4. A headless-browser fetch path.** Technically effective and explicitly NOT
recommended: it is the same evasion with more machinery, and it would make the
403s invisible rather than absent.

## Two related findings

**Australian pages are client-rendered.** `normalizeContent` on an immi page
yields ~1.5–3.5k characters of navigation chrome and zero requirements; the real
content sits in a doubly-escaped JSON blob in a hidden field. So even with
access restored, the sync would diff nothing but boilerplate on AU pages until
the normalizer learns to read that field. Filed here because it is the same
class of problem — a source that appears monitored while telling us nothing.

**ESTA is the same shape**: HTTP 200, a 2.3 KB Angular shell, no requirement
text. The sync correctly records it as a parse error rather than as a page whose
content vanished, which is what the empty-extraction guard in
`visa-sync.service.ts` is for.

## Blocked sources, classified by WHOSE problem they are (2026-08-24)

Every blocked host was requested from two egress paths with our identified
user-agent. Identical results from both mean policy; different results mean our
IP. The distinction was previously invisible, and it decides whether a source is
a permanent exception or an infrastructure ticket.

| Host | Sources | robots from a second egress | From the VPS | Class |
|---|---|---|---|---|
| `immi.homeaffairs.gov.au` | 28 | 403 | 403 | **(a)** authority refuses our bot |
| `travel.state.gov` | 28 | 403 | 403 | **(a)** authority refuses our bot |
| `migri.fi` | 12 | 200 | 403 | **(b)** our egress is dropped |
| `ceac.state.gov` | 4 | no connection | no connection | unreachable from both |
| `online.immi.gov.au` | 4 | 200, path **disallowed** | same | authority's robots rule |
| `visas-immigration.service.gov.uk` | 2 | 200, path **disallowed** | same | authority's robots rule |
| `esta.cbp.dhs.gov` | 1 | 200 | 200 | client-rendered (B-28), not blocked |

Outside the registry, the same test found **`www.uscis.gov`** answering a second
egress and returning 403 to the VPS — class (b) — and Portugal's
`vistos.mne.gov.pt` and `aima.gov.pt` resetting the TLS handshake from the VPS in
0.22s while answering 200 elsewhere.

### What fixing the egress would actually buy

**12 sources, which is Finland's five pages** — five verified extractions that
sit unpublished today for no reason other than our IP. Possibly the USCIS half of
the form-sweep queue as well, which is currently unanswerable because the pages
that would cite those forms cannot be fetched.

**It would not buy Australia or travel.state.gov.** Those refuse both paths, and
the spec forbids working around bot protection. Their 56 sources are permanent
exceptions and should stop being counted as pending work.

The six `disallowed` sources are a third thing again: those authorities publish
crawl rules and their rules say no. That is the system working, and respecting it
is non-negotiable (spec rule 9).

