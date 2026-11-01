# Country expansion — source research

**Status 2026-08-22. Three of five are DONE AND LIVE: New Zealand, Ireland and
the Netherlands.** Registered, synced, extracted, every excerpt verified, and
published.

**Norway is now DONE and live too — my "blocked" call on it was wrong.** See the
correction below; the short version is that I read the visible `<select>`, found
no `name`, and stopped, missing the hidden input that carries the value.

**Sweden is done too, from its SWEDISH pages** — the registry's first
non-English source. All five candidates are now live.

When this research was written the registry covered four destinations: Canada,
the United Kingdom, the United States and Australia. New Zealand has since been
added and is live. This is the groundwork for the ones after it.

## Method

Every candidate was probed with the source monitor's own fetcher — the same
robots-respecting, identified-User-Agent client the daily sync uses — so a
"readable" here means readable *by us, as ourselves*, not readable in a browser.
That distinction is the entire lesson of Australia: `immi.homeaffairs.gov.au`
renders perfectly in Chrome and returns 403 to an identified agent, and 16
Australian visa types have no requirements as a result.

For each authority: `robots.txt` fetched and read, then two representative
section pages fetched end-to-end.

## Result

| Destination | Authority | Host | robots | Pages probed | Verdict |
|---|---|---|---|---|---|
| New Zealand | Immigration New Zealand | `www.immigration.govt.nz` | 200, 5 disallows under `*` (`/admin`, `/Security/`, `/_search/`, `/_visa-search/`, `/_list-collection-search/`) | 3/3 readable | **DONE — live** |
| Ireland | Immigration Service Delivery | `www.irishimmigration.ie` | 200, 1 disallow | 2/2 readable | **DONE — live** |
| Netherlands | Immigratie- en Naturalisatiedienst (IND) | `ind.nl` | 200, 44 disallows | 2/2 readable | **DONE — live** |
| Norway | Utlendingsdirektoratet (UDI) | `www.udi.no` | 200, **0 disallows** | 2/2 readable | **DONE — live** |
| Sweden | Migrationsverket | `www.migrationsverket.se` | 200, 16 disallows | 2/2 readable | **DONE — live; Swedish source for the first 3, English `/en/` thereafter** |

Confirmed-readable entry points:

```
NZ  https://www.immigration.govt.nz/visit/
    https://www.immigration.govt.nz/work/requirements-for-work-visas/
    https://www.immigration.govt.nz/study/study-visas/
IE  https://www.irishimmigration.ie/coming-to-visit-ireland/
    https://www.irishimmigration.ie/coming-to-study-in-ireland/
NL  https://ind.nl/en/residence-permits/study
    https://ind.nl/en/residence-permits/work
NO  https://www.udi.no/en/want-to-apply/visit-and-holiday/
    https://www.udi.no/en/want-to-apply/studies/
SE  https://www.migrationsverket.se/English/private-individuals/visiting-sweden.html
    https://www.migrationsverket.se/English/private-individuals/studying-and-researching-in-sweden.html
```

None of the five is behind a WAF that rejects an identified agent. On the
evidence so far, all five are materially easier than Australia and comparable to
Canada.

### Rejected

`germany-visa.org` does not respond, and it would have been excluded anyway: it
is a **third-party** site, not a German government authority. `authority_rank`
has no value for a third party precisely so one cannot be stored. Germany's
actual authority is the Auswärtiges Amt / the Bundesamt für Migration und
Flüchtlinge, and neither has been probed yet.

## What this is not

**For the four destinations still outstanding, no sources are registered and no
requirements are extracted.** (New Zealand has since been through the full
pipeline — see the section at the end.) Registering a source commits the daily
monitor to fetching it; extracting a requirement puts a quoted government claim
in front of an applicant. Neither should follow automatically from "the page
returned 200".

Two specific things this research did NOT establish for any of the five, and
still does not for the remaining four:

1. **Which pages state requirements.** All ten URLs above are *section hubs*.
   On INZ, `/visit/what-you-need-to-visit-new-zealand/` reads as a requirements
   page and is actually a router — it explains that you need a visa or an NZeTA
   and links onward. The pages that state eligibility criteria sit a level
   deeper and have to be found per visa type, by reading the site's own links
   rather than by guessing URL patterns. `scripts/list-source-links.ts` exists
   for exactly this.

2. **Whether the requirements are extractable without interpretation.** The
   Australian outcome turned on this: `legislation.gov.au` is fully readable and
   still not used, because converting Migration Regulations Schedule 2 into a
   checklist is legal interpretation. A comparable question has to be asked of
   each of these five before anything is extracted.

## Per-country cost, honestly

For each destination the pipeline is: find the per-visa-type source pages →
register country, visa types and sources → run the sync so
`visa_source_versions` exists → extract requirements with verbatim excerpts →
verify every excerpt with `scripts/verify-excerpts.ts` → promote draft to
active.

Canada, the UK and the US together produced 293 requirements across 16 visa
types, and that was the bulk of a long working session. **Expect roughly a day
of focused work per destination**, most of it in extraction and excerpt
verification rather than plumbing — the plumbing is now built and proven.

Recommended order, cheapest first: **New Zealand** (English, clear structure,
familiar visa vocabulary), then **Ireland**, then **Norway** (zero robots
disallows), then **Sweden**, then the **Netherlands** (most disallows, so the
allowed surface needs mapping first).

## New Zealand: what actually happened, for the next four

The estimate above said roughly a day per destination. New Zealand took
noticeably less, because the plumbing was already built and proven. What cost
the time was not registration or syncing — it was **finding the pages that
state requirements**, exactly as predicted.

Three findings worth carrying forward:

1. **The obvious page was the wrong page.** `/visit/` and
   `/visit/what-you-need-to-visit-new-zealand/` both look like requirements
   pages. Both are routers. The substance lives at
   `/new-zealand-visas/visas/visa/visitor-visa` — a path not reachable by
   following the section links, and found only by probing a guessed pattern and
   then verifying it. Probing to FIND a URL is fine; what must never be guessed
   is what a page says.

2. **One page carried almost everything.** Eligibility, the health and character
   rules with their duration thresholds, the funds thresholds, the fee and the
   stay length were all on the single visa detail page. Two registered sources
   were enough. Do not assume a country needs the 4-6 sources Canada's visa
   types needed.

3. **The country lists are the recurring gap.** INZ links its visa-waiver and
   NZeTA country lists rather than stating them, so neither was extracted. Every
   destination will have an equivalent: a list the authority publishes
   elsewhere, which cannot be reproduced from memory. Expect to register those
   pages separately or leave the condition unruled.

Revised estimate for the remaining four: **half a day to a day each**, dominated
by locating requirement pages rather than by the pipeline.

## Norway and Sweden: readable is not the same as extractable

Both were marked viable on the evidence available at research time — robots
read, pages fetched, 200 throughout. Both turned out to be unextractable, for
reasons a readability probe cannot detect. **That is a flaw in the probe, not a
surprise about the sites**, and it is the thing to fix before the next round.

### Norway (UDI) — I was wrong; it needed no JavaScript at all

**This section previously declared Norway blocked. That was incorrect and is
left here rather than deleted, because the mistake is instructive.**

The reasoning was: `/en/want-to-apply/visit-and-holiday/` is a nationality
selector, its `<select>` is `id="hidden-select" style="display:none"` with no
`name`, therefore no query parameter can be constructed, therefore the content
needs JavaScript.

Every step was checked except the last. The same form also contains

```html
<input type="hidden" name="c" id="selected-value" />
```

which is what actually carries the value. `?c=ind` works, and the detail page
behind it — `/visit-and-holiday/visitors-visa-to-norway/?c=ind` — is **29,971
characters** of plain server-rendered requirements.

I inspected the control a *user* interacts with and stopped there. **When a form
looks unusable, read all of its controls, not the visible one.**

One genuine subtlety did emerge, and it is the opposite of what I first assumed:
the parameter is **not** cosmetic. The bare URL returns 4,726 characters
containing none of "valid travel insurance", "nok 300 per day", "passport that
is valid for at least three months" or "register your fingerprints". Registering
it would have handed the monitor a page to diff and an extractor nothing to
quote. So the registered source carries `?c=ind`, and the requirement text was
checked across `ind`, `chn` and `usa` (visa-required and visa-free) — identical
in all three, with only surrounding guidance personalised.

### Sweden (Migrationsverket) — CORRECTED: there IS an English tree, at `/en/`

**The section below concluded Sweden was extractable only in Swedish. That was
wrong, and it is left in place because the mistake has a shape worth keeping.**

The sitemap holds 4,020 URLs. **1,011 of them are under `/en/`** — a full English
tree including the `flikar/` tab pages, found while adding the live-with-a-partner
permit on 2026-08-22.

The original probe searched for `/English/`, found zero, and read a null result
as absence. The count was accurate; the conclusion did not follow. This is the
same error as reading UDI's visible `<select>`, finding no `name` attribute, and
declaring the page JavaScript-only while a hidden `<input name="c">` carried the
value — **checking one specific thing and generalising from it.**

When probing for a language tree, search for the *content*, not a path prefix you
already know: group every sitemap URL by first path segment and read the segments
off the site. One command answers it and cannot be fooled by a rename:

```
sitemap URLs by first segment → en(1011) images(670) download(597) …
```

The three existing Swedish extractions stay as they are. They were read from the
authoritative Swedish text, every excerpt verifies, and `verify-excerpts.ts` is
language-agnostic. New Swedish work uses `/en/`, which drops the translation
caveat those files carry.

### Sweden (Migrationsverket) — the English pages are summaries — SUPERSEDED, see above

`/English/private-individuals/visiting-sweden.html` returns 200 and 1,771
characters: a few sentences and a news item. It states no requirement.

`sitemapindex.xml` → `sitemap1.xml.gz` holds **4,028 URLs and zero under
`/English/`**. The substantive pages are Swedish —
`/du-vill-forlanga/besoka-sverige/besoka-sverige-upp-till-90-dagar-visum.html`
and its `flikar/` tabs.

So Sweden is extractable only in Swedish. `visa_sources.language` supports that
and it is a legitimate future option — the Swedish page is the authoritative
text, and an excerpt is evidence for a reviewer rather than user-facing copy.
**This was done, 2026-08-22.** The reservation above was half right and half
wrong, and the difference matters.

Wrong: `scripts/verify-excerpts.ts` is language-agnostic. It compares strings
against the fetched page and neither knows nor needs to know what they mean, so
provenance holds for Swedish exactly as for English. All 12 excerpts verified.

Right: what a non-Swedish reader cannot check is whether the English `label` and
`description` render the Swedish faithfully. So every description now states its
translation explicitly, putting quote and rendering side by side for a Swedish
speaker to check in one pass, and the extraction file carries a
`translation_note` recording the limitation.

The alternative was worse in both directions — registering a 1,771-character
English stub would have produced a page with a "verified" badge and nothing
behind it.

### What to change in the probe

Fetching two section pages proves reachability and nothing else. Before calling
a destination viable, additionally require:

1. **A page that states a requirement, found via the site's own links.** All
   three successes needed this and none of the section hubs qualified — INZ's
   and ISD's real pages sat elsewhere, and IND's took three failed URL guesses
   before its link list gave the answer.
2. **A character count and a keyword probe.** 1,771 characters with no "you
   must", no currency symbol and no "passport" is a stub. NZ's real page was
   28,284 characters; Ireland's 28,150; the Netherlands' 12,830.
3. **A check that the English tree exists at all.** Sweden's sitemap answers
   this in one request.


## The concatenated-page pattern, and why excerpt verification is not enough

Found while adding Norway's family immigration (spouse) route, 2026-08-22.

Some authority pages hold **many sibling routes under one URL**. UDI's
`/family-immigration-with-norwegian-or-nordic-citizen/` is 21,998 characters
covering 8+ family categories — spouse, cohabitant, fiancé(e), children, parents
— each with its own "requirements for both / applicant / reference person"
block. The heading "how to apply" occurs 8+ times and the income figure
NOK 436 957 repeats verbatim in every block.

This defeats `verify-excerpts.ts` in a way worth stating plainly:

> **5 of the 9 excerpts taken from that page appear verbatim in a sibling
> category as well.** Excerpt verification passes them identically whether they
> were read from the right block or the wrong one.

So a cohabitant's "you must have lived together for at least two years" filed
under spouses would verify clean and still be false. Provenance proves a quote
is *on the page*; it cannot prove the quote is *about the right subject*. This
is the same failure that nearly gave Norway's skilled-worker permit an athlete's
salary threshold — that one was caught by reading, which does not scale.

`scripts/verify-extraction-bounds.ts` now checks it. An extraction file declares:

```json
"source_bounds": {
  "requirements": {
    "starts_at": "spouse or registered partner",
    "ends_before": "cohabitant",
    "note": "the spouse block; ends where the cohabitant heading begins"
  }
}
```

and the script fails if any excerpt for that role falls outside the resolved
block. It also reports how many excerpts *would* have verified from a sibling,
so the value of the bound stays visible rather than looking like ceremony.

**Anchors, not character offsets.** The first version used raw offsets
(3,709–5,557). Those are correct exactly until the authority edits anything
earlier on the page, at which point every offset shifts and the window either
fails spuriously or — far worse — slides onto a neighbouring category and keeps
passing. Anchors re-resolve on each run. `ends_before` is matched *after* the
start anchor, so a word that recurs later is still a usable terminator, and a
`starts_at` that occurs more than once is rejected outright.

Checked by pointing the bound at the fiancé block instead: 5 requirements fail.

**When to reach for this:** any page where one URL serves several routes. Signs
are a character count far above the ~12–28k of a single-route page, a heading
like "how to apply" repeating, and the same figure appearing at many offsets.
`grep -c` on the fee or the heading answers it in one command.

## A second structural lesson: obligations that belong to someone else

Every visa type in the registry before this one stated what **one** person must
do. UDI splits family immigration between the *applicant* and the *reference
person* — the sponsor already in Norway — and the income requirement of
NOK 436,957/year pre-tax falls entirely on the sponsor, who never files the
application.

A checklist that hands the applicant the sponsor's salary bar is not merely
untidy, it is wrong about who owes what, and the applicant cannot act on it.
Each requirement therefore names whose obligation it is in its label. Expect
this in every family/sponsorship route, and note the income rule is three tests
at once: the year ahead, the year already past, and the whole processing period.

## What was deliberately left unencoded

UDI can waive the 24-year age requirement, and decides by weighing which
countries the couple's — **and their parents'** — backgrounds are from, against
a list it states is "not exhaustive" and "can be changed over time".

The exemption is recorded as existing, in UDI's own words. Its criteria are not
encoded as a rule. Encoding them would turn a caseworker's discretionary
judgement about a person's ethnicity into an automated verdict, and it would go
stale silently between UDI revisions. Recording that a relief exists, and
sending the applicant to the authority for it, is the honest shape.

## When a bound is needed, and when it is not

Two family routes added the same day, with opposite page structures. Both are
"one URL, lots of repeated text", and only one needs `source_bounds`.

| | Norway (UDI) | Sweden (Migrationsverket) |
|---|---|---|
| Page size | 21,998 chars | 40,183 chars |
| What repeats | **8+ different family routes** | this route's own 4 tabs, inlined |
| "requirements for…" headings | 8+ | exactly 1 each |
| Excerpts also found elsewhere on the page | **5 of 9, in a sibling route** | 1 of 13, and it is the same route's fee |
| Needs `source_bounds` | **yes** | no |

The distinguishing question is not "does the page repeat itself" but **"does the
repetition belong to a different route?"** Sweden gives every family route its
own URL; UDI serves them all from one.

Check it rather than assuming, in one pass: count the requirement-stating
headings, and count how many times each chosen excerpt occurs on the page. One
heading and mostly-unique excerpts means no bound. Many headings and excerpts
that recur means bound it, then confirm by pointing the bound at a sibling
section and watching it fail.

## The renderer will price anything numeric — including a year

Sweden's maintenance thresholds carry `stated_for_year: 2026`. `amounts()` turns
any number beside a `currency` into money, so this rendered as
**"SEK 2,026 stated for year"** — an invented price, printed in the same line as
six genuine thresholds, where it reads as authoritative.

`visa-amounts.coverage.test.ts` could not catch it. It asserts every stored
number **renders**; nothing asserted that everything rendered **is money**. The
rule that fixed the old bug (41 of 54 keys silently dropped) created the
inverse one.

Fixed by naming `stated_for_year` in `NOT_MONEY`, plus a sweep over the real
extraction files for any bare 1900–2100 integer beside a currency whose key does
not say it is money. Note both tempting generalisations are wrong:

* a **range** heuristic ("~2026 is a year") — Sweden's own application fee is
  SEK 2,000;
* a **key-name** heuristic on `/year/` — Norway's `per_year_pre_tax_nok` is a
  sponsor's income.

**Carry forward:** when an extraction stores a number that is not money, check
what the page renders, not just that the tests pass.

## Ireland's long stay employment visa: the third "blocked" call that was wrong

It was recorded as blocked behind "a 2,793-char router". The router is real —
`/coming-to-work-in-ireland/what-are-my-work-visa-options/applying-for-a-long-stay-employment-visa/`
returns 2,717 characters and states no requirement. **The visa page sits one
level below it** at `.../employment-visa/` and carries 16,600 characters.
`page-sitemap.xml` finds it in one fetch.

That is now three destinations lost to the same mistake shape:

| Called blocked because | What was actually true |
|---|---|
| UDI's visible `<select>` has no `name` | a hidden `<input name="c">` carried the value |
| Migrationsverket's sitemap has zero `/English/` URLs | the English tree is at `/en/`, 1,011 URLs |
| ISD's route page is a 2,717-char router | the requirements page is one level below it |

Each time I checked one specific thing, found a null, and generalised to
"unreachable". **A null result from one probe is evidence about that probe.**
Before recording a destination or visa type as blocked, the site's own index —
sitemap or link list — has to have been read and come up empty too.

### Two authorities, and an ordering an applicant can get wrong

Ireland splits work migration between the **Department of Enterprise, Trade and
Employment** (issues the employment *permit*) and **Immigration Service
Delivery** (issues the *visa*). ISD: "once you have received a permit, you are
eligible to apply for an employment visa."

So the permit is both a precondition and a required supporting document. Someone
who searches "Irish work visa" and reads only visa pages can apply in the wrong
order and be refused for a reason that appears on no visa criteria list — which
is why the ordering is recorded as the first requirement rather than a note.

The seven DETE permit types are named but their eligibility is **not** extracted.
Different authority, different site, and each permit has its own salary
thresholds, occupation lists and labour-market tests. Summarising them from one
ISD sentence would put unverified criteria in front of an applicant.

**Expect this split elsewhere.** Any destination where a labour ministry gates a
work visa has the same two-step shape, and the visa page will state the
dependency in a single easily-missed sentence.

## New Zealand re-probed: the blocked call was right, for the wrong reason

After three wrong "blocked" calls, the remaining ones were re-probed. NZ's held
up — but the recorded reason ("sub-sitemaps unavailable") understated it.

What is actually true:

* INZ's sitemap index lists 11 sub-sitemaps. **Ten return `unavailable`**; the
  eleventh holds 20 news URLs. So the sitemap route really is broken.
* **INZ's enumeration of visa types sits behind `/_visa-search/`, which its own
  `robots.txt` disallows**, and its prose links to that search rather than to
  visa detail pages.

The second point is the real blocker, and it is a **principled** stop, not a
technical one. We do not fetch a robots-disallowed path, so the list of New
Zealand visa types is out of reach and stays out of reach.

### What still worked: bounded slug probes

Probing to **find** a URL is legitimate; what must never be guessed is what a
page **says**. Under the known `/new-zealand-visas/visas/visa/` pattern:

```
post-study-work-visa                        ok, 23,594 chars
foreign-government-supported-student-visa   ok, 16,684 chars
fee-paying-student-visa                     unavailable
pathway-student-visa                        unavailable
student-visa / full-fee-paying-student-visa unavailable
```

Two real, substantive, readable pages that no index reaches. The post study work
visa was extracted from this; the foreign-government-supported student visa is
available for a future pass.

**The fee-paying student visa remains unfound** — its slug is not guessable from
INZ's prose and enumeration is robots-disallowed. Recorded as a principled stop.

**Carry forward:** "no index" is not "no pages". Where a site has a stable URL
pattern for a content type, a *small, bounded* set of slug probes is a
legitimate last resort — and it must stay bounded, because probing a slug space
exhaustively is enumeration by another name, which is what robots.txt refused.

## Recording a rule that is not yet in force

INZ announces on the post study work visa page that **from 16 November 2026**
eligibility extends to graduate-diploma-plus-bachelor's applicants. Extraction
ran 2026-08-22, so it is announced and not law.

Both ways of mishandling this are harmful:

* **dropping it** hides a change that decides whether someone currently
  ineligible should wait before applying;
* **recording it as eligibility** tells people today that they qualify when they
  do not.

So it is stored with `officially_required = false` and the date in the label,
which renders it under "Also stated by the authority" rather than among the
conditions. `parameters.in_force_from` carries the date as a string — note that
a *number* there would have been priced as money by `amounts()` had a currency
been present, the trap Sweden's `stated_for_year` exposed.

**Carry forward:** authorities announce changes on the same page as current
rules, with no visual separation. Check whether a stated date is in the future
before recording it as a requirement.

## Australia and the US re-probed: both correctly closed

Completing the sweep of blocked calls. Both hold, and for a stronger reason than
recorded — **even `robots.txt` returns blocked**:

```
blocked   https://immi.homeaffairs.gov.au/robots.txt
blocked   https://www.homeaffairs.gov.au/robots.txt
blocked   https://travel.state.gov/robots.txt
```

That is an HTTP-level WAF rejection of an identified agent, not a robots
decision. It settles the question in a specific way: **we cannot even read what
these sites permit**, so there is no version of proceeding that is informed
consent from the publisher. Working around a WAF is out of scope regardless.

Australia's 16 visa types and the US's remaining types stay unextracted. That is
now a checked conclusion rather than an inherited one.

## When one page renders its requirements twice

The Dutch partner permit renders "1. check requirements" **twice**, and the
copies differ. A line-by-line diff settled it in seconds:

```
block A (4145-8130)   block B (8130-11023)
10 lines only in A    0 lines only in B      → B is a strict subset of A
```

The A-only content was the tuberculosis test and the civic integration exam
abroad. No `<input>`, `<select>`, `<option>` or `<button>` on the page selects
between the copies — checked, per the UDI lesson.

So the discriminator had to come from IND's own wording, and step 3 supplies it:
variant A reads *"you apply for the mvv and the residence permit at the same
time"*; variant B reads only *"you can apply online or in writing by post"*.
**A is the MVV route.** That makes the A-only items coherent rather than
arbitrary — the exam is due "before you apply for the mvv", the TB test "after
your partner arrives".

Occurrence counting confirmed it independently: those two plus the MVV
application step appear **exactly once**, all thirteen other excerpts twice.

**Method worth reusing.** Duplicated blocks are common and mean different things:

1. **Diff the blocks.** Subset → one is a reduced variant. Disjoint → different
   routes, and a bound is needed.
2. **Look for a control** that selects between them before inferring anything.
3. **If there is none, find the discriminator in the authority's own prose** —
   never in your assumption about what the two audiences must be.
4. **Count occurrences** of each chosen excerpt as an independent check.

No `source_bounds` was declared here: B contains nothing A lacks, so there is no
sibling text to be mis-attributed. Contrast the Norway spouse permit, where one
URL carries 8+ distinct family routes and the bound is load-bearing.

## The figure that must not be filled in

IND states the income requirement and **links an income test instead of
publishing an amount**. No figure is recorded — `parameters` is empty for that
requirement.

This is the single most tempting field in the registry to complete from memory:
a partner-permit income threshold is a well-known-sounding number, it is what
applicants most want, and a wrong one is invisible next to correctly-quoted
neighbours. An empty amount next to an accurate quote is the honest output.

## Two routes from one URL: the bound mechanism proven end-to-end

Norway's spouse and cohabitant permits come from the **same** UDI page —
characters 3709–5557 and 5557–7233 of a 21,998-character document carrying 8+
family routes. This is the case `source_bounds` was built for, and it now has
both halves in the registry.

What the checker reports:

```
no-family-spouse       9 bounded excerpts; 5 also appear verbatim outside the bound
no-family-cohabitant   9 bounded excerpts; 4 also appear verbatim outside the bound
```

Those 5 and 4 are the whole point. **Excerpt verification passes every one of
them from the wrong block**, because the text is character-identical. Point the
cohabitant file at the spouse bound and 5 requirements fail — including both
cohabitation alternatives, which exist only on the cohabitant route.

The bound anchors on `both of you must be over the age of 18.`, not on the word
"cohabitant", which occurs 8 times. **The checker's non-unique-anchor rule is
what forced the better anchor** — a rule worth keeping for that reason alone.

### The routes are not near-duplicates

Worth stating, because "same page, same authority, same permit family" invites
copying one file onto the other:

| | Spouse | Cohabitant |
|---|---|---|
| Age floor | 24 only | **18 *and* 24** |
| Core test | conditions that must **all** hold | **alternatives** — 2 years cohabiting **or** a child together |
| Fee listed under | "requirements for both" | "requirements for the applicant" |
| Marriage validity / recognition / forced / circumvention | 4 conditions | **none** |

The two alternatives are not equally strict either: Basis 1 requires only that
neither be married to someone *else*; Basis 2 requires both to be unmarried or
divorced outright. And cohabitation completed in Norway counts only if **both**
had legal residence at the time.

An unbounded extraction would have blurred every one of these — and would have
looked perfectly well-sourced doing it, since every excerpt verifies.

**Carry forward:** when a page carries sibling routes, extracting the second one
is not a copy job. Diff the blocks first; the differences are where the value is.

## Two implementations of one EU instrument, and a conflict inside one authority

Sweden's EU Blue Card joins the Dutch one, so the registry now holds **the same
EU instrument under two national implementations**. They are not variants of each
other: each member state sets its own salary threshold, minimum contract length
and process. **Crossing figures between them would produce a confidently wrong
number that verifies against nothing** — the excerpt would be real, just from the
wrong country.

Sweden's threshold is a **formula with a dated value**, which is the safer thing
to record:

> 1.25 × the average gross salary published by the National Mediation Office,
> redetermined annually — SEK 53,625/month since 15 July 2026.

The multiplier is durable; the amount is a snapshot. Both are stored.

### Migrationsverket contradicts itself on the maintenance amounts

Found while extracting, and confirmed by re-fetching both pages and matching all
six figures on each:

| Page | Introduces the same six figures as |
|---|---|
| EU Blue Cards | "**for 2025**, the amount you must have left after paying your rent is:" |
| Maintenance requirement (word explanation) | "**in 2026**, the amount you must have left over after tax and the rent is paid is:" |

Identical amounts — SEK 6,243 / 10,314 / 3,336 / 4,004 / 4,672 / 5,339 — under
two different years, on the same authority's site. One page is stale and neither
says which.

Each extraction quotes **its own** page and stores `stated_for_year` to match,
with the conflict recorded. Resolving it would need a source Migrationsverket has
not published on either page.

**Carry forward — and this is the transferable part:** it would have been easy to
copy the six figures from the earlier extraction, since they match exactly. Doing
so would have hidden the conflict completely. **Always read the sentence that
introduces a set of figures, not just the figures.** The introducing sentence is
where authorities put the year, the scope, and the conditions.

This also suggests a monitor feature worth building later: the same amounts
appearing under different years across two registered sources is a detectable
signal, not something that should depend on a human noticing.

## Closing the gap that let the Swedish conflict through

The Swedish 2025-vs-2026 contradiction was caught by luck: I read the sentence
introducing the figures rather than the figures alone. That is not a control, so
it is now `apps/api/scripts/detect-figure-conflicts.ts`.

**Why the existing checks could not see it.** Both operate on one file at a time:

| Check | Question it answers |
|---|---|
| `verify-excerpts.ts` | is this quote really on that page? |
| `verify-extraction-bounds.ts` | did it come from the right section of that page? |
| **`detect-figure-conflicts.ts`** | **do two of our files contradict each other?** |

Each Swedish extraction is individually correct and every excerpt verifies. The
contradiction exists only *between* files, which is a place nothing was looking.

**What counts as a conflict:** the same parameter key holding the same value in
two extractions of the **same destination**, where the temporal qualifiers
(`stated_for_year`, `in_force_since`, `in_force_from`, `edition_date`) disagree.

Two deliberate non-rules, because a noisy detector gets ignored:

* **Different countries sharing a number is not a conflict.** SEK 2,000 and
  NOK 2,000 are a coincidence, and flagging coincidences buries the real signal.
* **A missing qualifier is not disagreement.** Most figures carry no year, and
  demanding one everywhere turns this into a style checker.

**Allowlist, not suppression.** `data/KNOWN_FIGURE_CONFLICTS.json` holds reviewed
conflicts with a reason and a date. A reviewed conflict still prints on every
run; an unreviewed one fails the run. The Swedish disagreement stays on the
record — it is a true fact about Migrationsverket's site, not a defect in our
data to be tidied away. The script also reports allowlist entries that no longer
match anything, so when the authority fixes its page the stale entry surfaces
instead of silently masking a future conflict on the same figure.

Verified by injecting a fake New Zealand conflict: exit 1, correctly named. And
by removing the allowlist: exit 1 on all six Swedish figures.

**One thing this cost me.** The allowlist first lived in `data/requirements/`,
where every `*.json` loader swallowed it as an extraction with no `visaai_id`,
breaking two tests immediately. It now sits in `data/`, and both loaders also
skip any file without a `visaai_id`. **A control file does not belong in the
directory it audits.**

## Germany: fully readable, and NOT extracted. Readable is not current.

Germany was the largest gap in the registry and the one destination this
document had never probed. It is now probed, and the answer is **no — for a
reason none of the existing criteria could detect.**

Every previous blocked call was about *reachability*. This one is about
**freshness**, and the sites are wide open.

### Access is fine

| Host | robots | Verdict |
|---|---|---|
| `auswaertiges-amt.de` | 200, 5 disallows, sitemap declared | readable, 15,967 URLs |
| `bamf.de` | **404** | readable — pages return 200 |
| `make-it-in-germany.com` | 200 | **JS-only: 94 chars server-side** |

**A 404 on `robots.txt` is not a block.** Australia returns *403* on robots.txt,
which means we cannot read what is permitted and must stop. BAMF returns 404,
which conventionally means no restrictions. Do not conflate the two.

### Why it is not extracted

**1. The only central page carrying figures is dated `06.01.2021`.** The
Auswärtiges Amt article on working in Germany states the EU Blue Card thresholds
(€56,800, and €44,304 for MINT professions and doctors).

**2. It contradicts BAMF, and the contradiction is provable from the pages
themselves** — no outside knowledge of German law required:

> **BAMF:** "…erhalten sie in deutschland **nach 27 monaten** eine
> niederlassungserlaubnis…"
>
> **Auswärtiges Amt (06.01.2021):** "schon nach einem aufenthalt von **33
> monaten** kann eine unbefristete niederlassungserlaubnis erlangt werden…
> [**21 monaten**] soweit deutschkenntnisse auf der stufe b1…"

Two German federal authorities, three different numbers for the same permit.
BAMF cites **Directive (EU) 2021/1883** and **§ 18g AufenthG** — both of which
post-date the AA article. The AA page is superseded and still presents as
current.

**3. BAMF publishes no salary figure at all**, directing applicants to
`make-it-in-germany.com` for "die genauen voraussetzungen" — the site that
returns 94 characters to a server-side fetcher.

**4. AA devolves the document list to individual missions:** "weitere
voraussetzungen für den antrag und die vorzulegenden dokumente können den
entsprechenden merkblättern der zuständigen auslandsvertretung entnommen
werden." There are ~150 missions, each with its own Merkblatt.

Publishing €56,800 as Germany's current Blue Card threshold would launder a
five-year-old government page as fact. That is the worst failure mode available
to this registry, and it is worse than having no German pages at all.

### A trap on the BAMF page, for whoever extracts this later

BAMF's Blue Card page contains a list opening "darüber hinaus müssen folgende
voraussetzungen erfüllt sein:" — basic knowledge of the legal order, adequate
housing, secured livelihood, permissions for permanent employment, no public
security grounds.

**Those are conditions for the Niederlassungserlaubnis, not for the Blue Card.**
They follow the settlement-permit paragraph. Extracted as Blue Card requirements
they would verify perfectly and be wrong — the same shape as UDI's concatenated
family routes, so this page needs `source_bounds` when it is eventually used.

### The new probe criterion: freshness

The checklist so far was reachability, character count, keyword presence, and
whether an English tree exists. **None of them detects a five-year-old page.**
Add:

1. **Find the page's own dateline** before trusting any figure on it.
2. **Cross-check one figure against a second authority of the same government.**
   A disagreement is decisive and needs no outside knowledge.
3. **Check which legal instrument the page cites.** BAMF citing a 2021 directive
   that post-dates AA's article settled this in one comparison.

This is the research-time form of `detect-figure-conflicts.ts`, which does the
same job after extraction. Doing it before means the stale figures never enter
the registry at all.

### What would unblock Germany

A German federal source that publishes the current thresholds server-side. BAMF
would qualify if it stated them; today it does not. The relevant law
(§ 18g AufenthG) is published on `gesetze-im-internet.de`, but converting statute
into a checklist is legal interpretation — the same line already drawn for
Australia's `legislation.gov.au`.

## Auditing the 39 published pages for the German failure mode

Germany raised the obvious question: are pages already in the registry stale in
the same way? `apps/api/scripts/check-source-freshness.ts` reads each registered
source's self-declared modification date. The audit found real things — and two
ways the signal lies, both of which had to be handled before any conclusion was
safe.

### The signal can be too NEW

The first run flagged **twelve GOV.UK pages as 22 months stale**. They are not.
Their `dateModified` values land on one day within *seconds* of one another —
`2024-10-31T17:00:02` and `17:00:39` on two unrelated visas. That is a
platform-wide republish, not somebody editing visa rules.

A freshness tool that cries wolf gets muted, and a muted tool protects nothing.
Timestamps shared by several unrelated pages within a minute are now reported as
site-wide republishes and excluded from the stale count.

### The signal can be too OLD, which is worse

Migrationsverket's EU Blue Card page declares `rek:moddate 2025-02-19` while its
body reads **"since 15 july 2026, the salary threshold is sek 53,625 per
month"**. A page cannot describe a change that post-dates its own last
modification. The metadata is simply not maintained.

This is the more dangerous direction. A too-new timestamp merely *hides*
staleness; a too-old one *manufactures* it, and acting on it means re-extracting
current pages while continuing to trust the metadata elsewhere.

So every dated page is now cross-checked against the **latest year appearing in
its own text**. If the body refers to a year after the metadata date, the date
is reported as contradicted rather than as age. **Self-declared dates are
evidence, not truth.** Ten pages fail this check: five GOV.UK and all five
Swedish ones.

### A correction this forced

The Swedish 2025-vs-2026 conflict was briefly "resolved" by comparing
`rek:moddate` across the two pages. **That reasoning was unsound** — it relied on
exactly the metadata that turns out to be unmaintained.

The sound resolution comes from the content: the Blue Card page's own body says
*"since 15 july 2026…"*, so it was edited in or after July 2026 and **still**
labels the maintenance amounts "for 2025". The year label lags; the six amounts
are identical on both pages, so no figure shown to a user is wrong. The allowlist
entry now records this, and records that the moddate argument was withdrawn.

### What the audit actually found

After discounting both failure modes, the registry's least-fresh sources are
Irish: `ie-long-term-study-visa/requirements` and
`ie-long-stay-employment-visa/requirements` at **23 months**, with the ISD fees
page at 18 months. None mentions a later year in its text, so nothing
contradicts the dates — they are simply the oldest pages we cite, and are the
first candidates for re-verification.

Everything else is under six months or has no published date at all. Forty
sources publish no date whatsoever, including all of UDI, INZ and IRCC. Those are
reported as **unknown**, never as fresh: "no signal" and "recently updated" are
different claims, and collapsing them is precisely how the German page would have
slipped through.

## Finland: the tenth destination, and the first probe run as a script

Every previous candidate was probed by hand, and each failure mode was
discovered *after* the previous check had already passed. Those checks are
cumulative and there are now four of them, so they are a script:
`apps/api/scripts/probe-authority.ts`.

It runs, in order: robots readability and path permission for our own UA;
server-side character count; requirement-shaped language; and **freshness** —
the page's self-declared date, the latest year in its body, and whether those
two contradict each other. That last check exists only because Germany taught
it, and no reachability check can see it.

### What the probe said

| Candidate | Authority | robots | Server-side text | Verdict |
|---|---|---|---|---|
| **Finland** | Migri (`migri.fi`) | 200, 9 disallows, allowed, `Crawl-delay: 5` | 40k–42k chars | **ADMITTED** |
| Singapore | ICA (`ica.gov.sg`) | 200, 0 disallows | 5,694 chars | readable, thinner — candidate |
| Switzerland | SEM (`sem.admin.ch`) | 404 | 5,111 chars | readable, thinner — candidate |
| Denmark | SIRI (`nyidanmark.dk`) | 404 | **771 chars** | JS-only — rejected |
| Austria | `migration.gv.at` | 200, 0 disallows | **865 chars** | JS-only — rejected |
| Japan | ISA (`isa.go.jp`) | 200, 0 disallows | 3,405 chars, no requirement language | landing page only — rejected |
| France | `france-visas.gouv.fr` | **403 on robots.txt** | — | rejected, same class as Australia |
| Spain | `exteriores.gob.es` | 200 | 404 on the visa page | rejected pending a working entry point |

Denmark and Austria are the `make-it-in-germany.com` failure mode exactly:
they render in a browser and return under a kilobyte to an identified agent.
France is the Australian failure mode: robots.txt itself is 403, so we cannot
read what is permitted and must stop.

### Two authorities, and only one will let us read it

Finland splits entry between Migri (residence permits) and the Ministry for
Foreign Affairs (short-stay Schengen visas). `um.fi/robots.txt` reads fine and
allows the path — and the page then returns **403** to the same agent.

So Finland enters as a residence-permit destination only. The Schengen visa is
deliberately **not registered as a blocked visa type**: a source we cannot read
is not a source, and a row that exists only to say "blocked" teaches a reader
nothing the country page does not already say. Sweden's Schengen visa covers
the same border.

### Migri's English tree is authoritative, unlike Migrationsverket's

This is the direct inverse of Sweden. Migrationsverket's `/English/` pages are
summaries — its sitemap contains **zero** English URLs — so Sweden had to be
extracted from Swedish. Migri's `/en/` pages are 40k characters of full
requirements. The lesson is not "prefer English" or "prefer the local
language"; it is that **which tree is authoritative is a per-authority fact and
has to be measured**, not assumed from either direction.

### The freshness signal Migri publishes instead of a dateline

Migri publishes no `dateModified` at all. By the German rule that makes it
**unknown, never fresh** — and then the page offers something better than a
dateline: a processing-situation block updated monthly.

> "in july 2026, the average processing time of applications for a first
> residence permit for an employed person that led to a positive decision was
> **17 days**" … "since the beginning of 2026, a total of **3,891** applications
> … have been submitted."

A page carrying last month's statistics is not a five-year-old page. And the
income figure dates itself the way Sweden's Blue Card threshold does: "at least
eur 1,600 per month **in 2026**", stored with `stated_for_year` rather than as a
timeless number.

### One permit, two pages, by the authority's own instruction

The TTOL page states the permit-specific conditions and then says:

> "in addition, you must meet the general requirements for obtaining a
> residence permit."

Those general requirements — valid passport, no entry prohibition, and four
danger-to-the-state grounds — are on `/en/first-residence-permit` and appear
**nowhere** on the permit page. Extracting only the permit page would have
produced a checklist an applicant could satisfy completely and still be refused
on a ground the authority publishes plainly.

This is a new shape for this registry. Ireland's two-authority case was two
bodies disagreeing about *ordering*; this is one authority deliberately
factoring shared conditions out to a page it links by name. Both pages are
registered sources, each general condition quotes the page it was read from,
and the promotion migration asserts that exactly six requirements bind to the
general page — so a silent failure to attach them cannot pass as a complete
page.

### The trap: first permit and extended permit are interleaved

Migri writes both permits' rules in one flow. The fee line is "first permit
750 € / extended permit 230 €"; two attachments carry "this document is not
needed if you apply for an extended permit"; the income rule adds a
retrospective check that bites only at extension.

Quoting half of those sentences would misrepresent the page, so the excerpts
carry both figures and the labels and parameters name which permit each belongs
to. This visa type is the first permit; the extension is a different
application with its own page and is not extracted.

### Three things a reader would get wrong

* **The permit is granted for a FIELD of employment, not for a job.** Within the
  field the holder may hold several jobs and change employer. Outside it they
  may not work at all.
* **A zero-hours or on-demand contract is an outright bar**, however much it
  pays — Migri's reason is that no minimum hours were agreed. Someone reading
  only the EUR 1,600 line would never learn this.
* **"Light entrepreneurs" invoicing through a service company are excluded**,
  and that arrangement looks like ordinary employment to the person doing it.

### And one the renderer would have got wrong

The 50% fringe-benefit cap is stored **without** a currency. `visa-amounts.ts`
prices any number sitting beside a currency, which is how "SEK 2,026 stated for
year" once reached a live page. Fifty is a share of salary, not fifty euros, so
it is kept out of the money-bearing object entirely rather than added to a
deny-list.

## One page, two legal regimes: the concatenation trap in its worst form

Finland's spouse family-ties page publishes **both** of these, in full, on one
URL:

```
permit requirements for applications submitted before 16 june 2025
permit requirements for applications submitted on or after 16 june 2025
```

Requirements 1, 2 and the income requirement are **word-for-word identical**
between the two blocks. `verify-extraction-bounds.ts` reports two of this
extraction's excerpts as appearing verbatim outside the bound as well — they are
correct **only** because the bound records which block they came from.

This is UDI's problem in a worse form. On UDI's family page the sibling blocks
were different **routes** — spouse, cohabitant, fiancé(e) — and a careful reader
could tell them apart from the surrounding words. Here they are the *same route
at two different times*, and nothing in the wording of an individual sentence
marks which regime it belongs to. Extracting the superseded block would have
produced a checklist that is verbatim, provenance-complete, and **no longer the
law**.

The rule that separates them is the new requirement 3: both spouses must be at
least 21. It is an age at **validity**, not at application — the application may
be filed 9 months early, or 3 where the spouse holds a study permit — and joint
custody of a child lifts it entirely.

### What the bound cost, and what it bought

The spouse page prints its own fee **above** both regime blocks. Widening the
bound to include the fee would have readmitted the superseded regime, so the fee
is quoted from Migri's decree-based fee schedule instead — a fourth registered
source, and the better one regardless.

That is the general shape: **a bound is a claim about which part of a page you
read, so anything outside it needs its own source, not a wider bound.** This
permit therefore carries four sources, each holding something only it states:

| Role | Page | What only it has |
|---|---|---|
| `requirements` | spouse page (bounded) | the route conditions |
| `eligibility` | first residence permit | the general entry conditions |
| `policy` | family income requirement | the thresholds — regional, and **net** |
| `fees` | processing fees | the decree-based schedule |

### The income requirement is net, and regional

EUR 1,210/month for one adult in the Helsinki metropolitan area, EUR 1,090 in 24
named large municipalities, EUR 1,030 elsewhere — all **net of tax and of pension
and insurance contributions**. A gross salary comfortably above a threshold can
still fail it.

Migri stamps the table "as of 1 november 2024". That is when the figures took
effect, and it is stored as `in_force_since` rather than read as the page's age —
the distinction the freshness audit had to learn twice.

## Both sides of a threshold, and a rule that inverts between sibling pages

Finland's specialist permit says, in Migri's own words:

> "if your salary is less than eur 3,937, you should apply for a residence
> permit for an employed person"

That permit was already in the registry, so this is the first time VisaAI holds
**both sides of one authority's published threshold**. The redirect sentence is
stored as a requirement in its own right: for someone earning EUR 3,000 it is
the single most useful line on the page, and the page it points at is live.

The promotion migration asserts that too — if `fi-employed-person` ever stops
publishing, promoting the specialist permit fails rather than shipping a
redirect to nothing.

### What the higher bar buys

Not decoration; it is why the split exists, so each is recorded:

| | Employed person | Specialist |
|---|---|---|
| Salary | EUR 1,600/month (2026) | EUR 3,937/month (2026) |
| Fringe benefits | **up to 50% of salary counts** | **excluded entirely** |
| Labour market test | may apply | none |
| Supply contract | required | none |
| First permit length | tied to the contract | up to 2 years |
| Fast track | — | two weeks |
| Electronic fee | EUR 750 | **EUR 530** |
| Work without a permit | — | up to 90 days |

The higher-skilled route is also the cheaper one, and short assignments may need
no permit at all — the kind of fact an applicant otherwise discovers after
paying.

### The inversion is the warning

Fringe benefits may make up half the salary on one page and count for nothing on
the other. **Same authority, same concept, opposite rule.** This is the
within-one-country version of the Dutch/Swedish Blue Card lesson: a figure or a
rule carried across from a sibling page would produce a confidently wrong
requirement whose excerpt is real and whose subject is not.

## Finland is readable from here and not from production — the probe has a blind spot

Finland passed every check in `probe-authority.ts` and was extracted, verified
and published locally. Deploying it to production, the source monitor reported
**12 blocked out of 12 Finnish sources**, while Canada, the UK, New Zealand and
Ireland all fetched cleanly in the same run.

```
$ ssh <vps> curl -sS -A "VisaAI-SourceMonitor/1.0 (...)" \
    -w "http=%{http_code}\n" https://migri.fi/robots.txt
http=403
<!DOCTYPE html>… <title>Just a moment...</title> … cZone: 'migri.fi'
```

**migri.fi sits behind a Cloudflare managed challenge that 403s the VPS's
datacentre IP — including `/robots.txt`.** From a residential IP the same
request returns the real file: 200, 9 disallow lines, none matching the permit
pages, `Crawl-delay: 5`.

### The lesson the probe could not have taught

Every criterion this document has accumulated — robots readability, server-side
character count, requirement language, freshness — is evaluated **from wherever
the probe happens to run**. Not one of them is a property of the authority
alone. Australia is unreadable from everywhere; Finland is unreadable *from
production*, and that is a different fact with a different remedy.

So the probe's verdict is now understood as conditional: **"readable from this
host"**. A candidate that passes locally must still be proved from the host that
will actually sync it, and the only way to learn that is to try. Adding an
egress check to the probe would help only if it ran from the VPS — which is the
real fix, and is recorded as a follow-up rather than pretended to be done.

### What was NOT done about it

The requirements exist, verified, in `data/requirements/fi-*.json`. It would
have been one command to generate the migrations locally and insert the versions
into production.

That is refused. A version row asserts *"we fetched this page, at this time, and
this is its checksum"*. Inserting one from a fetch production is not permitted to
make would launder a read the daily monitor cannot repeat: the sync would report
those sources blocked every morning, the freshness audit would have nothing to
re-check against, and the provenance chain — the thing that makes a requirement
different from a memory — would be decorative. The registry would look complete
and be unmaintainable.

So Finland is registered on production and publishes **no detail pages**. Its
hub page publishes normally, because the authority, the catalogue and the
official links are verified facts that do not depend on reading the permit
pages. The detail pages render `noindex, follow` and are absent from the
sitemap. That is the quality gate working, on exactly the case it was built for.

### And the monitor was making a false claim about Migri

The blocked pages were recorded as `robots_state = 'disallowed'`. Migri disallows
nothing here. `visa-sync.service.ts` was setting that column from the *page*
fetch outcome, so a WAF block on our IP was written into the registry as the
authority's policy.

'disallowed' means stop — there is nothing to escalate. 'unknown' means we could
not read the policy, which has a remedy (`docs/operations/SOURCE_ACCESS.md`).
The code now writes `robots_state` only from what was learned trying to read
robots.txt, migration `20260823100000` corrects the 12 rows already written, and
two regression tests cover both directions.

---

## Singapore: the eleventh destination, 2026-08-23

**Done: 8 visa types, 172 requirements, 31 sources.** The first Asian
destination in the registry, and the first admitted after a candidate sweep
rather than from a shortlist written in advance.

### The sweep that found it

Nine candidate authorities were probed with `scripts/probe-authority.ts` before
Singapore was chosen. The verdicts are worth keeping, because most of them are
reasons NOT to spend a night on a country:

| Candidate | Host | Probe verdict |
|---|---|---|
| **Singapore — MOM** | `www.mom.gov.sg` | READABLE, requirement-shaped. Eligibility page normalizes to **22,328 chars** |
| **Singapore — ICA** | `www.ica.gov.sg` | READABLE, requirement-shaped. robots.txt 200 with **zero** disallows |
| Switzerland — SEM | `www.sem.admin.ch` | READABLE, requirement-shaped (5,111 chars). A real candidate, not taken tonight |
| Germany — Auswärtiges Amt | `www.auswaertiges-amt.de` | READABLE, requirement-shaped (15,709 chars). A real candidate |
| Germany — Make it in Germany | `make-it-in-germany.com` | THIN — 118KB of HTML, **94 characters** of text. JS-rendered |
| Germany — BAMF | `www.bamf.de` | 404 on the path taken from its own navigation |
| Austria — migration.gv.at | `www.migration.gv.at` | THIN — 865 chars. JS-rendered |
| Denmark — nyidanmark | `www.nyidanmark.dk` | THIN — 771 chars. JS-rendered |
| Japan — MOFA | `www.mofa.go.jp` | **robots.txt 403.** We cannot read what is permitted, so we stop |
| Japan — ISA | `www.isa.go.jp` | Readable but no requirement language — a landing page |
| Poland — UdSC | `www.udsc.gov.pl` | Readable, no requirement language |
| Estonia — politsei.ee | `www.politsei.ee` | 404 on the guessed path; not pursued further |

A second sweep after Singapore shipped, probing further afield:

| Candidate | Host | Probe verdict |
|---|---|---|
| **Malaysia — Immigration Department** | `www.imi.gov.my` | Passed every check and was WRONG — see *Malaysia* below. Student Pass and Residence Pass are real; the Employment Pass page is the site menu |
| South Korea — Immigration | `www.immigration.go.kr` | Readable, no requirement language on the English index |
| Hong Kong — Immigration Dept | `www.immd.gov.hk` | robots 404 (unrestricted), but both guessed paths 404. Needs its links read off the site, not constructed — **subsequently DONE, see below** |
| Hong Kong — GovHK | `www.hk.gov.hk` | robots.txt unreadable — STOP |
| UAE — u.ae | `u.ae` | THIN — 55KB of HTML, 1,302 characters. JS-rendered |
| Portugal — AIMA/SEF | `www.sef.pt` | robots.txt unreadable — STOP |
| Portugal — gov.pt | `www.gov.pt` | 404 on the service path |
| Ireland — DFA | `www.dfa.ie` | robots.txt 403 — STOP (ISD at `irishimmigration.ie` is already registered and fine) |

Two findings generalise:

1. **Thin is the common failure, not blocked.** Five of the nine failed by
   rendering client-side, not by refusing us. `make-it-in-germany.com` returning
   94 characters out of 118KB is the shape to watch for — a browser check would
   have called it fine.
2. **Japan is an Australia, not a Finland.** `mofa.go.jp/robots.txt` returns 403,
   so we cannot read the policy at all. That is a stop, not a retry.

Switzerland and Germany's Auswärtiges Amt both passed and are the obvious next
two. Neither was taken tonight, and neither is claimed to be done.

### Why Singapore was worth a night

Both authorities readable, and the entry regime splits in a way that teaches
something the European destinations do not:

* **ICA decides who may ENTER** — entry visa, visit pass, Student's Pass, LTVP.
* **MOM decides who may WORK** — Employment Pass, S Pass, EntrePass, ONE Pass,
  Work Permit, Dependant's Pass.

`authority_rank` is 1 for both. Neither is secondary; they govern different
questions. That is Finland's split with the opposite outcome — Finland entered
half, because `um.fi` 403s an identified agent, and Singapore entered whole.

### One visa, 33 pages, two regimes

The entry visa nearly went in wrong. ICA publishes one visa and a per-nationality
detail page for each of 33 travel documents that need one. India and Russia
differ **only** in which passport classes are exempt, which reads as one template
with cosmetic variation.

Fetching all 33 showed **two distinct substantive bodies**:

* 19 nationalities must submit a completed **Form V39A** letter of introduction
  from a Singapore citizen or PR aged 21+ with a Singpass account.
* 14 are told only that documents "may be required on a case-by-case basis".

Same visa, same S$30 fee, same three-working-day processing — and one group needs
a Singaporean sponsor before it can apply at all.

**Two samples were not enough, and would have been believed.** The generalisable
rule: when an authority publishes N near-identical pages, a diff of two of them
is evidence about those two. `scripts/visa-registry/sg-entry-visa-groups.mjs`
re-derives the grouping from all 33 and exits non-zero if the membership moves
or a third variant appears, because registering 3 sources instead of 34 means the
daily monitor watches 2 of the 33.

### What registering two routes on one night made visible

Neither of these is on any single page:

* **The Employment Pass floor is $5,600. The Dependant's Pass needs $6,000.** An
  EP holder at the bottom of MOM's own salary schedule holds a valid pass and
  cannot bring a spouse. Two MOM pages, no cross-reference. The promotion
  migration now asserts the gap, so if MOM aligns them somebody has to notice.
* **The Dependant's Pass expiring with the main work pass is the mechanism
  behind the Student's Pass rule.** A child studying on a parent's Dependant's
  Pass must apply for their own Student's Pass, assessed on the prevailing
  criteria, if the parent's pass lapses mid-course. ICA states the consequence;
  MOM states the cause.

Extracting related routes in one session is what surfaces this. Extracting them
months apart would not have.

### Cost, honestly

Eight routes in one session, against the "roughly a day per destination"
estimate this document recorded after New Zealand. Two things made it faster:
both authorities serve clean server-side text with a navigable structure, and
the per-visa source pages are named on the site's own menus, so
`scripts/list-source-links.ts` found every one of the 31 sources rather than
guessing them.

What still cost the time was reading. 172 requirements, each excerpt checked
verbatim by `scripts/verify-excerpts.ts` against the live page.

### Not covered, and said to be not covered

Personalised Employment Pass, Work Permit (and its DP-Work Permit variant),
Tech.Pass, the Work Holiday Pass and MOM's own Long-Term Visit Pass — a
different pass sharing ICA's name — are all readable and all unextracted. Four
of ICA's six Student's Pass institution types (Foreign System Schools,
Government schools, ITEs, Kindergartens) and six of the LTVP's seven
eligibility categories likewise. They are next, not done.

### Malaysia: the failure mode the probe could not see

Probed after Singapore shipped, as the next candidate. `www.imi.gov.my` passed
everything: robots 200 with one disallow, HTTP 200, **10,922 characters**
normalized from 227KB of HTML, all five requirement markers, current year in the
body. Verdict: READABLE and requirement-shaped.

It is an **820-line shared navigation menu with three unique lines of content**.
"apply", "document", "fee", "requirement" and "eligib" are all menu labels. The
character count is the menu.

```
imi.gov.my  employment-pass    3/173 lines unique (2%)
imi.gov.my  student-pass      97/267 (36%)
imi.gov.my  residence-pass    99/269 (37%)
mom.gov.sg  employment-pass  188/205 (92%)
mom.gov.sg  s-pass            46/63  (73%)
mom.gov.sg  entrepass         54/65  (83%)
```

**Boilerplate is by definition what two pages share, so no single-page check can
find it.** Character count and marker matching are both properties of one page
in isolation. `probe-authority.ts` now diffs every page against the others
fetched from the same host and flags any whose unique content is a handful of
lines.

Malaysia was not rejected — its other pages carry real content — and it became
the **twelfth destination** the same night. What is rejected is the *Employment
Pass* page as a source, and the assumption that a big character count means a
rich page.

### Malaysia, done: 2 visa types, 44 requirements

`my-student-pass` and `my-long-term-social-visit-pass`, chosen on the unique-line
ratio rather than on the visa's importance — which is a better selection rule
than it sounds, because a page with nothing on it cannot produce requirements
however important the route is.

Two findings worth carrying:

1. **The ordering IS the requirement.** Malaysia's student route runs
   outside-Malaysia → EMGS academic screening → eVAL → eVisa → entry →
   post-arrival medical within 7 days → institution submits. Each step gates the
   next. An applicant who approaches Immigration first has not started early,
   they have started in the wrong place. The promotion migration asserts the
   steps render in that order.
2. **"Can a spouse work?" now has four different answers in this registry.**
   Malaysia's LTSVP permits work "without the need to convert to an employment
   pass"; Singapore's Dependant's Pass requires a separate work pass the EMPLOYER
   applies for, and getting an Employment Pass cancels the dependency; the ONE
   Pass restores a Letter of Consent; Ireland's family route is different again.
   None of the authorities mentions any of the others.

**A near-miss worth recording.** The VPS readability check first reported 45KB
against 244KB locally — the exact shape of the Finland failure. It was `curl`
reporting the gzip wire size; decompressed, the VPS reads 244,685 against
244,594. "The numbers differ" and "the content differs" are not the same
finding, and only one of them is a stop.

### And Singapore's probe verdict was confirmed from production

The Finland lesson says a probe's verdict is conditional on the host it runs
from. Before deploying, all 31 Singapore source URLs were re-fetched **from the
VPS**, with the monitor's own User-Agent. All 31 returned 200, with byte counts
within a percent of the local reads — no WAF challenge, no different content.
Singapore is readable from the host that will actually sync it, which is the
check Finland failed.

---

## Hong Kong SAR: the thirteenth destination, 2026-08-24

**Done: 2 visa types, 38 requirements, 2 sources.** Both bounded, both live.

### It was never blocked — the URLs were guessed

Hong Kong failed two probes in the second sweep and **both failures were ours**:

* `www.hk.gov.hk/robots.txt` is unreadable. A genuine stop — but that is GovHK,
  the portal, not the authority.
* `www.immd.gov.hk/robots.txt` returns **404**, which by the rule Germany set
  means no restrictions. The two paths tried simply did not exist.

`scripts/list-source-links.ts` against `/eng/services/index.html` returned
**thirty real visa pages in one fetch** — GEP, ASMTP, QMAS, IANG, dependants,
investment, the Capital Investment Entrant Scheme, foreign domestic helpers,
and more.

**Fourth time in this document a "blocked" call has turned out to be a guessed
URL** (after UDI's hidden input, Sweden's `/en/` tree and Ireland's nested
study page). The rule already written here held again: *a null from one probe is
evidence about that probe.* The generalisation worth adding is narrower and
sharper — **check you are probing the AUTHORITY and not the government portal
that links to it.** `hk.gov.hk` and `immd.gov.hk` gave opposite answers about
the same country on the same day.

### One URL, two flows — both routes needed bounds

`GEP.html` and `quality_migrant_admission_scheme.html` are tabbed pages carrying
**both** the entry application and the extension of stay, each with its own
eligibility criteria, supporting documents, processing time and fee section.
"processing time" occurs four times on the GEP page.

`verify-extraction-bounds.ts` reports that **1 of GEP's 19 excerpts and 2 of
QMAS's 19 also appear verbatim outside the bound**. Unbounded, those would have
verified clean while attributing a first-application rule to a renewal — the
Norway lesson, on a different continent and a different page shape.

Anchors used: start at each page's own introduction sentence, end before
`extension of stay apply now`. That phrase also appears in the top navigation,
which is why `ends_before` resolving *after* the start anchor matters.

### What two routes on one night showed

Hong Kong runs an **employer-sponsored** route and a **self-sponsored** one side
by side, and neither page mentions the other:

| | GEP | QMAS |
|---|---|---|
| Job offer | Confirmed offer, genuine vacancy, role the local workforce cannot fill | **Not required** |
| Decision | Criteria, then discretion | Prerequisites → points test → **selection exercise** → issuance |
| Initial stay | 36 months **on employment condition** | 36 months **time limitation only** |
| Discretion | May refuse an application meeting every criterion | May also decide a criterion was *not met*, and refuse **without giving any reason** |

**The points are not the decision.** QMAS's threshold qualifies an applicant for
a periodic competition — "not all applications meeting both the prerequisites
and the passing threshold will necessarily be approved" — judged by a panel
weighing Hong Kong's manpower needs across sectors. Singapore's COMPASS is 40
points and you are through. Recording the threshold without recording that stage
would describe a scheme that does not exist.

**And the authority disclaims its own checklist.** "the director of immigration
reserves absolute discretion to refuse any application even if the application
meets all eligibility criteria." No other authority in this registry says it
that plainly. It is stored first on the GEP route, ahead of the criteria it
qualifies.

### "Can a spouse work?" — now five answers

Hong Kong's dependants "are not prohibited from taking up employment or studies
in the hksar under the existing policy" — no separate permission at all. Beside
Singapore's (an employer-lodged work pass, and getting an EP *cancels* the
dependency), Singapore's ONE Pass (a Letter of Consent), Malaysia's (permitted
on the same pass, by endorsement, with a stamped contract) and Ireland's.

Five authorities, five mechanisms, none of them referring to any other. This is
the clearest recurring argument for a registry that holds routes side by side.

### Not covered, and said to be not covered

ASMTP (mainland talents), IANG (non-local graduates), the Capital Investment
Entrant Scheme, Technology Talent Admission, foreign domestic helpers,
residence as dependant of a Hong Kong resident, and the Top Talent Pass are all
readable on the same estate and unextracted. The extension-of-stay flows of both
registered routes are excluded by their bounds. They are next, not done.

## Candidate triage, 2026-08-24

`scripts/classify-egress.sh` asks one cheap question of a candidate host —
robots.txt from two egress paths — before anybody spends time on it. Results
below are TRIAGE, not evidence: a host reaching "readable" still needs its
officiality verified and its content probed before it becomes a row in
`data/country-probe-evidence.json`.

| Candidate host | Local | VPS | Reading |
|---|---|---|---|
| `nyidanmark.dk` | 404 | 404 | no robots.txt — unrestricted. **Verified official, probed, `ready`** |
| `hikorea.go.kr` | 302 | 302 | readable — officiality not yet verified |
| `icp.gov.ae` | 200 | 200 | readable — officiality not yet verified |
| `immigration.go.th` | 200 | 200 | readable — officiality not yet verified |
| `migration.gv.at` | 301 | 301 | readable — officiality not yet verified |
| `udsc.gov.pl` | 302 | 302 | readable — officiality not yet verified |
| `inm.gob.mx` | 400 | 400 | odd status from both — investigate, do not assume refusal |
| `sem.admin.ch` | 000 | 000 | no connection from either path — check the hostname first |

Five readable candidates is the useful output. Each is a country that is
plausibly cheap to research, which is worth more than another pass over the ones
that are already known to be blocked.

**A 404 is not a refusal**, and the first version of the classifier said it was.
It bucketed `>= 400` as "the authority refuses our bot" and filed Denmark — the
best candidate in the batch — as permanently blocked. `probe-authority.ts` had
always known better ("a 404 is different: conventionally no restrictions"), and
the classifier threw that away. Same shape as bucketing client-rendered pages
with parse errors: one bucket for two facts hides both, and here it would have
hidden the one country worth doing next.

