# Keyword and content map

Scored by **official-data availability** as heavily as by demand, because a page
VisaAI cannot source is a page it must not publish.

## Query families, against what exists

Coverage reflects the registry as of 2026-08-21: 4 countries, 32 visa types,
111 official source URLs, **0 reviewed requirements**.

| Query family | Page | Data needed | Have it? |
|---|---|---|---|
| `[country] visa types` | `/visas/{country}` | authority + catalog + links | **yes — live** |
| `[country] visa options` | `/visas/{country}` | same | **yes — live** |
| `[visa official name]` e.g. "subclass 600" | `/visas/{c}/{v}` | official name + code + links | **yes — live, noindex** |
| `[country] visa requirements` | `/visas/{c}/{v}` | reviewed requirements | **no** |
| `[country] tourist visa` | `/visas/{c}/{v}` | same | **no** |
| `[country] student visa` | `/visas/{c}/{v}` | same | **no** |
| `[country] work visa` | `/visas/{c}/{v}` | same | **no** |
| `[country] visa documents` | `/visas/{c}/{v}` | reviewed evidence requirements | **no** |
| `[country] visa application form` | forms section | form ids + URLs | **partial** — 19 form sources, CA and US only |
| `[country] visa fees` | fees section | sourced amounts | **partial** — only GOV.UK states them plainly in-page |
| `[country] visa processing time` | — | processing times | **no** — none recorded anywhere |
| `do I need a visa for [country]` | — | nationality × destination rules | **no** |
| `[country] visa for [nationality]` | — | sourced nationality rules | **no** |
| `[visa A] vs [visa B]` | — | reviewed requirements for both | **no** |

## The competitive picture (observed 2026-08-20, one location, point in time)

- `[country] visa requirements` and `do I need a visa for X` — **government
  pages dominate.** VisaAI will not outrank an authority on its own rule, and
  should not try. The winnable angle is *aggregation and currency*: one page
  covering a country's whole catalog with a verified date, which no single
  government page provides.
- `[country] visa application form` and `[country] requirements for
  [nationality]` — **aggregators hold these** (schengenvisainfo, axa-schengen,
  visarequirements.info), with no government result in the Schengen sample.
  This is the genuinely contestable space, and it is where sourced provenance
  plus a visible verified date is a real differentiator rather than a slogan.

Observation, not a ranking claim, and it will not hold indefinitely.

## Priority

**1. Requirement extraction for Canada visitor visa.** Unblocks the largest
family of queries and is the best-sourced visa in the registry — the most source
URLs and the only static per-visa document checklist. One extraction turns one
noindex page into a publishable one and proves the whole pipeline.

**2. The remaining 31 visa types.** Mechanical once (1) works.

**3. Official forms pages.** 19 form sources already exist; CA and US publish
form identifiers, UK and Australia publish none — so this family is
structurally limited to two of four destinations, which is a fact about the
governments, not a gap to close.

**4. Fees.** Only GOV.UK states fees plainly in-page. Everywhere else needs a
fee-table extractor. Fee queries have high intent and a wrong number is worse
than no number.

**5. Nationality-specific pages.** Only where a sourced nationality rule exists
in `visa_requirements.rule`. Not before — see
`PROGRAMMATIC_SEO_ARCHITECTURE.md` on why the 25,600-URL matrix is not built.

## Explicitly not pursued

- `best visa for [purpose]` — VisaAI cannot rank government programs against
  each other without making a recommendation it is not authorised to make.
- `[country] visa success rate` — no authority publishes usable data, and
  implying VisaAI improves odds is the outcome claim the spec bans.
- `cheapest / fastest visa` — invites a comparison the data cannot support.
- Anything requiring processing times, since none were verifiable on any
  official page in the source research.
