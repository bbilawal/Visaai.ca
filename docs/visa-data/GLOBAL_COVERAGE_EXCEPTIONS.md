<!-- GENERATED FILE — do not hand-edit.
     generator: scripts/visa-registry/generate-global-catalog.mjs
     §5.1 requires these to be produced FROM the registry, never maintained
     beside it: two documents that disagree both look authoritative. -->

# Global coverage exceptions

Two different things live here, and the difference is the point.

## Blocked by the authority — evidence-backed exceptions

15 visa type(s). Every source for these routes is either
robots-disallowed or has failed repeatedly, so no requirement can be extracted
and none is published. The evidence is the monitor's own record.

| Country | Visa type | Sources | Evidence |
|---|---|---|---|
| Australia | Business Innovation and Investment (Provisional) visa (subclass 188) | 2 | 56 consecutive failures |
| Australia | Electronic Travel Authority (subclass 601) | 2 | 56 consecutive failures |
| Australia | Partner visa (apply in Australia) (subclass 820 and 801) | 4 | 56 consecutive failures; robots disallows |
| Australia | Skilled Independent visa (subclass 189) | 2 | 56 consecutive failures |
| Australia | Skills in Demand visa (subclass 482) | 4 | 56 consecutive failures; robots disallows |
| Australia | Student visa (subclass 500) | 5 | 56 consecutive failures; robots disallows |
| Australia | Temporary Graduate visa (subclass 485) | 2 | 56 consecutive failures |
| Australia | Visitor visa (subclass 600) | 4 | 56 consecutive failures; robots disallows |
| Australia | Visitor visa (subclass 600) — Business visitor stream | 2 | 56 consecutive failures |
| Australia | Working Holiday visa (subclass 417) | 2 | 56 consecutive failures |
| Finland | Residence permit application for an employed person (TTOL) | 2 | 31 consecutive failures |
| Finland | Residence permit application for an entrepreneur | 2 | 31 consecutive failures |
| Finland | Residence permit application for persons employed as a specialist | 2 | 31 consecutive failures |
| Finland | Residence permit application for studies | 2 | 31 consecutive failures |
| Finland | Residence permit application on the basis of family ties when your spouse has a residence permit | 4 | 31 consecutive failures |

## Registered but not yet extracted

0 visa type(s) whose sources are readable and whose requirements
have simply not been extracted yet. Not an exception — unfinished work.

None: every registered visa type with a readable source has been extracted.

## Assessed and not admitted — evidence-backed

10 countries probed, some since moved out of scope —
their findings are kept because research that leaves no trace is the problem
this section exists to fix. Probed FROM THE VPS, because a local result is
not evidence about production — Finland passed every reachability check from a
laptop and failed from the syncing host. These DO satisfy §84's "named in the
evidence-backed exception ledger", because each carries a measurement.

### Bahrain (BH) — `blocked_by_bot_challenge` — in scope

Probed 2026-08-24 from VPS (2.24.196.5), compared against a second egress.

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Bahrain eVisa (evisa.gov.bh)](https://www.evisa.gov.bh/) | Official visa portal | **CLOUDFLARE BOT CHALLENGE - will not be circumvented** | Re-diagnosed 2026-08-26. The 403 is not a policy refusal and not an IP ban: it carries 'cf-mitigated: challenge', 'server: cloudflare' and a 'Just a moment...' interstitial body. Cloudflare is challenging the request because it comes from a datacentre address. Identical for IPv4 and IPv6, for a browser User-Agent, for HTTP/1.1, and for full browser headers. |

RECLASSIFIED from blocked_by_our_egress. Calling this 'our egress' implied it was ours to fix, and the obvious fix - route through an address Cloudflare does not challenge - is bot-detection evasion. We will not do that, whoever asks. The legitimate routes are an approach to the authority for allowlisting, or leaving Bahrain unpublished. Bahrain therefore does NOT belong with Portugal in BL-3.

### Cyprus (CY) — `blocked_by_authority` — in scope

Probed 2026-08-24 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior (moi.gov.cy)](https://moi.gov.cy/en/) | Official immigration authority | **ROBOTS DISALLOWS EVERYTHING** | robots.txt returns 200 and its rule is `Disallow: /` — the entire site is closed to automated reading. Unambiguous, and reachable: the file was served to us so we could read the answer. |

The cleanest possible exception. This is not a WAF, an IP block or a parse failure — the authority publishes crawl rules and its rules say no to everything. Respecting that is non-negotiable (spec rule 9), and there is nothing to revisit technically. Any future access is an outreach conversation.

### Iran (IR) — `blocked_unresolvable_redirect_loop` — in scope

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Foreign Affairs](https://mfa.gov.ir/) | Visa authority | **ROBOTS.TXT REDIRECTS TO ITSELF — UNRESOLVABLE** | Followed from the VPS with a redirect budget: `https://mfa.gov.ir/robots.txt` answers 307 pointing at `https://mfa.gov.ir/robots.txt`, and does so every time — curl exits 47, "Maximum (5) redirects followed", with the effective URL unchanged. The home page behaves identically. |
| [e-Visa portal](https://evisa.mfa.ir/) | Application system | **SAME LOOP** | Both robots.txt and the root answer 307 to themselves; 5 redirects followed, 0 bytes, no terminal response. |

The first pass left Iran deliberately unresolved rather than blocked, because reading a 307 as a refusal is a mistake this project had already made twice in one session. That caution was right and the answer is now in: the redirect does not terminate. It points at itself.

So this is NOT the Australian case — nobody has refused us. It is the case where the crawl rules cannot be obtained at all, and the consequence is the same, because we do not read a site whose robots.txt we cannot read. Recorded under its own conclusion so it is never confused with a refusal, and so that a future session can tell in one glance whether the loop has been fixed.

### Iraq (IQ) — `readable_but_publishes_only_outbound_services` — in scope

Probed 2026-08-25 from undefined.

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior (moi.gov.iq)](https://moi.gov.iq/) | Official interior ministry | **ROBOTS PERMITS, SERVER REFUSES (HTTP 403)** | robots.txt 200 with 3 disallow lines and the requested path ALLOWED by them; the page then returns HTTP 403. The refusal governs. |
| [Ministry of Foreign Affairs (mofa.gov.iq)](https://mofa.gov.iq/) | Consular services | **READABLE AND SUBSTANTIAL — AND ABOUT THE WRONG DIRECTION OF TRAVEL** | FOUND on the 2026-08-25 re-probe and readable at 7,829 characters with a 12,514-URL WordPress sitemap. Its readable service pages are Iraqi PASSPORT services for Iraqi citizens: passport issuance, passport extension, replacement of a lost passport, laissez-passer. They are real, current and useful, and not one of them is about entering Iraq. Publishing them under an Iraq visa route would put a page about Iraqi passports in front of someone asking how to enter the country — worse than publishing nothing, because it looks like an answer. |
| [MFA www variant (www.mofa.gov.iq)](https://www.mofa.gov.iq) | Same ministry, www host | **ROBOTS PERMITS, SERVER REFUSES (HTTP 530)** | HTTP 530 from the VPS — an origin-unreachable status returned by the edge. |
| [Candidate hosts (evisa.mofa.gov.iq, gov.iq, dop.gov.iq)](https://evisa.mofa.gov.iq) | Looking for an inbound-visa or passports-directorate host | **DNS FAILS** | ENOTFOUND for evisa.mofa.gov.iq and dop.gov.iq; ENODATA for gov.iq. These are evidence about the NAMES we guessed, not about Iraq. |

RECLASSIFIED 2026-08-25 from blocked_by_authority. The interior ministry does refuse us, and that part is unchanged. What changed is that a SECOND Iraqi authority was found, is readable, and publishes a real service corpus — for Iraqi citizens travelling out, not for foreigners coming in. The distinction matters because 'blocked' invited a future session to keep hunting for a way past a 403, and the actual open question is different: does any Iraqi authority publish inbound entry requirements at all?

### Israel (IL) — `blocked_by_authority` — in scope

Probed 2026-08-24 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Population and Immigration Authority (gov.il)](https://www.gov.il/en/departments/population_and_immigration_authority/govil-landing-page) | Official immigration authority | **ROBOTS PERMITS, SERVER REFUSES** | robots.txt returns 200 with ZERO disallow lines — the site explicitly permits crawling — and the page itself then returns HTTP 403. Two official signals that contradict each other. (robots.txt is also 403 from a second egress and 200 from the VPS, so the refusal is not simply IP reputation.) |

Recorded as blocked because the server refused the content, but the contradiction is worth keeping: a robots.txt with no disallow lines is an invitation, and a 403 on the page is a refusal. Where the two disagree the refusal governs — we do not get to treat the permissive signal as the operative one because it is the one we prefer. Worth revisiting through the outreach process rather than technically.

### Kuwait (KW) — `readable_but_publishes_no_requirements` — in scope

Probed 2026-08-25 from undefined.

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior — Residence Affairs](https://www.moi.gov.kw/main/eservices/residence) | The residence service page, read off the ministry home page rather than constructed | **READABLE — AND IT DESCRIBES THE DEPARTMENT, NOT THE REQUIREMENTS** | robots.txt 200 with ZERO disallow lines — fully unrestricted. HTTP 200, 2,206 characters. RECLASSIFIED 2026-08-25 from blocked_by_client_rendering, which was the wrong conclusion: the page is not empty and is not script-rendered, it simply is not about visa requirements. Its substantive content is a directorate mandate — 'organising and supervising the entry and exit of foreigners through the ports or their residence, in addition to keeping residence files for expatriates and recording violations' — plus a link to the Ministerial Decree on the Regulation of the Residence Law. It states no requirement, no fee, no document and no eligibility. Registering it as a visa route would publish a page whose entire content is a job description. |
| [Kuwait Government Online (e.gov.kw)](https://www.e.gov.kw) | National portal | **ROBOTS REFUSED (HTTP 403)** | robots.txt returns 403 from the VPS. We cannot read what is permitted, so we stop. |
| [Kuwait eVisa (evisa.moi.gov.kw)](https://evisa.moi.gov.kw) | eVisa system | **ROBOTS REFUSED (HTTP 502)** | robots.txt returns HTTP 502 from the VPS. |
| [Ministry of Foreign Affairs (mofa.gov.kw)](https://www.mofa.gov.kw) | Consular / visa issuance | **ROBOTS PERMITS, SERVER REFUSES (HTTP 403)** | The published crawl rules permit the path and the server returns 403. The refusal governs. |

The 2026-08-25 re-probe widened Kuwait from one host to six and changed the SHAPE of the finding rather than its outcome. It is no longer 'the page is client-rendered' — the page reads fine. It is 'the readable page is about something else, and every other Kuwaiti host either refuses us or does not answer'. That is a better record: a future session knows not to re-probe moi.gov.kw expecting requirements to appear, and knows the open question is whether Kuwait publishes entry requirements anywhere at all.

### Saudi Arabia (SA) — `blocked_by_client_rendering` — in scope

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Foreign Affairs — eServices index](https://www.mofa.gov.sa/en/eservices/Pages/default.aspx) | The service catalogue | **READABLE, BUT THE WRONG CATALOGUE** | robots.txt 200 with ZERO disallow lines. HTTP 200, 391,235 bytes raw normalizing to 18,499 characters, 180 of 209 lines (86%) unique, body references 2026. It enumerates roughly forty services and they are overwhelmingly DIPLOMATIC-MISSION services — work visas requested by embassies, exit-reentry visas for accredited mission staff, luggage export permits for diplomats. |
| [Ministry of Foreign Affairs — individual service pages](https://www.mofa.gov.sa/en/eservices/Pages/svc3.aspx) | Where per-service requirements would live | **NO BODY TEXT SERVER-SIDE** | HTTP 200, 183,555 bytes raw normalizing to 4,311 characters — all of it site navigation and Arabic cookie boilerplate. The service description itself is not in the served markup. A sibling (svc25) behaves identically at 6 of 40 lines (15%) unique. |
| [Visa Services Platform](https://ksavisa.sa/) | Where general public visa requirements would live | **CLIENT-RENDERED — NOTHING TO EXTRACT** | robots.txt 200 with 1 disallow line, path ALLOWED. HTTP 200, 15,182 bytes raw normalizing to ZERO characters. |

Saudi Arabia fails twice over, and the two failures are different. The ministry's eServices index IS readable and IS enumerable — 86% unique, current year — and what it enumerates is a diplomatic-mission service desk rather than a public visa catalogue. Registering those forty services as visa types would produce a country page about luggage export permits for embassy staff.

The general public visa platform, linked from the same site, sends zero characters. So the readable catalogue is the wrong one and the right one is unreadable. Recorded as client-rendering rather than refusal: every host here serves us willingly.

### State of Palestine (PS) — `authority_reachable_publishes_no_entry_requirements` — in scope

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior](https://moi.gov.ps/) | Palestinian government host — FOUND on this pass | **READABLE AND CURRENT, BUT NOT AN ENTRY-REQUIREMENTS PUBLISHER** | robots.txt returns 200 with a single `Disallow: /private/` — the site permits us everywhere else. HTTP 200, 424,904 bytes raw normalizing to 32,364 characters, body references 2026. Enumerating its links returns news posts, photo galleries, martyr records and security-service pages; no visa or entry section exists to probe. |
| [Ministry of Interior — e-services](https://eservice.moi.gov.ps/) | Where services would live | **CLIENT-RENDERED** | robots.txt 404. HTTP 200, 11,392 bytes raw normalizing to 109 characters. Latest year in body: 2021. |

CORRECTION to this entry's own first verdict, and the correction matters. Palestine was recorded as 'no official government web host publishing entry or visa requirements was identified, so there was nothing to probe'. There IS one: moi.gov.ps answers, publishes crawl rules that permit us, serves 32,000 characters and references the current year. The first pass simply had not found it.

What changes is the QUALITY of the exception, not its outcome. The finding is no longer 'we could not find an authority' — which is a statement about our search — but 'the authority is reachable, willing and readable, and publishes no entry or visa requirements', which is a statement about what it publishes. That is consistent with the substantive position §4 asks us to model from authoritative sources rather than assert politically: entry to the West Bank and Gaza is not controlled at points the Palestinian Authority administers.

Recorded so that a future session probes moi.gov.ps for a new section rather than starting again from 'is there a host at all'.

### Syria (SY) — `blocked_by_client_rendering` — in scope

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior](https://moi.gov.sy/) | Candidate immigration authority | **CLIENT-RENDERED — NOTHING TO EXTRACT** | robots.txt 404 — unrestricted. HTTP 200, 1,133 bytes raw normalizing to ZERO characters. Unchanged from the first pass and re-confirmed from the VPS. |
| [Other candidate hosts](immigration.gov.sy, passport.gov.sy, mfa.gov.sy) | Looking for a second Syrian authority | **NO CONNECTION FROM THE VPS** | All three return no HTTP status at all. Recorded as unreachable, not as refusal. |

Syria was already recorded as client-rendered on one host. This pass looked for a second and found none reachable: three further candidate hostnames produced no connection. That is not evidence about Syria's policy and it is not filed as one — it is evidence that we have found exactly one Syrian government host that answers, and it sends no text.

### Yemen (YE) — `unresolved_no_reachable_authority` — in scope

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Candidate hosts](moi.gov.ye, ipa.gov.ye, passports.gov.ye, immigration.gov.ye) | Identifying an authority before probing one | **NO CONNECTION FROM THE VPS** | Four candidate hostnames, all returning no HTTP status. Identical behaviour across all four, which makes a per-host outage unlikely and tells us nothing about which of them, if any, is the right authority. |

Unchanged in substance and widened in evidence: the first pass tried one hostname, this pass tried four, and none answers. The honest position is still the one recorded before — we have not established that any of these is Yemen's immigration authority, so a failure to connect is not yet a finding about Yemen.

Naming the right authority comes first, and doing that needs a source we have not got: an official Yemeni government directory that itself answers. Recorded as unresolved rather than blocked, because 'blocked' would assert a refusal nobody made.


## Nobody has looked yet — NOT an evidence-backed exception

0 countries, all IN SCOPE. §84 asks that every
in-scope country be "researched, or named in the evidence-backed exception
ledger". A country listed HERE is named and nothing more: nobody has probed
its authority, so nothing is known about whether it could be read, and naming
it does not convert absence of work into a documented decision.

**None — and that is the §84 item 65 condition.** Every in-scope country is
either researched or carries a per-country measurement in the section above.
The distinction this section exists to protect still holds: it is not that
every country was admitted, it is that none was skipped.

## Out of scope — not a gap

159 countries are in the registry and outside VisaAI's scope
as set on 2026-08-24 (spec §4.1, list in `data/country-scope.json`). They are
NOT counted as outstanding work: covering fewer places properly is a decision,
and reporting a decision as a debt would make the remaining work look
permanently unfinishable.

Their rows are kept rather than deleted — ISO code, canonical name and slug are
verified data, `support_state = 'unsupported'` already keeps them off the
public site, and widening scope is an edit to one file.
