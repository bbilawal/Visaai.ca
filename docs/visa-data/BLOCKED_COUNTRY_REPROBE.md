# Re-probe of the 19 countries VisaAI cannot publish

**Probed 2026-08-24 from the VPS (2.24.196.5 / 2a02:4780:75:7017::1), with the
monitor's own User-Agent and fetch policy.** Raw measurements in
`artifacts/probe/host-discovery.json` and `artifacts/probe/links-batch{A..D}.json`.

## Why this pass exists

`GLOBAL_COVERAGE_EXCEPTIONS.md` recorded 19 countries as unpublishable. Every
one of those verdicts came from probing **one host per country**, and the
project's own history says that reasoning has been wrong four times out of four:

| Country | Recorded as | What was actually there |
|---|---|---|
| Norway (UDI) | catalogue unreadable | the routes were in `<input type="hidden">` |
| Sweden | Swedish-only | an English tree at `/en/`, 1,011 URLs |
| Ireland | 2,717-char router | a 16,600-char page one link below |
| Hong Kong | robots unreadable | wrong host — `immd.gov.hk` was open |

**A null from one probe is evidence about that probe.** So this pass asked a
different question — *does ANY government host for this country answer and
permit us?* — against **116 candidate hosts across 19 countries**, then
enumerated the links of every host that answered.

Nothing here was circumvented. Bot challenges, WAF refusals and `Disallow: /`
were recorded and obeyed. No slug space was enumerated; URLs were read off
sitemaps and the authorities' own markup.

---

## Result

| | Countries |
|---|---|
| **Unblocked — a readable official authority was found** | 7 — US, France, Japan, Thailand, Portugal, Oman, Australia\* |
| **Partial — one readable page, not a corpus** | 4 — Jordan, Qatar, Kuwait, Iraq |
| **Still blocked — re-confirmed against 3–6 hosts each** | 8 — Cyprus, Israel, Iran, Bahrain, Saudi Arabia, Syria, Palestine, Yemen |

\* Australia needs a product decision before it can be built; see below.

**11 of 19 verdicts changed.** In every unblocked case the authority that
refuses us is still refusing — what changed is that it was never the only
authority.

---

## Unblocked

### United States — the largest single unlock

`travel.state.gov` still returns 403 on `robots.txt` and is still off limits.
It is the **consular issuance** desk, not the authority for status and
eligibility.

| Host | robots | Measurement |
|---|---|---|
| `www.uscis.gov` | 200, path allowed | **19,918 sitemap pages**, 3,031 visa-like. Every page probed returned 5–6 requirement markers at 5,400–21,100 chars: `/i-129` (15,718), `/i-539` (15,172), `/i-485` (21,072), `/visit-the-united-states/change-my-nonimmigrant-status` (9,468), `/working-in-the-united-states/temporary-nonimmigrant-workers` (13,235) |
| `www.cbp.gov` | 200, path allowed | 14,000 sitemap pages, 1,278 visa-like. `/travel/international-visitors/visa-waiver-program` 8,954 chars, `/travel/international-visitors/esta` 8,007 |
| `www.ice.gov` | 200, path allowed | 22,764 sitemap pages. `/sevis/travel` **39,479 chars / 6 markers**, `/sevis/students` 11,342 |
| `studyinthestates.dhs.gov` | 200, path allowed | 40 of 40 same-host links visa-like. `/students/maintaining-status` 10,601, `/schools/report/maintaining-accurate-sevis-records` 19,540 |

English, current (bodies reference 2026), server-rendered, and enumerable from
declared sitemaps. **The US is researchable today with no new capability.**

### France

`france-visas.gouv.fr` still refuses `robots.txt` (403) and stays off limits.

`www.service-public.fr` redirects to **`www.service-public.gouv.fr`**, whose
`robots.txt` returns 200 and **allows the path**. Its "Étranger - Europe" theme
(`/particuliers/vosdroits/N19804`) publishes the whole tree:

| Section | Node |
|---|---|
| Entrée en France | `N105` |
| Travail en France | `N107` |
| Titre de séjour et document de circulation | `N110` |
| Installation en France d'une famille étrangère | `N11165` |
| Nationalité française | `N111` |
| Demande d'asile | `N106` |

Leaf pages are server-rendered at 15,352–147,428 chars, and each carries an
`?lang=en` English variant. This is DILA, the state's own publisher.

**Note the near-miss:** the earlier probe used `N19806`, which is
*Travail - Formation* — a different theme entirely. The foreign-nationals tree
was one node away.

### Japan

MOFA still returns 403 on `robots.txt`. The **Immigration Services Agency** on
`www.moj.go.jp` does not, and the earlier "navigation shell" reading was taken
from index pages rather than from the pages one level below them:

| Page | Chars |
|---|---|
| `/isa/applications/status/qaq5.html` — 在留資格一覧表, the residence-status catalogue | 6,824 |
| `/isa/applications/status/student.html` — 21. 留学 | 9,718 |
| `/isa/applications/status/spouseorchildofpermanentresident.html` — 27. 永住者の配偶者等 | 9,760 |
| `/isa/immigration/faq/kanri_qa.html` — 出入国審査・在留審査Q&A | 30,349 |
| `/isa/support/fresc/fresc01.html` | 12,164 |

Japanese only. Sweden already set the precedent that a non-English authority is
acceptable with English labels marked as translations, so the open question from
the ledger's first pass — *is a Japanese source admissible?* — is settled; what
was missing was a page with requirements on it, and these are those pages.

### Thailand

`immigration.go.th` still answers 403 on the page while its `robots.txt` permits
it; the refusal governs and it stays off limits. Two other official hosts answer:

- **`consular.mfa.go.th`** — Department of Consular Affairs. The section
  *ตรวจลงตรา และเอกสารเดินทางคนต่างด้าว* ("visa issuance and alien travel
  documents") serves **18,799 chars / 5 markers**, inside a tree of 78 readable
  visa-like pages (9,000–25,700 chars each). Thai.
- **`www.thaievisa.go.th`** — the official e-Visa system. Its own pages serve
  **0 chars** (genuinely client-rendered), but its sitemap **names the exact
  official route catalogue**, all HTTP 200:
  `tourist-visa`, `transit-visa`, `business-investor-visa`, `long-stay-visa`,
  `ltr-visa`, `smart-visa`, `courtesy-visa`, `diploma-official-visa`,
  `non-immigrant-ed`, `non-immigrant-f`, `non-immigrant-m`, `non-immigrant-o`,
  `non-immigrant-r`, `non-immigrant-rs`.

That combination is worth naming: **the catalogue and the requirements live on
different hosts.** thaievisa names the routes; consular.mfa publishes the rules.

### Portugal

Confirms and extends the ledger's own correction. `aima.gov.pt` is readable from
the VPS (the TLS-chain fix holds): **490 sitemap URLs, 85 visa-like**, and the
FAQ tree is substantive —
`/perguntas-frequentes-faqs/autorizacao-de-residencia-para-investimento-ari`
26,935 chars, and its English sibling
`/faq-residence-permit-for-investment-activity-ari` **25,828 chars / 7 markers**.
`vistos.mne.gov.pt` still drops our source IP.

### Oman — work routes only

`www.mol.gov.om` (Ministry of Labour): **250 sitemap URLs, ~23 work-permit
service pages**, each 5,300–7,700 chars with 4 requirement markers — issuance,
renewal, amendment and transfer, split between individuals and establishments,
plus a summer heat-hours permit. Arabic.

The ROP e-Visa catalogue is still client-rendered (927 chars), so Oman's **entry
visas remain unreadable while its work permits are fully readable.** Those are
different route families and the country should not be admitted as if both were
covered.

> **Caution for extraction:** `mol.gov.om` serves the same page under several
> casings (`/manpoweralleservices/…`, `/ManpowerAllEServices/…`,
> `/ManpowerAllEservices/…`). Canonicalise before registering sources or the
> change monitor will track one page three times.

### Australia — readable, but not the same *kind* of source

Every departmental host refuses: `immi.homeaffairs.gov.au`,
`www.homeaffairs.gov.au` and `www.abf.gov.au` all return **403 on `robots.txt`**,
and `online.immi.gov.au` publishes `Disallow: /`.

The **Federal Register of Legislation** does not:

- `www.legislation.gov.au/robots.txt` → 200, `Disallow: /assets/` only,
  `Crawl-delay: 10`.
- `api.prod.legislation.gov.au/robots.txt` → 404 (unrestricted). It is a public
  OData API — the site's own front end reads from it.
- **Migration Regulations 1994** (`F1996B03551`, status `InForce`) →
  `/latest/text` serves **66,789 chars server-side**, listing the subclasses
  from Schedule 2: 500 Student, 590 Student Guardian, 600 Visitor, 601 ETA,
  602 Medical Treatment, 651 eVisitor, 771 Transit, and the rest.
- **Migration Act 1958** (`C1958A00062`) → 61,724 chars.

**This is a different kind of source from every other country in the registry,
and that is a product decision, not an engineering one.** Everywhere else,
VisaAI quotes the administering authority's own published requirements. Here we
would be quoting the *binding law* while the administering department refuses to
be read. The law states the criteria; it does **not** state the department's
document checklists, and the two are not interchangeable. Publishing Schedule 2
criteria under a heading users will read as "documents you need" would be
accurate about the law and misleading about the application.

---

## Partial — one readable page, not a corpus

| Country | Best readable page | Measurement | What it is |
|---|---|---|---|
| **Jordan** | `jordan.gov.jo/AR/Pages/تأشيرات_السفر` | 3,439 chars, 4 markers | A single national-portal visa page, Arabic. `moi.gov.jo` home now reads at 9,862 chars but its e-visa link does not complete |
| **Qatar** | `mofa.gov.qa/en/consular-services/visas` | 2,868 chars, 2 markers | English and readable, but one page. `hukoomi.gov.qa` returns 403 despite permissive robots |
| **Kuwait** | `moi.gov.kw/main/eservices/residence` | 2,206 chars, 2 markers | Unchanged from the first pass; re-confirmed, not improved |
| **Iraq** | `mofa.gov.iq` | readable, 12,514 sitemap pages | Readable content is **Iraqi passport services for Iraqis** plus news — not inbound entry requirements. `moi.gov.iq` still 403 |

These are real pages, not shells. They are also not enough to describe a route,
and registering a country on one page would publish a country hub that implies
coverage we do not have.

---

## Still blocked — re-confirmed, and three findings sharpened

| Country | Hosts probed | Outcome |
|---|---|---|
| **Cyprus** | 6 | `moi.gov.cy` **and** `www.mfa.gov.cy` both publish `Disallow: /`; `gov.cy` and `mfa.gov.cy` return 403; two candidate hosts do not resolve. Two independent blanket refusals — the cleanest exception in the ledger, unchanged |
| **Israel** | 4 | `gov.il` 403 on the page, `piba.gov.il` and `mfa.gov.il` 403 on `robots.txt`, `embassies.gov.il` 552 chars. Four hosts, all closed |
| **Iran** | 5 | All five return the **same self-referential 307** on `robots.txt`. Widened from 2 hosts to 5; the loop is systemic, not one broken file |
| **Bahrain** | 6 | `evisa.gov.bh` 403, `bahrain.bh` `Disallow: /`, `mofa.gov.bh` 405, `lmra.gov.bh` 403, `npra.gov.bh` no connection. Only `iga.gov.bh` reads — and it is the eGovernment *authority*, not a visa publisher |
| **Saudi Arabia** | 7 | `ksavisa.sa` still 0 chars from 15,182 bytes; `my.gov.sa` 403; `visa.mofa.gov.sa` is a login portal (1,269 chars) whose only readable artefact is a 772 KB Arabic PDF user manual; `mofa.gov.sa` re-confirmed as a diplomatic-mission desk |
| **Syria** | 6 | **Sharpened.** `mofaex.gov.sy` (MFA and Expatriates) is newly readable at **10,843 chars** — the first Syrian ministry host that answers with text. It publishes news, not requirements. The finding moves from *"we found no readable host"* to *"we found a ministry and it publishes no entry requirements"* |
| **Palestine** | 6 | **Confirmed by enumeration.** `moi.gov.ps` reads at 32,352 chars with 49 same-host links and **zero** are visa-like. The ledger's own correction holds: reachable, willing, and not an entry-requirements publisher |
| **Yemen** | 6 | **Sharpened.** `moi.gov.ye`, `www.yemen.gov.ye`, `mofa.gov.ye` and `www.mofa.gov.ye` **resolve in DNS** and never complete a connection; `passports.gov.ye` and `ipa.gov.ye` do not resolve at all. Previously all six were one undifferentiated "no connection". Still unresolved — a host that exists but never answers is not a refusal by anyone |

---

## Method notes worth keeping

**Separate DNS from connection.** "No such host" and "the host exists and the
handshake never completes" were recorded identically before and mean opposite
things: the first says we named the wrong authority, the second says something
sits in the path. Yemen and Syria both split under this test.

**Read the payload, not the render.** `www.legislation.gov.au` normalises to
under 1,500 characters and carries **11,538 characters of embedded JSON** — the
mega-menu, which is how the public API host was found at all. Six countries were
filed as `blocked_by_client_rendering` on a reading of stripped text alone; that
reading cannot see this. Thailand's `consular.mfa.go.th` yielded 131 payload
links against 161 anchors.

**A theme index is not the theme.** France was one node away: `N19806` is
*Travail - Formation*, `N19804` is *Étranger - Europe*. Probing an adjacent
identifier and reading the null as absence is the Sweden `/English/` mistake in
a new coat.

**Enumerate the whole host, not the landing page.** Japan's ISA pages were called
navigation shells — and the index pages *are* shells. The per-status pages one
level down are 9,700–30,300 characters.

**Case-variant URLs are the same page.** `mol.gov.om` serves each service under
three casings. Canonicalise before registering, or the monitor tracks one page
three times and diffs it against itself.

---

## Follow-up: what happened when each unblocking was actually attempted

The table above records what the re-probe found. This section records what
survived contact with extraction, because three of the findings did not.

### Australia — the law is readable and its provisions are not

The re-probe was right that `www.legislation.gov.au` permits us (robots 200,
`Disallow: /assets/` only, crawl-delay 10) and that the Migration Regulations
1994 (`F1996B03551`, in force) serve 66,789 characters. Building on it failed
for a reason the character count hides.

**Those 66,789 characters are a TABLE OF CONTENTS.** The text view lists
"collapse volume 1 / collapse part 1—preliminary / 1.01 name of regulations /
1.03 definitions …" through every division of every volume, and it enumerates
each subclass by name — 500 Student, 600 Visitor, 601 ETA, 651 eVisitor and the
rest. What it does not contain is a single provision. `criteria to be satisfied
at time of application` does not appear on the page. Neither does `600.21`.

The provisions ship as **DOCX and PDF volumes** ("Migration Regulations 1994
Volume 1.docx" … "Volume 4"), and the download links are rendered client-side:
the served HTML carries exactly two hrefs, `/F1996B03551/latest/downloads` and
`/F1996B03551/asmade`, and its embedded JSON contains only site-configuration
calls — `mega-menu.json`, `announcements.json`, `core.json`, `footer.json`.
No document URL is in the payload.

So Australia's position is now precise, and it is different from what the
ledger said before:

| | |
|---|---|
| Department of Home Affairs | refuses us — 403 on `robots.txt` at `immi.homeaffairs.gov.au`, `www.homeaffairs.gov.au` and `www.abf.gov.au`; `online.immi.gov.au` publishes `Disallow: /` |
| Federal Register of Legislation | **permits us**, and serves the binding law's **catalogue** |
| The provisions themselves | DOCX/PDF behind a client-rendered download flow — no server-side text |

Australia therefore stays unpublished, and its ten registered routes stay
empty. The upgrade is real even though nothing shipped: we now know the
catalogue is readable and permitted, that the blocker is a client-rendered
download flow rather than a refusal, and that the day the Register serves its
provisions as HTML — or the day someone reads a document identifier off the
API rather than guessing one — Australia becomes extractable from the binding
law without touching the Department at all.

**And the product question the first pass raised still stands.** Schedule 2
states *criteria*. It does not state the Department's document checklists, and
the two are not interchangeable. Publishing statutory criteria under a heading
users read as "documents you need" would be accurate about the law and
misleading about the application.

#### Australia — the API was read properly, and it closes the question

The first attempt stopped at "the download links are client-rendered". A second
pass read the API's own service document rather than guessing endpoints, which
is the right way to ask, and the answer is firmer than before.

`https://api.prod.legislation.gov.au/v1/` publishes its entity sets:
`Titles`, `Versions`, `Documents`, `Content`, `_FullTextVersionSearch` and
others. So the API is discoverable and we were querying it correctly. What it
yields:

- **`Versions`** — the current compilation is `F2026C00667`, compilation number
  288, in force from 2026-07-01. Real, current, and addressable.
- **`Documents`** — twelve rows for the Migration Regulations, including
  authorised PDFs of 663, 676 and 697 pages at 2–29 MB. The entity has
  `contents`, `bytes` and `fileName` properties.
- **Those three properties are NULL on every row.** The entity exposes document
  *metadata* — format, extension, page count, size, whether it is authorised —
  and no addressable content and no URL.
- **`$expand` is refused by the server**: *"Query option 'Expand' is not
  allowed."* So a version cannot be joined to its documents through the API.

And the compilation identifier does not help either. `F2026C00667` under
`/latest/text`, `/asmade/text` and bare all return the same 63,473-byte page
normalising to **2,028 characters** — a shell. Neither `criteria to be
satisfied` nor `600.21` appears.

Six avenues, all closed:

| Avenue | Result |
|---|---|
| Department hosts | 403 on `robots.txt` (immi, homeaffairs, abf); `Disallow: /` (online.immi) |
| `legislation.gov.au/{id}/latest/text` | table of contents only, 66,789 chars, no provisions |
| Compilation register id `F2026C00667` | 2,028-char shell |
| API `Documents` entity | metadata only — `contents`, `bytes`, `fileName` all null |
| API `$expand` | refused by the server |
| Embedded JSON in served HTML | site configuration only |

**Australia is closed on the evidence, not on effort.** The catalogue is
readable and permitted; the provisions are not reachable as text by any route
this project is willing to take. Re-opening it needs one of: the Register
serving provisions as HTML, the API populating `contents`, or a decision to
parse a 676-page authorised PDF — and that last one is a real option the
fetcher could already handle, since it extracts PDF text, but it needs a
document URL the API does not publish.

### Kuwait — a readable page about the department, not about visas

`www.moi.gov.kw/main/eservices/residence` reads at 2,206 characters, and its
substantive content is a **directorate mandate**: *"organising and supervising
the entry and exit of foreigners through the ports or their residence, in
addition to keeping residence files for expatriates and recording violations."*

That is a description of what the department does. It states no requirement,
no fee, no document and no eligibility. Registering it as a visa route would
publish a page whose entire content is a job description. Kuwait stays
`unsupported`.

### Iraq — readable, substantial, and about the wrong direction of travel

`mofa.gov.iq` answers, publishes a 12,514-URL sitemap, and its readable service
pages are real: passport issuance, passport extension, replacement of a lost
passport, laissez-passer. Every one of them is a service **for Iraqi citizens**.

There is no inbound-visa page among them. Publishing these under an Iraq visa
route would put a page about Iraqi passports in front of someone asking how to
enter Iraq — which is worse than publishing nothing, because it looks like an
answer. Iraq stays `unsupported`.

### What did ship

| Country | Routes | Requirements | Note |
|---|---|---|---|
| United States | 6 previously empty, filled | 117 | DHS components; travel.state.gov still refused |
| France | 18 | 222 | service-public.gouv.fr; france-visas still refused |
| Japan | 13 | 57 | ISA per-status pages; MOFA still refused |
| Thailand | 3 | 34 | MFA consular, Thai pages; the 2017 English tree deliberately unused |
| Portugal | 16 | 116 | AIMA; the MFA visa portal still drops our address |
| Oman | 6 | 33 | Ministry of Labour **work permits only**; ROP entry visas unreadable |
| Jordan | 1 | 9 | national portal visa guide |
| Qatar | 1 | 4 | MFA fee schedule — publishes a price, not an eligibility |

**Eight of nineteen countries moved. Three were tried and rejected on the
evidence. Eight remain blocked with their measurements unchanged.**
