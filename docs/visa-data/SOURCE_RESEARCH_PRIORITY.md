# Official Source Research — Priority Destinations

**Registry file:** `data/official-sources/priority-destinations.json`
**Session date:** 2026-08-20 (fetching ran across local midnight into 2026-08-21; `fetched_at` is recorded as `2026-08-20` throughout)
**Destinations:** Canada (CA), United States (US), United Kingdom (GB), Australia (AU)

## Rules applied

- Only government-owned domains are cited: `canada.ca`, `ircc.canada.ca`, `travel.state.gov`, `uscis.gov`, `esta.cbp.dhs.gov`, `ceac.state.gov`, `studyinthestates.dhs.gov`, `gov.uk`, `visas-immigration.service.gov.uk`, `immi.homeaffairs.gov.au`, `homeaffairs.gov.au`, `online.immi.gov.au`.
- No third-party blog, aggregator or law-firm page is cited anywhere in the registry.
- Nothing was invented. Every subclass number, form identifier and URL in the registry was observed on an official page or in an official page's own navigation data during this session.
- No fee, processing time or eligibility rule is stated unless it was read verbatim on an official page in this session. Only two fee sets qualified (both GOV.UK) — see below.

## Counts

| Metric | Count |
|---|---|
| Destinations verified | 4 / 4 |
| Visa/category entries recorded | 32 |
| Distinct official URLs verified (HTTP 200) | 122 |
| Blocked / unreachable items recorded | 6 |
| Fields explicitly marked "could not verify" | 19 |

Per destination: Canada 34 URLs, United States 31, United Kingdom 34, Australia 23.

## What was verified

### Canada — Immigration, Refugees and Citizenship Canada (IRCC)
- Authority root, service index, and the official "Explore immigration programs" tool (`come-canada-tool.html`).
- **Visitor visa (temporary resident visa)** — landing, eligibility, "About the document", how-to-apply, **IMM 5257** form page, and the separate **IMM 5484** document checklist page.
- **Electronic travel authorization (eTA)** — landing, "Who can apply", "How to apply", facts page, plus the official eTA-vs-visa checker.
- **Study permit** — landing, "Who can apply", "Get the right documents", "How to apply", **IMM 1294**.
- **Work permit** — hub plus "Work permit application from outside Canada", **IMM 1295**.
- **Family sponsorship** — hub, "Sponsor your spouse, partner or child" + its eligibility and how-to-apply pages, **IMM 1344**.
- **Express Entry** — landing and "Who can apply".
- **Fee list** — `ircc.canada.ca/english/information/fees/fees.asp`, discovered as an outbound link on the official IRCC "How to apply for a visitor visa" page, then verified directly (HTTP 200, "Citizenship and immigration application fees: Fee list").
- Application method read verbatim for the visitor visa (online **and** "Applying on paper for specific situations") and the study permit ("you must apply online, whether you're outside of Canada or already in Canada").

### United States — USCIS (DHS) + Department of State, Bureau of Consular Affairs
- **Directory of Visa Categories** verified as the official visa index, and its rows read directly (e.g. `Business visitor ~ B-1`, `Tourism, vacation, pleasure visitor ~ B-2`, `Student: academic, vocational ~ F, M`, `Specialty occupations… ~ H-1B ~ DOL then USCIS`, `Exchange visitor ~ J ~ SEVIS`, `Treaty trader/treaty investor ~ E`, `Transiting the United States ~ C`).
- **Visitor Visa (B-1/B-2)**, **Student Visa (F-1/M-1)**, **Temporary Worker Visas**, **Family Immigration**, **Visa Waiver Program**, **Submit a Petition**, **NVC Processing**, **Fees for Visa Services**.
- Forms: **DS-160** and **DS-260** pages on travel.state.gov; **I-129**, **I-130**, **I-485**, **I-539**, **I-765**, **G-1055 Fee Schedule** and the All Forms index on uscis.gov.
- Portals: **ESTA** (`esta.cbp.dhs.gov`) and **CEAC** (`ceac.state.gov/genniv/`).
- Application method read verbatim on the visitor, student and temporary-worker pages ("Complete the Online Visa Application — Online Nonimmigrant Visa Application, Form DS-160") and on Submit a Petition ("either electronically or through the traditional paper process through the mail").

### United Kingdom — UK Visas and Immigration (Home Office)
- UKVI and Home Office organisation pages, the FCDO page (recorded for completeness only — FCDO does not administer visas), the `browse/visas-immigration` index and its four relevant sub-indexes, `check-uk-visa`, `apply-to-come-to-the-uk`, and `find-a-visa-application-centre`.
- **Standard Visitor visa** — Overview, "Apply for a Standard Visitor visa", "Visit on business", "When you can extend your stay".
- **ETA** — Overview, "When you do not need an ETA", "Apply for an ETA".
- **Student visa** — Overview, "Your course", "Documents you'll need to apply", "Apply online".
- **Skilled Worker visa** — Overview, "Your job", "Documents you'll need to apply", "How much it costs", "Apply from outside the UK".
- **Family visas** — Overview, "Apply as a partner or spouse", financial requirements, "Information and evidence you must provide".
- **UK visa fees** publication page, and the live UKVI application service (`visas-immigration.service.gov.uk`).
- Application method read verbatim for all five routes (all "must apply online").

**Fees transcribed (the only fees in the registry).** Read on `https://www.gov.uk/standard-visitor/apply-standard-visitor-visa`, 2026-08-20: Standard Visitor visa £135 (6 months); for medical reasons £234 (11 months); for academics £234 (12 months); 2-year long-term £506; 5-year long-term £903; 10-year long-term £1,128 (each 6 months per visit). Read on `https://www.gov.uk/eta/apply`, 2026-08-20: ETA £20.

### Australia — Department of Home Affairs
- Portfolio page, `immi.homeaffairs.gov.au/visas`, the **Visa list**, the **visa finder**, the fees hub and **current visa pricing**, and **ImmiAccount**.
- **Visitor visa (subclass 600)** plus the Tourist stream (overseas) and Business visitor stream pages.
- **Electronic Travel Authority (subclass 601)**, **Student visa (subclass 500)**, **Skills in Demand visa (subclass 482)** + Core skills stream, **Partner visa (apply in Australia) (subclass 820 and 801)** + subclass 820 and 801 pages, **Partner visa (apply overseas) (subclass 309 and 100)**, **Employer Nomination Scheme (subclass 186)**, **Skilled Independent visa (subclass 189)**, **Business Innovation and Investment (Provisional) visa (subclass 188)**, **Temporary Graduate visa (subclass 485)**, **Working Holiday visa (subclass 417)**.
- Official stream names for 600, 500 and 482 were taken from the department's own embedded navigation data on its own pages, and each URL was then confirmed HTTP 200 on `immi.homeaffairs.gov.au`.

**Note on `immiauthor.homeaffairs.gov.au`:** the department's embedded navigation data emits absolute URLs on its internal authoring host. Those were rewritten to the public `immi.homeaffairs.gov.au` host and each rewritten URL was re-fetched and confirmed HTTP 200. No `immiauthor.*` URL is stored in the registry.

## What was blocked

| Target | Method | Observed | Outcome |
|---|---|---|---|
| `canada.ca/*` | WebFetch | ~~403~~ **200** | Superseded 2026-08-21. The 403 was an artifact of the ad-hoc fetch tool used during research, not of canada.ca. The source monitor reads all 37 `canada.ca` / `ircc.canada.ca` sources at HTTP 200, which is why Canada is the only destination with complete coverage. |
| `travel.state.gov/*` | WebFetch, curl | **403** | Cloudflare interstitial ("Just a moment…") in the browser cleared on its own after a few seconds with no challenge presented or solved; pages then read at HTTP 200. |
| `ircc.canada.ca/*` | Chrome extension | navigation refused | Domain not permitted in the extension. The IRCC fee list was verified over curl instead (HTTP 200). |
| `dfat.gov.au` | curl | no status (HTTP/2 reset) | Recorded as blocked. Not required — DFAT does not administer visas. |
| `smartraveller.gov.au` | curl | no status (HTTP/2 reset) | Recorded as blocked. Not used. |
| `state.gov/bureaus-offices/.../bureau-of-consular-affairs/` | curl | **404** | Guessed URL; discarded. `travel.state.gov/content/travel/en/us-visas.html` used as the verified consular root. |

**No CAPTCHA, login or bot check was bypassed.** Where a page was unreachable the item is recorded with its observed status rather than filled in from memory.

Additional URLs probed and found to be **HTTP 404**, so discarded rather than recorded: `canada.ca/.../application/fees.html`, `.../application/fee-list.html`, `.../application/pay-application-fees.html`, `uscis.gov/i-20`, `uscis.gov/.../h-1b-specialty-occupations`, `travel.state.gov/.../immigrate/family-immigration/immediate-relative-visa.html`, `travel.state.gov/.../family-preference-immigrant-visas.html`, `gov.uk/health-surcharge`, `gov.uk/apply-uk-eta` (the live path is `gov.uk/eta`).

## Australia: what else was probed, and why none of it is being used

Updated 2026-08-21. Every Department of Home Affairs host returns HTTP 403 to
an identified agent, so 16 Australian visa types have zero requirements. Before
accepting that, four alternative official hosts were probed with the same
robots-respecting fetcher the monitor uses.

| Host | Result | Used? |
|---|---|---|
| `immi.homeaffairs.gov.au` | 403 | no |
| `www.homeaffairs.gov.au` | 403 | no |
| `www.abf.gov.au` (Australian Border Force) | 403 | no |
| `www.studyaustralia.gov.au` (Austrade) | **200, substantive** | **no — see below** |
| `www.legislation.gov.au` (Federal Register of Legislation) | **200, complete** | **no — see below** |

Two of the five are readable. Neither is being used, and both refusals are
deliberate.

**Study Australia (Austrade) — readable, substantive, and not the authority.**
Its subclass 500 pages do discuss Confirmation of Enrolment, OSHC and the
Genuine Student requirement. But Austrade is a trade and investment agency; it
does not decide visas, its pages carry their own site disclaimer, and the
concrete thresholds it summarises are set by Home Affairs and change without
Austrade necessarily following. Requirements extracted from it would be stored
with provenance — a quote, a URL, a source version — which is exactly what makes
them look authoritative to a reviewer and to a user. Trading a **visible gap**
for an **invisible inaccuracy** is the worse deal in a product where a wrong
requirement costs someone an application fee and a refusal on their record.

`authority_rank` would permit it at rank 5. That is a storage question, not a
licence: the rank column says what a source IS, not that every rank belongs in
a user's checklist.

**Federal Register of Legislation — readable, and the actual law.** This is the
genuinely interesting finding: the Migration Regulations 1994, whose Schedule 2
CREATES these visas and states their criteria, are fully readable. What Home
Affairs blocks is its own plain-English rendering, not the underlying law.

It is still not extracted, for a different reason. Turning Schedule 2 clauses
into a user's document checklist is legal interpretation, and VisaAI is
approval-neutral and does not give legal advice — see
`docs/legal/LEGAL_REVIEW_REQUIRED.md`. An extraction from primary legislation is
a job for counsel to scope, not for an automated pass to attempt because the
page happened to return 200.

**So Australia stays blocked**, and the coverage matrix keeps saying so. The
open routes remain the ones in `docs/operations/SOURCE_ACCESS_OUTREACH.md`:
being allowlisted by Home Affairs, or counsel scoping a legislation-based
extraction. Neither is an engineering decision.

## VisaAI-supported types with no matching official category

VisaAI's `pricing_visa_tiers` seed (`supabase/migrations/20260616000000_pricing_engine.sql`) defines 14 `visa_type` values. Against the four official catalogs:

| VisaAI `visa_type` | Official match found |
|---|---|
| `visitor` | ✅ all four (CA TRV, US B-1/B-2, GB Standard Visitor, AU 600) |
| `tourist` | ✅ all four, but it maps to the **travel authorisation** (eTA / ESTA-VWP / ETA / 601), not a visa. `visitor` and `tourist` being separate priceable tiers will double-count unless the mapping is made explicit. |
| `student` | ✅ all four |
| `work_permit` | ✅ all four |
| `family_sponsorship` | ✅ all four |
| `business` | ⚠️ partial — **no destination publishes a standalone "business visa"**. CA lists "Business visitors" under Visit Canada, US uses B-1 inside the visitor route, GB uses "Visit on business" inside Standard Visitor, AU uses the "Business visitor stream" of subclass 600. VisaAI prices `business` as `high` complexity with a lawyer flag; for these four destinations it is a *sub-stream of the visitor route*, not a separate high-complexity product. **This is the largest modelling mismatch found.** |
| `permanent_residency` | ✅ CA (Express Entry / PR hub), AU (subclass 189). Not separately verified for US/GB. |
| `express_entry` | ✅ CA only — it is a Canada-specific program name and should not be a global tier. |
| `investor` | ✅ AU (subclass 188). US has "Treaty trader/treaty investor ~ E" on the official directory but no landing page was verified. No CA/GB match verified. |
| `open_work_permit` | ✅ CA only (official "Open work permit" page exists on the IRCC work hub). Closest AU analogue is subclass 485. No US/GB match. |
| `digital_nomad` | ❌ **no official category in any of the four destinations.** |
| `citizenship` | ❌ out of scope of all four visa catalogs (CA publishes citizenship separately from visas). |
| `startup` | ❌ not verified in any of the four official catalogs this session. |
| `refugee_humanitarian` | ❌ (already flagged non-priceable in the seed) — CA and GB both publish asylum/refugee sections, but no official page was fetched. |

## Official categories VisaAI is missing

High-volume routes that appear on the official indexes with no corresponding VisaAI `visa_type`:

- **US — Exchange visitor (J)**, listed on the official Directory of Visa Categories (`Exchange visitor ~ J ~ SEVIS`, `Au pair (exchange visitor) ~ J`, `Professor, scholar, teacher (exchange visitor) ~ J`). No VisaAI tier covers it.
- **US — Transit (C)** (`Transiting the United States ~ C`). CA also publishes a distinct **transit visa** on the Visit Canada hub. VisaAI has no transit type.
- **AU — Temporary Graduate visa (subclass 485)**, the main post-study work route. Closest VisaAI tier is `open_work_permit`, which is priced `low` complexity.
- **AU — Working Holiday visa (subclass 417)** and **Work and Holiday visa (subclass 462)**. No VisaAI youth-mobility tier.
- **CA — Super visa** (parents/grandparents, up to 5 years), listed on the official Visit Canada hub as a distinct route from the visitor visa.
- **CA — Visitor record** (extend a stay from inside Canada) — an in-country extension product VisaAI has no tier for.
- **GB — the family route beyond partner/spouse**: the official guide also covers **parent**, **child**, **adult dependent relative** and **private life** applications under one `family_sponsorship` umbrella; VisaAI collapses all of these into one tier.
- **AU — Employer Nomination Scheme (subclass 186)**, a permanent employer-sponsored route distinct from the temporary 482.

## Structural findings that affect the migration generator

1. **"Visitor visa" and "travel authorisation" are different products.** Three of four destinations require an *authorisation* (eTA / ESTA / ETA / subclass 601) for visa-exempt nationals and a *visa* for everyone else, decided by an official eligibility checker (`check-visa-eta.html`, `check-uk-visa`, `visa-finder`). Any generated framework should branch on nationality before choosing a route.
2. **Form identifiers exist only for Canada and the US.** Canada uses IMM numbers (IMM 5257 / 1294 / 1295 / 1344 / 5484); the US uses DS- and I- numbers (DS-160, DS-260, I-129, I-130, I-485, I-765). The UK and Australia publish **no form identifiers at all** — both are pure online journeys (UKVI service, ImmiAccount). A `form_identifier NOT NULL` column would be wrong.
3. **Only Canada publishes a static, per-visa document checklist page** (IMM 5484). Australia generates checklists inside client-rendered tabs; the UK publishes "Documents you'll need to apply" as a guide part for Student and Skilled Worker but **not** for the Standard Visitor route; the US publishes none of the four.
4. **Fees are not machine-readable from most official pages.** Only GOV.UK stated amounts plainly in-page. IRCC, DOS and Home Affairs all publish fees on separate tables that were not transcribed. Fee amounts should be a scheduled scrape, not part of a static migration.
5. **URL drift is real.** `canada.ca/.../work-canada/permit.html` now redirects to `.../work-canada.html`; AU's `temporary-skill-shortage-482` redirects to `skills-in-demand-visa-subclass-482`; `gov.uk/apply-uk-eta` is dead and the live path is `gov.uk/eta`. The registry stores the post-redirect canonical URL. Re-validation should be periodic.
6. **VisaAI's existing `country_frameworks` seed uses `visa_type = 'TRV'` for Canada** (`supabase/migrations/20260531000000_initial_schema.sql`) while `pricing_visa_tiers` uses `'visitor'`. The registry records `official_code: "TRV"` alongside `visaai_category: "visitor"` so the generator can reconcile the two vocabularies.

## Registry shape

```
{
  schema_version, generated_at, generator, verification_policy,
  visaai_supported_visa_types[], visaai_supported_visa_types_source,
  destinations[ {
    country_code, country_name,
    authorities { immigration_authority, foreign_affairs_authority },
    portals { evisa_or_travel_authorisation_portal, visa_options_index_url,
              secondary_index_urls[], eligibility_self_check_tool_url,
              forms_index_url, fees_index_url, online_account_portal_url },
    visa_types[ { visaai_category, official_name, official_code,
                  landing_url, eligibility_url, document_checklist_url, apply_url,
                  additional_urls[], forms[{identifier, official_name, url}],
                  application_method, application_method_note,
                  fee_page_url, fees_read[], notes } ],
    provenance[ { url, title, language, http_status, fetched_at } ]
  } ],
  blocked[], could_not_verify[]
}
```

All keys are snake_case. Unverified values are `null` and every one of them has a matching entry in `could_not_verify` with the reason.
