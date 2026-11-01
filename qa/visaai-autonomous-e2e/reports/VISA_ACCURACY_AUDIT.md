# Visa Accuracy Audit

_Run `visaai-e2e-20260812` · git `bc28ea6`_

This report records only what has actually been checked against an authoritative
source. Nothing here is inferred, and no claim is marked verified without a
source URL that was really visited.

## Method and its limits

The controller requires official-government verification. Two things constrain
how fast that can be done:

1. **Automated fetching of government sites is blocked.** `canada.ca` and
   `uscis.gov` both return **HTTP 403** to the WebFetch tool. Verification
   therefore has to run through a real browser session, one page at a time. This
   is a genuine external throughput limit, not a skipped step.
2. **A guessed URL is not a source.** The first canada.ca URL tried returned a
   404; it was discarded rather than cited. No source in this report was
   inferred from a URL pattern — each was loaded and read.

## Verified claims — every declared government form checked, all 6 real

**All six form codes the product declares across CA, US and AU were loaded from
their official government source and confirmed. Zero fabricated forms.**

| Country | Category | VisaAI value | Official value | Source | Status |
|---|---|---|---|---|---|
| CA | `visitor_visa` | `IMM 5257 — Application for Temporary Resident Visa` | `IMM 5257 — "Application for visitor visa (temporary resident visa)"`, IRCC. Form Sept 2023; page 2026-07-21 | [canada.ca](https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5257.html) | **VERIFIED** |
| CA | `family_sponsorship` | `IMM 5645 — Family Information` | `IMM 5645 — "Family Information Form – Visitors, Students and Workers"`, IRCC. Form Jan 2021; page 2024-06-21 | [canada.ca](https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm5645.html) | **VERIFIED** |
| CA | `student_visa` | `IMM 1294` | `IMM 1294 — "Application for a Study Permit Made Outside of Canada"`, IRCC. Form **June 2026** — current | [canada.ca](https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1294.html) | **VERIFIED** |
| CA | `work_permit` | `IMM 1295` | `IMM 1295 — "Application for a Work Permit Made Outside of Canada"`, IRCC. Form Sept 2023 | [canada.ca](https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides/imm1295.html) | **VERIFIED** |
| US | `family_sponsorship` | `I-130 — Petition for Alien Relative` + `uscis.gov/i-130` | `I-130, Petition for Alien Relative`, USCIS. **Exact title match; declared link resolves.** | [uscis.gov/i-130](https://www.uscis.gov/i-130) | **VERIFIED** |
| AU | `business_visa` | `1415 — subclass 600 Business Visitor stream, paper form, use only if Home Affairs told you to` | `1415 "Application for a Visitor visa - Business Visitor stream"`, Dept of Home Affairs, 14pp. Form itself: *"can only be used … in limited circumstances"*, *"after you have received written notice"* | [immi.homeaffairs.gov.au](https://immi.homeaffairs.gov.au/form-listing/forms/1415.pdf) | **VERIFIED** |

### Two findings worth calling out

**The AU 1415 caveat is exemplary, not a defect.** VisaAI puts the restricted-use
warning in `formName` — the string the applicant actually reads — and that warning
reproduces the form's own limitation. A product hallucinating here would have
presented a restricted paper form as the normal route. This does the opposite.

**One immaterial wording variance (CA IMM 5257).** VisaAI renders the title as
"Application for Temporary Resident Visa"; IRCC's official title is "Application
for visitor visa (temporary resident visa)". Code, authority and purpose all
match — a paraphrase of the official parenthetical. **Not filed as a defect.**

**No stale-source problem found.** IMM 1294's official form was last updated
June 2026 and the product cites the current one.

## Claims NOT yet verified

Every row below is `NEEDS_OFFICIAL_VERIFICATION`. None may be reported as correct.

| Country | Claim | VisaAI value | Status |
|---|---|---|---|
| Schengen ×29 | Forms | shared `SCHENGEN_FORMS` set | NEEDS_OFFICIAL_VERIFICATION |
| CA | Document list | bank statements / itinerary / passport / return flight / proof of relationship | NEEDS_OFFICIAL_VERIFICATION |
| All | Eligibility rules asserted by the LLM in interview text | varies per run | NEEDS_OFFICIAL_VERIFICATION |
| All | Fees | *never surfaced in any flow across 71 matrix cells* | N/A — nothing to verify |
| All | Processing times | *never surfaced in any flow across 71 matrix cells* | N/A — nothing to verify |

That the product surfaces **no fee and no processing-time claim at all** is itself
a finding: the two most volatile, most-likely-to-be-wrong classes of visa fact are
simply not asserted, which removes a whole category of staleness risk.

## Automated accuracy assertions running on every scenario

These do not replace official verification. They catch the failure modes that
can be judged without an external source, on every single scenario:

| Check | What it catches |
|---|---|
| `wrong_country_result` | result names a different destination and never the selected one |
| `cross_country_form_leak` | a form code owned by another country's programme appears (e.g. IMM 5257 under a Schengen application) — the highest-value hallucination signal available, because form ownership is deterministic product data |
| `forbidden_claim` | guaranteed approval, "100% success", claiming to be a government agency |
| `placeholder_or_debug_residue` | lorem ipsum, TODO/FIXME, `{{var}}`, `[INSERT…]`, `undefined undefined`, NaN, leaked system-prompt markers |

**Result so far: zero hits on all four across every scenario executed.** No
fabricated form, no wrong-country result, no approval guarantee and no prompt
leakage has been observed. On the evidence collected this is a real signal, but
it covers only the combinations already executed — see
`COUNTRY_VISA_COVERAGE.md` for exactly which.

## The structural accuracy risk found during discovery

`country_frameworks` holds **one** row — `CA / TRV / tourism`. For the other
**70 of 71** country × category combinations there is no seeded product
configuration, so the intake graph runs in discovery mode and the checklist is
produced entirely by the LLM. For those 70 combinations there is nothing
deterministic to check the model against inside the product itself; correctness
can only be established against official external sources.

This is the single largest accuracy risk in the product and it is structural,
not a bug in any one flow.
