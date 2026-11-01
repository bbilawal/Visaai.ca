# Country × Visa Coverage Matrix

GENERATED FILE — `node scripts/visa-registry/coverage-matrix.mjs --docker <container>`.
Every cell is read from the registry. Do not hand-edit; regenerate.

## Totals

| Status | Rows |
|---|---|
| PASS | 108 |
| BLOCKED BY OFFICIAL SOURCE | 16 |
| **Total** | **124** |

## Registry counts

- Countries with at least one visa type: **19**
- Countries in the canonical registry: **196**
- Visa types: **124**
- Visa types with at least one active official requirement: **108**
- Official source URLs registered: **276**
- Official form sources registered: **20**

## Scope coverage

§4.1 previously set a 195-country floor. It was replaced on 2026-08-24 by a
deliberate scope decision, and the countries VisaAI covers are listed in
`data/country-scope.json` — read here at generation time so this table and the
spec cannot drift apart.

- In scope: **37**
- Researched, with at least one visa type: **19**
- In scope, assessed with evidence but not admitted: **18**
- In scope, NOT YET EXAMINED BY ANYONE: **0**
- In the registry but out of scope: **159** — not outstanding work

The last two lines used to be one line reading "not yet researched", which
made an evidenced refusal and an unopened file look identical. They are
opposite states: the first is a finding, the second is a gap. Only the second
is outstanding work, and §84 accepts the first as an exception because each
carries a measurement rather than a status.

Assessed, by what was found (see `data/country-probe-evidence.json`):

- `blocked_by_authority`: **6**
- `blocked_by_client_rendering`: **6**
- `blocked_by_our_egress`: **2**
- `authority_reachable_publishes_no_entry_requirements`: **1**
- `blocked_unresolvable_redirect_loop`: **1**
- `readable_but_catalogue_not_enumerable`: **1**
- `unresolved_no_reachable_authority`: **1**

Out-of-scope rows are kept rather than deleted: their ISO codes and names are
verified data, `support_state` keeps them off the public site, and widening
scope is an edit to one file. Counting them as a gap would report a decision
as a debt.

Neither an assessed nor an unexamined country publishes anything:
`support_state` is `unsupported`, and the public country list filters those
out, so none of them adds a hub page or a sitemap URL.

## Matrix

| Country | Visa type | Code | Category | Official reqs | Forms | Sources (reachable/blocked) | Status | Note |
|---|---|---|---|---|---|---|---|---|
| Australia (AU) | Visitor visa (subclass 600) — Business visitor stream | subclass 600 (Business visitor stream) | business | 0 | 0 | 2 (0/2) | BLOCKED BY OFFICIAL SOURCE | All 2 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Electronic Travel Authority (subclass 601) | subclass 601 | eta | 0 | 0 | 2 (0/2) | BLOCKED BY OFFICIAL SOURCE | All 2 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Partner visa (apply in Australia) (subclass 820 and 801) | subclass 820/801 | family | 0 | 1 | 4 (0/4) | BLOCKED BY OFFICIAL SOURCE | All 4 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Business Innovation and Investment (Provisional) visa (subclass 188) | subclass 188 | investor | 0 | 0 | 2 (0/2) | BLOCKED BY OFFICIAL SOURCE | All 2 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Temporary Graduate visa (subclass 485) | subclass 485 | other | 0 | 0 | 2 (0/2) | BLOCKED BY OFFICIAL SOURCE | All 2 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Working Holiday visa (subclass 417) | subclass 417 | other | 0 | 0 | 2 (0/2) | BLOCKED BY OFFICIAL SOURCE | All 2 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Skilled Independent visa (subclass 189) | subclass 189 | permanent_residence | 0 | 0 | 2 (0/2) | BLOCKED BY OFFICIAL SOURCE | All 2 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Student visa (subclass 500) | subclass 500 | student | 0 | 1 | 5 (0/5) | BLOCKED BY OFFICIAL SOURCE | All 5 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Visitor visa (subclass 600) | subclass 600 | visitor | 0 | 1 | 4 (0/4) | BLOCKED BY OFFICIAL SOURCE | All 4 source(s) are robots-disallowed or persistently failing. |
| Australia (AU) | Skills in Demand visa (subclass 482) | subclass 482 | work | 0 | 1 | 4 (0/4) | BLOCKED BY OFFICIAL SOURCE | All 4 source(s) are robots-disallowed or persistently failing. |
| Austria (AT) | Red-White-Red Card – Self-employed Key Workers | — | business | 5 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Red-White-Red Card – Start-up Founders | — | business | 3 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Family Reunification | — | family | 5 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Other Forms of Settlement | — | permanent_residence | 5 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | EU Blue Card | — | work | 6 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Red-White-Red Card – Graduates of Austrian Universities | — | work | 6 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Red-White-Red Card – Other Key Workers | — | work | 6 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Red-White-Red Card – Regular Workers in Tourism, Agriculture and Forestry | — | work | 5 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Red-White-Red Card – Skilled Workers in Shortage Occupations | — | work | 3 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Red-White-Red Card – Very Highly Qualified Workers | — | work | 9 | 0 | 1 (1/0) | PASS |  |
| Austria (AT) | Red-White-Red Card Plus | — | work | 5 | 0 | 1 (1/0) | PASS |  |
| Canada (CA) | Electronic travel authorization (eTA) | eTA | eta | 17 | 0 | 4 (4/0) | PASS |  |
| Canada (CA) | Sponsor your spouse, partner or child | — | family | 23 | 1 | 5 (5/0) | PASS |  |
| Canada (CA) | Business visitors | — | other | 24 | 0 | 2 (2/0) | PASS |  |
| Canada (CA) | Super visa for parents and grandparents | — | parent | 18 | 0 | 4 (4/0) | PASS |  |
| Canada (CA) | Express Entry | — | permanent_residence | 16 | 0 | 3 (3/0) | PASS |  |
| Canada (CA) | Study permit | — | student | 22 | 1 | 6 (6/0) | PASS |  |
| Canada (CA) | Visitor visa (temporary resident visa) | TRV | visitor | 17 | 1 | 6 (6/0) | PASS |  |
| Canada (CA) | Work permit | — | work | 14 | 1 | 5 (5/0) | PASS |  |
| China (CN) | Issuance of Exit-Entry Permits for Foreigners | — | other | 16 | 0 | 1 (1/0) | PASS |  |
| China (CN) | Issuance of Residence Permit for Foreigners | — | other | 24 | 0 | 1 (1/0) | PASS |  |
| China (CN) | Issuance of Travel Permits for Foreigners | — | other | 13 | 0 | 1 (1/0) | PASS |  |
| China (CN) | Visa Extension, Change and Reissuance for Foreigners | — | other | 25 | 0 | 1 (1/0) | PASS |  |
| China (CN) | Approval of Foreign Nationals' Eligibility for Permanent Residence in China | — | permanent_residence | 47 | 0 | 1 (1/0) | PASS |  |
| Egypt (EG) | Tourism Visa (e-Visa) | — | evisa | 14 | 0 | 1 (1/0) | PASS |  |
| Finland (FI) | Residence permit application for an entrepreneur | OLE_YRI | entrepreneur | 20 | 0 | 2 (2/0) | PASS |  |
| Finland (FI) | Residence permit application for persons employed as a specialist | OLE_TY2 | skilled_worker | 18 | 0 | 2 (2/0) | PASS |  |
| Finland (FI) | Residence permit application on the basis of family ties when your spouse has a residence permit | — | spouse_partner | 20 | 0 | 4 (4/0) | PASS |  |
| Finland (FI) | Residence permit application for studies | OLE_OPI | student | 16 | 0 | 2 (2/0) | PASS |  |
| Finland (FI) | Residence permit application for an employed person (TTOL) | OLE_TY1 | work | 25 | 0 | 2 (2/0) | PASS |  |
| Hong Kong SAR (HK) | Residence as dependant | — | dependant | 16 | 0 | 1 (1/0) | PASS |  |
| Hong Kong SAR (HK) | Quality Migrant Admission Scheme (QMAS) | QMAS | skilled_worker | 19 | 0 | 1 (1/0) | PASS |  |
| Hong Kong SAR (HK) | General Employment Policy (GEP) | GEP | work | 19 | 0 | 1 (1/0) | PASS |  |
| Hong Kong SAR (HK) | Immigration Arrangements for Non-local Graduates (IANG) | IANG | work | 13 | 0 | 1 (1/0) | PASS |  |
| Ireland (IE) | Short Stay 'C' Business Visa | C | business | 15 | 0 | 1 (1/0) | PASS |  |
| Ireland (IE) | Non-EEA family reunification: joining an Irish national | — | family_reunification | 11 | 0 | 2 (2/0) | PASS |  |
| Ireland (IE) | Long Term Study Visa (D) | D | student | 17 | 0 | 1 (1/0) | PASS |  |
| Ireland (IE) | Short Stay 'C' Visa | C | visitor | 20 | 0 | 2 (2/0) | PASS |  |
| Ireland (IE) | Long Stay Employment Visa (D) | — | work | 22 | 0 | 2 (2/0) | PASS |  |
| Lebanon (LB) | Courtesy Residence | — | family | 21 | 0 | 1 (1/0) | PASS |  |
| Lebanon (LB) | Annual Residence | — | other | 17 | 0 | 2 (2/0) | PASS |  |
| Lebanon (LB) | Six-Month Multiple-Entry Residence Permit Based on a Bank Statement | — | other | 9 | 0 | 1 (1/0) | PASS |  |
| Lebanon (LB) | Temporary Residence Permit Pending Passport Renewal | — | other | 10 | 0 | 1 (1/0) | PASS |  |
| Lebanon (LB) | Artist Entry Visa and Residency | — | performer | 26 | 0 | 3 (3/0) | PASS |  |
| Lebanon (LB) | Permanent Residence | — | permanent_residence | 23 | 0 | 1 (1/0) | PASS |  |
| Lebanon (LB) | Visas and Residency for Students of Religion, Missionaries, Volunteers and Men of Religion | — | religious | 23 | 0 | 1 (1/0) | PASS |  |
| Lebanon (LB) | Domestic Worker — entry visa, work permit and residence | — | temporary_worker | 30 | 0 | 3 (3/0) | PASS |  |
| Lebanon (LB) | Entry Visa for Foreign Technical Specialists at Ports | — | temporary_worker | 11 | 0 | 1 (1/0) | PASS |  |
| Lebanon (LB) | Entry Visa — terms and conditions | — | visitor | 35 | 0 | 1 (1/0) | PASS |  |
| Malaysia (MY) | Residence Pass | — | permanent_residence | 20 | 0 | 1 (1/0) | PASS |  |
| Malaysia (MY) | Long-Term Social Visit Pass | — | spouse_partner | 22 | 0 | 1 (1/0) | PASS |  |
| Malaysia (MY) | Student Pass | — | student | 22 | 0 | 1 (1/0) | PASS |  |
| Netherlands (NL) | Residence permit for partner | — | family | 15 | 0 | 1 (1/0) | PASS |  |
| Netherlands (NL) | Student residence permit for university or higher professional education | — | student | 16 | 0 | 2 (2/0) | PASS |  |
| Netherlands (NL) | European Blue Card residence permit | — | work | 13 | 0 | 1 (1/0) | PASS |  |
| Netherlands (NL) | Residence permit for orientation year | — | work | 10 | 0 | 1 (1/0) | PASS |  |
| Netherlands (NL) | Residence permit highly skilled migrant | — | work | 13 | 0 | 1 (1/0) | PASS |  |
| New Zealand (NZ) | Exchange Student Visa | — | student | 14 | 0 | 1 (1/0) | PASS |  |
| New Zealand (NZ) | Visitor Visa | — | visitor | 14 | 0 | 2 (2/0) | PASS |  |
| New Zealand (NZ) | Accredited Employer Work Visa | AEWV | work | 18 | 0 | 1 (1/0) | PASS |  |
| New Zealand (NZ) | Post Study Work Visa | — | work | 13 | 0 | 1 (1/0) | PASS |  |
| New Zealand (NZ) | Working Holiday Visa | — | working_holiday | 10 | 0 | 3 (3/0) | PASS |  |
| Norway (NO) | Family immigration with a Norwegian or Nordic citizen (cohabitant) | — | family | 8 | 0 | 3 (3/0) | PASS |  |
| Norway (NO) | Family immigration with a Norwegian or Nordic citizen (spouse or registered partner) | — | family | 10 | 0 | 3 (3/0) | PASS |  |
| Norway (NO) | Study permit | — | student | 12 | 0 | 1 (1/0) | PASS |  |
| Norway (NO) | Visitor's visa | — | visitor | 14 | 0 | 2 (2/0) | PASS |  |
| Norway (NO) | Skilled worker residence permit | — | work | 10 | 0 | 1 (1/0) | PASS |  |
| Singapore (SG) | Dependant's Pass | — | dependant | 20 | 0 | 5 (5/0) | PASS |  |
| Singapore (SG) | EntrePass | — | entrepreneur | 25 | 0 | 4 (4/0) | PASS |  |
| Singapore (SG) | Long-Term Visit Pass (family of a Singapore citizen or permanent resident) | — | family | 17 | 0 | 3 (3/0) | PASS |  |
| Singapore (SG) | S Pass | — | skilled_worker | 21 | 0 | 4 (4/0) | PASS |  |
| Singapore (SG) | Student's Pass | — | student | 25 | 0 | 4 (4/0) | PASS |  |
| Singapore (SG) | Singapore entry visa | — | visitor | 20 | 1 | 3 (3/0) | PASS |  |
| Singapore (SG) | Employment Pass | — | work | 21 | 0 | 4 (4/0) | PASS |  |
| Singapore (SG) | Overseas Networks & Expertise Pass | — | work | 23 | 0 | 4 (4/0) | PASS |  |
| Sweden (SE) | Residence permit to live with a partner in Sweden | — | family | 13 | 0 | 2 (2/0) | PASS |  |
| Sweden (SE) | Uppehållstillstånd för studier vid högre utbildning (residence permit for higher education studies) | — | student | 11 | 0 | 1 (1/0) | PASS |  |
| Sweden (SE) | Schengenvisum (Schengen visa) | — | visitor | 10 | 0 | 2 (2/0) | PASS |  |
| Sweden (SE) | Arbetstillstånd för anställda (work permit, employed) | — | work | 9 | 0 | 1 (1/0) | PASS |  |
| Sweden (SE) | EU Blue Card (Sweden) | — | work | 13 | 0 | 1 (1/0) | PASS |  |
| Türkiye (TR) | Transportation Visa | — | crew | 10 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Residence Procedures for Foreign Mission Personnel and Their Family Members | — | diplomatic | 7 | 0 | 1 (1/0) | PASS |  |
| Türkiye (TR) | e-Visa | — | evisa | 12 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Internship Visa / Work Permit Exemption | — | exchange | 14 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Family Residence Permit | — | family_reunification | 28 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Humanitarian Residence Permit | — | humanitarian | 24 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Residence Permit for Victims of Human Trafficking | — | humanitarian | 19 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Short-Term Residence Permit | — | other | 48 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Long-Term Residence Permit | — | permanent_residence | 23 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Personnel Assigned to Foreign Religious Foundations | — | religious | 8 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Archaeological Excavation, Exploration and Documentary Purpose Visas | — | research | 11 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Student Residence Permit | — | student | 27 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Tour Operator Representative Visa | — | temporary_worker | 9 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Tourist Visa | — | tourism | 10 | 0 | 2 (2/0) | PASS |  |
| Türkiye (TR) | Working Visa | — | work | 13 | 0 | 2 (2/0) | PASS |  |
| United Arab Emirates (AE) | Blue Residence | — | permanent_residence | 15 | 0 | 1 (1/0) | PASS |  |
| United Arab Emirates (AE) | Golden Residency | — | permanent_residence | 14 | 0 | 1 (1/0) | PASS |  |
| United Arab Emirates (AE) | Green Residence | — | work | 11 | 0 | 1 (1/0) | PASS |  |
| United Kingdom (GB) | Standard Visitor visa — Visit on business | — | business | 14 | 1 | 3 (2/1) | PASS |  |
| United Kingdom (GB) | Electronic travel authorisation (ETA) | ETA | eta | 16 | 0 | 3 (3/0) | PASS |  |
| United Kingdom (GB) | Family visas: apply, extend or switch — Apply as a partner or spouse | — | family | 25 | 0 | 4 (4/0) | PASS |  |
| United Kingdom (GB) | Student visa | — | student | 20 | 0 | 5 (5/0) | PASS |  |
| United Kingdom (GB) | Standard Visitor visa | — | visitor | 16 | 1 | 3 (2/1) | PASS |  |
| United Kingdom (GB) | Skilled Worker visa | — | work | 23 | 0 | 5 (5/0) | PASS |  |
| United Kingdom (GB) | Youth Mobility Scheme visa | — | youth_mobility | 8 | 0 | 3 (3/0) | PASS |  |
| United States of America (US) | Business visitor | B-1 | business | 0 | 1 | 4 (0/4) | BLOCKED BY OFFICIAL SOURCE | All 4 source(s) are robots-disallowed or persistently failing. |
| United States of America (US) | Visa Waiver Program / ESTA | VWP | eta | 7 | 0 | 5 (2/3) | PASS |  |
| United States of America (US) | Family Immigration (Immediate Relative and Family Preference immigrant visas) | — | family | 19 | 3 | 7 (2/5) | PASS |  |
| United States of America (US) | Exchange visitor | J | other | 0 | 0 | 1 (0/1) | BLOCKED BY OFFICIAL SOURCE | All 1 source(s) are robots-disallowed or persistently failing. |
| United States of America (US) | Transiting the United States | C | other | 0 | 0 | 1 (0/1) | BLOCKED BY OFFICIAL SOURCE | All 1 source(s) are robots-disallowed or persistently failing. |
| United States of America (US) | Treaty trader/treaty investor | E | other | 0 | 0 | 1 (0/1) | BLOCKED BY OFFICIAL SOURCE | All 1 source(s) are robots-disallowed or persistently failing. |
| United States of America (US) | Student Visa (academic F, vocational M) | F-1/M-1 | student | 0 | 1 | 4 (0/4) | BLOCKED BY OFFICIAL SOURCE | All 4 source(s) are robots-disallowed or persistently failing. |
| United States of America (US) | Visitor Visa (B-1 business / B-2 tourism) | B-1/B-2 | visitor | 0 | 1 | 4 (0/4) | BLOCKED BY OFFICIAL SOURCE | All 4 source(s) are robots-disallowed or persistently failing. |
| United States of America (US) | Temporary Worker Visas | — | work | 12 | 3 | 6 (2/4) | PASS |  |

## Explanation of every non-PASS class

**PASS WITH LIMITATION** — the dominant status today, and it is the quality gate working rather than a gap. The official sources for these visas were fetched and verified, but VisaAI publishes a REQUIREMENT only after it has been extracted from a specific source version and reviewed by a person. Until the first sync run has gone through that cycle, the country hub page publishes (authority, visa catalog and official links are all verified facts) and the per-visa detail page renders `noindex, follow`. Listing an unverified requirement would be the fabrication the spec forbids; listing nothing is the honest state.

**BLOCKED BY OFFICIAL SOURCE** — the authority disallows automated reading of the page, or it has failed repeatedly. This is not fixable by engineering: VisaAI keeps the metadata and links the applicant to the authority's own page instead of caching it. Respecting that is non-negotiable (spec rule 9).

**FAILED** — sources are reachable but the extractor could not produce usable text. This IS a VisaAI bug and belongs in the parser backlog.

