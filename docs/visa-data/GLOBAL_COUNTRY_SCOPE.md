<!-- GENERATED FILE — do not hand-edit.
     generator: scripts/visa-registry/generate-global-catalog.mjs
     §5.1 requires these to be produced FROM the registry, never maintained
     beside it: two documents that disagree both look authoritative. -->

# Global country scope

The registry holds **196** countries: the spec's §4.1 baseline of 195
(193 UN member states, the Holy See and the State of Palestine) plus any separately
administered visa jurisdiction admitted in its own right.

- Researched, with at least one visa type: **27**
- In the canonical registry, not yet researched: **169**

A country with no visa types carries a name, an ISO code and a slug and nothing
else. It has no authority and no official URL because nobody has looked yet —
not because none exists — and `support_state = 'unsupported'` keeps it off the
public site entirely.

## Researched

| Code | Country | Support | Authority | Visa types | Currency | Last verified |
|---|---|---|---|---|---|---|
| AU | Australia | preview | Department of Home Affairs | 10 | — | 2026-08-20 |
| AT | Austria | supported | Migration Platform of the Austrian Federal Government | 11 | EUR | 2026-08-25 |
| CA | Canada | supported | Immigration, Refugees and Citizenship Canada | 8 | — | 2026-08-21 |
| CN | China | supported | National Immigration Administration (NIA) | 5 | CNY | 2026-08-26 |
| DK | Denmark | supported | Danish Immigration Service (Udlændingestyrelsen) | 10 | DKK | 2026-08-26 |
| EG | Egypt | supported | Ministry of Interior — Arab Republic of Egypt | 1 | USD | 2026-08-26 |
| FI | Finland | preview | Maahanmuuttovirasto (Finnish Immigration Service, Migri) | 5 | EUR | 2026-08-23 |
| FR | France | supported | Ministère de l'Intérieur (préfectures) | 18 | EUR | 2026-08-24 |
| HK | Hong Kong SAR | supported | Immigration Department of the Hong Kong Special Administrative Region | 4 | HKD | 2026-08-24 |
| IE | Ireland | supported | Immigration Service Delivery | 5 | EUR | 2026-08-21 |
| JP | Japan | supported | Immigration Services Agency (出入国在留管理庁) | 13 | JPY | 2026-08-24 |
| JO | Jordan | supported | Ministry of Interior (وزارة الداخلية) | 1 | — | 2026-08-24 |
| LB | Lebanon | supported | General Directorate of General Security (Lebanon) | 10 | LBP | 2026-08-26 |
| MY | Malaysia | supported | Jabatan Imigresen Malaysia (Immigration Department of Malaysia) | 3 | MYR | 2026-08-24 |
| NL | Netherlands | supported | Immigratie- en Naturalisatiedienst (IND) | 5 | EUR | 2026-08-21 |
| NZ | New Zealand | supported | Immigration New Zealand | 5 | NZD | 2026-08-21 |
| NO | Norway | supported | Utlendingsdirektoratet (UDI) | 5 | NOK | 2026-08-22 |
| OM | Oman | supported | Ministry of Labour (وزارة العمل) | 6 | OMR | 2026-08-24 |
| PT | Portugal | supported | AIMA — Agência para a Integração, Migrações e Asilo | 16 | EUR | 2026-08-24 |
| QA | Qatar | supported | Ministry of Interior (وزارة الداخلية) | 1 | QAR | 2026-08-24 |
| SG | Singapore | supported | Immigration & Checkpoints Authority (ICA) | 8 | SGD | 2026-08-23 |
| SE | Sweden | supported | Migrationsverket (Swedish Migration Agency) | 5 | EUR | 2026-08-22 |
| TH | Thailand | supported | Immigration Bureau, Royal Thai Police (สำนักงานตรวจคนเข้าเมือง) | 3 | THB | 2026-08-24 |
| TR | Türkiye | supported | Presidency of Migration Management (Göç İdaresi Başkanlığı) | 15 | — | 2026-08-26 |
| AE | United Arab Emirates | supported | Federal Authority for Identity, Citizenship, Customs & Port Security (ICP) | 3 | AED | 2026-08-25 |
| GB | United Kingdom | supported | UK Visas and Immigration | 7 | — | 2026-08-21 |
| US | United States of America | supported | U.S. Citizenship and Immigration Services | 9 | — | 2026-08-21 |

## Assessed, not admitted — with evidence

These were probed FROM THE VPS, because a local result is not evidence
about production: Finland passed every reachability check from a laptop
and failed from the syncing host. Each row is a measurement, not a guess
about what a government probably publishes.

### Bahrain (BH) — `blocked_by_bot_challenge`

Probed 2026-08-24 from VPS (2.24.196.5), compared against a second egress.

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Bahrain eVisa (evisa.gov.bh)](https://www.evisa.gov.bh/) | Official visa portal | **CLOUDFLARE BOT CHALLENGE - will not be circumvented** | Re-diagnosed 2026-08-26. The 403 is not a policy refusal and not an IP ban: it carries 'cf-mitigated: challenge', 'server: cloudflare' and a 'Just a moment...' interstitial body. Cloudflare is challenging the request because it comes from a datacentre address. Identical for IPv4 and IPv6, for a browser User-Agent, for HTTP/1.1, and for full browser headers. |

RECLASSIFIED from blocked_by_our_egress. Calling this 'our egress' implied it was ours to fix, and the obvious fix - route through an address Cloudflare does not challenge - is bot-detection evasion. We will not do that, whoever asks. The legitimate routes are an approach to the authority for allowlisting, or leaving Bahrain unpublished. Bahrain therefore does NOT belong with Portugal in BL-3.

### Cyprus (CY) — `blocked_by_authority`

Probed 2026-08-24 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior (moi.gov.cy)](https://moi.gov.cy/en/) | Official immigration authority | **ROBOTS DISALLOWS EVERYTHING** | robots.txt returns 200 and its rule is `Disallow: /` — the entire site is closed to automated reading. Unambiguous, and reachable: the file was served to us so we could read the answer. |

The cleanest possible exception. This is not a WAF, an IP block or a parse failure — the authority publishes crawl rules and its rules say no to everything. Respecting that is non-negotiable (spec rule 9), and there is nothing to revisit technically. Any future access is an outreach conversation.

### Iran (IR) — `blocked_unresolvable_redirect_loop`

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Foreign Affairs](https://mfa.gov.ir/) | Visa authority | **ROBOTS.TXT REDIRECTS TO ITSELF — UNRESOLVABLE** | Followed from the VPS with a redirect budget: `https://mfa.gov.ir/robots.txt` answers 307 pointing at `https://mfa.gov.ir/robots.txt`, and does so every time — curl exits 47, "Maximum (5) redirects followed", with the effective URL unchanged. The home page behaves identically. |
| [e-Visa portal](https://evisa.mfa.ir/) | Application system | **SAME LOOP** | Both robots.txt and the root answer 307 to themselves; 5 redirects followed, 0 bytes, no terminal response. |

The first pass left Iran deliberately unresolved rather than blocked, because reading a 307 as a refusal is a mistake this project had already made twice in one session. That caution was right and the answer is now in: the redirect does not terminate. It points at itself.

So this is NOT the Australian case — nobody has refused us. It is the case where the crawl rules cannot be obtained at all, and the consequence is the same, because we do not read a site whose robots.txt we cannot read. Recorded under its own conclusion so it is never confused with a refusal, and so that a future session can tell in one glance whether the loop has been fixed.

### Iraq (IQ) — `readable_but_publishes_only_outbound_services`

Probed 2026-08-25 from undefined.

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior (moi.gov.iq)](https://moi.gov.iq/) | Official interior ministry | **ROBOTS PERMITS, SERVER REFUSES (HTTP 403)** | robots.txt 200 with 3 disallow lines and the requested path ALLOWED by them; the page then returns HTTP 403. The refusal governs. |
| [Ministry of Foreign Affairs (mofa.gov.iq)](https://mofa.gov.iq/) | Consular services | **READABLE AND SUBSTANTIAL — AND ABOUT THE WRONG DIRECTION OF TRAVEL** | FOUND on the 2026-08-25 re-probe and readable at 7,829 characters with a 12,514-URL WordPress sitemap. Its readable service pages are Iraqi PASSPORT services for Iraqi citizens: passport issuance, passport extension, replacement of a lost passport, laissez-passer. They are real, current and useful, and not one of them is about entering Iraq. Publishing them under an Iraq visa route would put a page about Iraqi passports in front of someone asking how to enter the country — worse than publishing nothing, because it looks like an answer. |
| [MFA www variant (www.mofa.gov.iq)](https://www.mofa.gov.iq) | Same ministry, www host | **ROBOTS PERMITS, SERVER REFUSES (HTTP 530)** | HTTP 530 from the VPS — an origin-unreachable status returned by the edge. |
| [Candidate hosts (evisa.mofa.gov.iq, gov.iq, dop.gov.iq)](https://evisa.mofa.gov.iq) | Looking for an inbound-visa or passports-directorate host | **DNS FAILS** | ENOTFOUND for evisa.mofa.gov.iq and dop.gov.iq; ENODATA for gov.iq. These are evidence about the NAMES we guessed, not about Iraq. |

RECLASSIFIED 2026-08-25 from blocked_by_authority. The interior ministry does refuse us, and that part is unchanged. What changed is that a SECOND Iraqi authority was found, is readable, and publishes a real service corpus — for Iraqi citizens travelling out, not for foreigners coming in. The distinction matters because 'blocked' invited a future session to keep hunting for a way past a 403, and the actual open question is different: does any Iraqi authority publish inbound entry requirements at all?

### Israel (IL) — `blocked_by_authority`

Probed 2026-08-24 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Population and Immigration Authority (gov.il)](https://www.gov.il/en/departments/population_and_immigration_authority/govil-landing-page) | Official immigration authority | **ROBOTS PERMITS, SERVER REFUSES** | robots.txt returns 200 with ZERO disallow lines — the site explicitly permits crawling — and the page itself then returns HTTP 403. Two official signals that contradict each other. (robots.txt is also 403 from a second egress and 200 from the VPS, so the refusal is not simply IP reputation.) |

Recorded as blocked because the server refused the content, but the contradiction is worth keeping: a robots.txt with no disallow lines is an invitation, and a 403 on the page is a refusal. Where the two disagree the refusal governs — we do not get to treat the permissive signal as the operative one because it is the one we prefer. Worth revisiting through the outreach process rather than technically.

### Kuwait (KW) — `readable_but_publishes_no_requirements`

Probed 2026-08-25 from undefined.

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior — Residence Affairs](https://www.moi.gov.kw/main/eservices/residence) | The residence service page, read off the ministry home page rather than constructed | **READABLE — AND IT DESCRIBES THE DEPARTMENT, NOT THE REQUIREMENTS** | robots.txt 200 with ZERO disallow lines — fully unrestricted. HTTP 200, 2,206 characters. RECLASSIFIED 2026-08-25 from blocked_by_client_rendering, which was the wrong conclusion: the page is not empty and is not script-rendered, it simply is not about visa requirements. Its substantive content is a directorate mandate — 'organising and supervising the entry and exit of foreigners through the ports or their residence, in addition to keeping residence files for expatriates and recording violations' — plus a link to the Ministerial Decree on the Regulation of the Residence Law. It states no requirement, no fee, no document and no eligibility. Registering it as a visa route would publish a page whose entire content is a job description. |
| [Kuwait Government Online (e.gov.kw)](https://www.e.gov.kw) | National portal | **ROBOTS REFUSED (HTTP 403)** | robots.txt returns 403 from the VPS. We cannot read what is permitted, so we stop. |
| [Kuwait eVisa (evisa.moi.gov.kw)](https://evisa.moi.gov.kw) | eVisa system | **ROBOTS REFUSED (HTTP 502)** | robots.txt returns HTTP 502 from the VPS. |
| [Ministry of Foreign Affairs (mofa.gov.kw)](https://www.mofa.gov.kw) | Consular / visa issuance | **ROBOTS PERMITS, SERVER REFUSES (HTTP 403)** | The published crawl rules permit the path and the server returns 403. The refusal governs. |

The 2026-08-25 re-probe widened Kuwait from one host to six and changed the SHAPE of the finding rather than its outcome. It is no longer 'the page is client-rendered' — the page reads fine. It is 'the readable page is about something else, and every other Kuwaiti host either refuses us or does not answer'. That is a better record: a future session knows not to re-probe moi.gov.kw expecting requirements to appear, and knows the open question is whether Kuwait publishes entry requirements anywhere at all.

### Saudi Arabia (SA) — `blocked_by_client_rendering`

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Foreign Affairs — eServices index](https://www.mofa.gov.sa/en/eservices/Pages/default.aspx) | The service catalogue | **READABLE, BUT THE WRONG CATALOGUE** | robots.txt 200 with ZERO disallow lines. HTTP 200, 391,235 bytes raw normalizing to 18,499 characters, 180 of 209 lines (86%) unique, body references 2026. It enumerates roughly forty services and they are overwhelmingly DIPLOMATIC-MISSION services — work visas requested by embassies, exit-reentry visas for accredited mission staff, luggage export permits for diplomats. |
| [Ministry of Foreign Affairs — individual service pages](https://www.mofa.gov.sa/en/eservices/Pages/svc3.aspx) | Where per-service requirements would live | **NO BODY TEXT SERVER-SIDE** | HTTP 200, 183,555 bytes raw normalizing to 4,311 characters — all of it site navigation and Arabic cookie boilerplate. The service description itself is not in the served markup. A sibling (svc25) behaves identically at 6 of 40 lines (15%) unique. |
| [Visa Services Platform](https://ksavisa.sa/) | Where general public visa requirements would live | **CLIENT-RENDERED — NOTHING TO EXTRACT** | robots.txt 200 with 1 disallow line, path ALLOWED. HTTP 200, 15,182 bytes raw normalizing to ZERO characters. |

Saudi Arabia fails twice over, and the two failures are different. The ministry's eServices index IS readable and IS enumerable — 86% unique, current year — and what it enumerates is a diplomatic-mission service desk rather than a public visa catalogue. Registering those forty services as visa types would produce a country page about luggage export permits for embassy staff.

The general public visa platform, linked from the same site, sends zero characters. So the readable catalogue is the wrong one and the right one is unreadable. Recorded as client-rendering rather than refusal: every host here serves us willingly.

### State of Palestine (PS) — `authority_reachable_publishes_no_entry_requirements`

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior](https://moi.gov.ps/) | Palestinian government host — FOUND on this pass | **READABLE AND CURRENT, BUT NOT AN ENTRY-REQUIREMENTS PUBLISHER** | robots.txt returns 200 with a single `Disallow: /private/` — the site permits us everywhere else. HTTP 200, 424,904 bytes raw normalizing to 32,364 characters, body references 2026. Enumerating its links returns news posts, photo galleries, martyr records and security-service pages; no visa or entry section exists to probe. |
| [Ministry of Interior — e-services](https://eservice.moi.gov.ps/) | Where services would live | **CLIENT-RENDERED** | robots.txt 404. HTTP 200, 11,392 bytes raw normalizing to 109 characters. Latest year in body: 2021. |

CORRECTION to this entry's own first verdict, and the correction matters. Palestine was recorded as 'no official government web host publishing entry or visa requirements was identified, so there was nothing to probe'. There IS one: moi.gov.ps answers, publishes crawl rules that permit us, serves 32,000 characters and references the current year. The first pass simply had not found it.

What changes is the QUALITY of the exception, not its outcome. The finding is no longer 'we could not find an authority' — which is a statement about our search — but 'the authority is reachable, willing and readable, and publishes no entry or visa requirements', which is a statement about what it publishes. That is consistent with the substantive position §4 asks us to model from authoritative sources rather than assert politically: entry to the West Bank and Gaza is not controlled at points the Palestinian Authority administers.

Recorded so that a future session probes moi.gov.ps for a new section rather than starting again from 'is there a host at all'.

### Syria (SY) — `blocked_by_client_rendering`

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Ministry of Interior](https://moi.gov.sy/) | Candidate immigration authority | **CLIENT-RENDERED — NOTHING TO EXTRACT** | robots.txt 404 — unrestricted. HTTP 200, 1,133 bytes raw normalizing to ZERO characters. Unchanged from the first pass and re-confirmed from the VPS. |
| [Other candidate hosts](immigration.gov.sy, passport.gov.sy, mfa.gov.sy) | Looking for a second Syrian authority | **NO CONNECTION FROM THE VPS** | All three return no HTTP status at all. Recorded as unreachable, not as refusal. |

Syria was already recorded as client-rendered on one host. This pass looked for a second and found none reachable: three further candidate hostnames produced no connection. That is not evidence about Syria's policy and it is not filed as one — it is evidence that we have found exactly one Syrian government host that answers, and it sends no text.

### Yemen (YE) — `unresolved_no_reachable_authority`

Probed 2026-08-26 from VPS (2.24.196.5).

| Authority | Role | Verdict | Evidence |
|---|---|---|---|
| [Candidate hosts](moi.gov.ye, ipa.gov.ye, passports.gov.ye, immigration.gov.ye) | Identifying an authority before probing one | **NO CONNECTION FROM THE VPS** | Four candidate hostnames, all returning no HTTP status. Identical behaviour across all four, which makes a per-host outage unlikely and tells us nothing about which of them, if any, is the right authority. |

Unchanged in substance and widened in evidence: the first pass tried one hostname, this pass tried four, and none answers. The honest position is still the one recorded before — we have not established that any of these is Yemen's immigration authority, so a failure to connect is not yet a finding about Yemen.

Naming the right authority comes first, and doing that needs a source we have not got: an official Yemeni government directory that itself answers. Recorded as unresolved rather than blocked, because 'blocked' would assert a refusal nobody made.


## In the registry, nobody has looked yet

**159** countries. This is the honest gap, and it is stated
as a count rather than dressed up: no authority has been identified, nothing
has been probed, and nothing is known about whether these could be read.

AF Afghanistan · AL Albania · DZ Algeria · AD Andorra · AO Angola · AG Antigua and Barbuda · AR Argentina · AM Armenia · AZ Azerbaijan · BD Bangladesh · BB Barbados · BY Belarus · BE Belgium · BZ Belize · BJ Benin · BT Bhutan · BO Bolivia · BA Bosnia and Herzegovina · BW Botswana · BR Brazil · BN Brunei · BG Bulgaria · BF Burkina Faso · BI Burundi · CV Cabo Verde · KH Cambodia · CM Cameroon · CF Central African Republic · TD Chad · CL Chile · CO Colombia · KM Comoros · CR Costa Rica · CI Côte d’Ivoire · HR Croatia · CU Cuba · CZ Czechia · CD Democratic Republic of the Congo · DJ Djibouti · DM Dominica · DO Dominican Republic · EC Ecuador · SV El Salvador · GQ Equatorial Guinea · ER Eritrea · EE Estonia · SZ Eswatini · ET Ethiopia · FM Federated States of Micronesia · FJ Fiji · GA Gabon · GE Georgia · DE Germany · GH Ghana · GR Greece · GD Grenada · GT Guatemala · GN Guinea · GW Guinea-Bissau · GY Guyana · HT Haiti · VA Holy See · HN Honduras · HU Hungary · IS Iceland · IN India · ID Indonesia · IT Italy · JM Jamaica · KZ Kazakhstan · KE Kenya · KI Kiribati · KG Kyrgyzstan · LA Laos · LV Latvia · LS Lesotho · LR Liberia · LY Libya · LI Liechtenstein · LT Lithuania · LU Luxembourg · MG Madagascar · MW Malawi · MV Maldives · ML Mali · MT Malta · MH Marshall Islands · MR Mauritania · MU Mauritius · MX Mexico · MD Moldova · MC Monaco · MN Mongolia · ME Montenegro · MA Morocco · MZ Mozambique · MM Myanmar · NA Namibia · NR Nauru · NP Nepal · NI Nicaragua · NE Niger · NG Nigeria · KP North Korea · MK North Macedonia · PK Pakistan · PW Palau · PA Panama · PG Papua New Guinea · PY Paraguay · PE Peru · PH Philippines · PL Poland · CG Republic of the Congo · RO Romania · RU Russia · RW Rwanda · KN Saint Kitts and Nevis · LC Saint Lucia · VC Saint Vincent and the Grenadines · WS Samoa · SM San Marino · ST São Tomé and Príncipe · SN Senegal · RS Serbia · SC Seychelles · SL Sierra Leone · SK Slovakia · SI Slovenia · SB Solomon Islands · SO Somalia · ZA South Africa · KR South Korea · SS South Sudan · ES Spain · LK Sri Lanka · SD Sudan · SR Suriname · CH Switzerland · TJ Tajikistan · TZ Tanzania · BS The Bahamas · GM The Gambia · TL Timor-Leste · TG Togo · TO Tonga · TT Trinidad and Tobago · TN Tunisia · TM Turkmenistan · TV Tuvalu · UG Uganda · UA Ukraine · UY Uruguay · UZ Uzbekistan · VU Vanuatu · VE Venezuela · VN Vietnam · ZM Zambia · ZW Zimbabwe
