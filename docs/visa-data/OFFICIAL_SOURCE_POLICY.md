# Official source policy

## The rule

**A VisaAI requirement must be traceable to an official government source.**
This is enforced structurally, not by convention: `visa_requirements.
source_version_id` is `NOT NULL` and references a specific *version* of a
specific page. A requirement with no provenance cannot be inserted.

## Source hierarchy

`visa_sources.authority_rank`:

| Rank | Source |
|---|---|
| 1 | immigration authority (IRCC, USCIS, UKVI, Home Affairs) |
| 2 | ministry of foreign affairs / government department |
| 3 | official government visa / eVisa / ETA portal |
| 4 | embassy or consulate acting for that government |
| 5 | another official government source |

The column is `check (authority_rank between 1 and 5)`. There is no rank for a
third party, so one cannot be stored. Third-party sites may help **discover** an
official URL; the official page must then be fetched and only its URL cited.

## Provenance recorded

Per source: country, visa type, role, authority, rank, canonical URL, fetch URL,
title, language, robots state, redistribution state, check interval, freshness
SLA, first seen, last checked, last success, last changed, failure streak.

Per version: both hashes, HTTP status, content type, byte size, storage path
(when caching is permitted), publication and effective dates when the authority
states them, extractor version, fetched-at, active flag, superseded-by.

Per requirement: the source version, the excerpt it was read from, the
extraction method (`manual` / `parser` / `ai_assisted`), a confidence score, and
a lifecycle status.

## Model memory never overrides official data

`visa.agents.ts`'s research agent reads no government page — it produces model
recall. It is named for what it is: **`visa_requirement_estimate`**, and its
docblock states that its output is unverified by construction, may never be
presented as an official requirement, and may never overwrite a sourced row.

The registry is authoritative. The estimator is the fallback for a gap the
registry does not yet cover, and the gap should shrink.

## Redistribution and access

`visa_sources.redistribution` is `permitted` / `prohibited` / `unknown`, and
**`unknown` is treated as prohibited**: metadata and provenance are stored, the
bytes are not cached, and the user is linked to the official page. Silence from
an authority is not consent.

`robots_state` is re-evaluated **per URL, per run** — a cached `disallowed` is
not trusted across runs, so an authority that opens up is picked up the next
morning. A `disallowed` source is not a broken source.

**Never bypassed:** CAPTCHAs, authentication, paywalls, bot protection, access
controls. A 403 or 429 is recorded as `blocked` and the source is backed off —
retrying through a government block is how a monitor becomes an attack.

Politeness: a fixed delay between requests to the same host, `Crawl-delay`
honoured when published, and a User-Agent that names VisaAI with a contact URL
so an administrator seeing the traffic can reach us.

## Never fabricated

- a visa subclass, stream or category
- an official form number
- a URL
- a fee, processing time, or eligibility rule not read on an official page

Where a value cannot be verified it is `NULL` and appears in the
"could not verify" list of `SOURCE_RESEARCH_PRIORITY.md`. The seed generator
enforces this: a multi-valued `official_code` becomes NULL rather than being
truncated into a code the government never issued.

## Excerpts must be quotes, not summaries

Every requirement carries a `source_excerpt`: the government's own words for the
thing being claimed. `generate-requirements.mjs` refuses to emit a requirement
without one, because the excerpt is what a reviewer checks the claim against.

For a long time nothing checked that the excerpt was actually **on** the page it
cites. "Verified verbatim" was a sentence in a commit message.
`apps/api/scripts/verify-excerpts.ts` now makes it a test:

```bash
npx ts-node -P tsconfig.json scripts/verify-excerpts.ts data/requirements/ca-*.json
```

It re-fetches every cited page and accepts an excerpt in exactly two forms:

| Form | Rule |
|---|---|
| Plain quote | Must appear as a **contiguous** substring of the normalized page text. |
| Elided quote | May omit material, but only where it says so with a literal ` ... `. Each fragment must then appear **in order**, without overlapping. |

The rule is not "no elision" — it is **no undeclared elision**. Quoting three
bullets out of six with ` ... ` between them is ordinary and honest: the reader
can see something was cut. Silently joining two distant sentences is not, because
it asserts an adjacency the page does not support.

That distinction is not theoretical. The first run of this script against the
existing files passed 121 excerpts and failed 9, all in the earliest extraction
and all already live on the public visa page. Three ways a quote had been
assembled rather than copied:

* **Block joins punctuated into sentences.** IRCC's page reads `you must:` then a
  list. The excerpt read `"you must: be in good health"`, skipping the bullet in
  between.
* **Accessibility text silently dropped.** The page says `use of a representative
  (imm 5476) (opens in a new tab) (if using an authorized representative)`. The
  excerpt deleted the middle clause.
* **An undeclared cut inside a fee quote**, gluing a fee label to its amount
  across the `what's this?` expander IRCC renders between them.

Every one of those nine **claims** was correct. Only the evidence was
manufactured — which is the more dangerous defect, not the lesser one: a
fabricated quote looks like evidence, so a reviewer approves it without
re-opening the page. All nine were repaired against the live text, and the lost
context moved into `description`, which is where VisaAI's own words belong.

Changing an excerpt on an already-reviewed requirement demotes it to `draft`
automatically. That is the intended behaviour: the evidence changed, so the
approval is no longer someone's.

## Current verified set

4 destinations, 116 official URLs registered, all on government-owned domains.

Reachability measured by the daily monitor on 2026-08-21, by host:

| Host | Registered | Readable | Blocked |
|---|---|---|---|
| `www.canada.ca` | 31 | 31 | 0 |
| `www.gov.uk` | 27 | 27 | 0 |
| `ircc.canada.ca` | 6 | 6 | 0 |
| `www.uscis.gov` | 6 | 6 | 0 |
| `www.cbp.gov` | 2 | 2 | 0 |
| `immi.homeaffairs.gov.au` | 28 | 0 | 28 |
| `travel.state.gov` | 28 | 0 | 28 |
| `online.immi.gov.au` | 4 | 0 | 4 |
| `visas-immigration.service.gov.uk` | 2 | 0 | 2 |
| `ceac.state.gov` | 4 | 0 | 4 |
| `esta.cbp.dhs.gov` | 1 | 0 | 1 |

An earlier version of this document said `canada.ca` returned 403 to automated
fetchers. That is **wrong** and has been corrected: all 37 canada.ca and
ircc.canada.ca sources return 200 to the monitor, which is why Canada is the only
destination with complete requirement coverage. The 403s are Australian and US
hosts, plus two UK service subdomains.

Two hosts fail for reasons other than a WAF, and the distinction matters when
deciding what to do about them. `ceac.state.gov` simply does not respond
(`fetch failed`, no HTTP status). `esta.cbp.dhs.gov` returns **200** and is
still unusable: it is the live ESTA application client, a JavaScript app whose
served HTML contains no prose, so the monitor records
`parse_error: normalization produced no text` rather than pretending it read
something. It does not execute JavaScript to reach the rendered DOM.

That last case is why US Visa Waiver Program / ESTA was registered against
`www.cbp.gov` instead: CBP publishes the same programme as ordinary
server-rendered pages on a host that is neither blocked nor JS-only.

Blocked or unverifiable items are recorded in `SOURCE_RESEARCH_PRIORITY.md` with
the observed status. **No CAPTCHA or bot check was solved or bypassed** to obtain
any of it, and the monitor's User-Agent is never removed or disguised to get a
different answer — see `docs/operations/SOURCE_ACCESS.md`.
