# Applicant profile coverage

## The honest position first

**There are infinitely many possible applicants and VisaAI has not tested every
one.** Any claim of exhaustive profile coverage would be false. What follows is
systematic coverage by equivalence class, with the classes named and the
combinations that are actually exercised marked as such.

## Equivalence classes

Derived from the fact set the rules engine accepts
(`visa-rules/rule.types.ts` — `RULE_FACTS`, a closed list of 33 facts). A rule
may only ask about something VisaAI collects, so the fact list bounds the
profile space.

| Dimension | Classes |
|---|---|
| Nationality | visa-required / visa-exempt / ETA-eligible / restricted |
| Residence | same as nationality / third country / dual |
| Age | minor (<18) / adult / older applicant (65+) |
| Passport | ordinary / official / diplomatic; validity ≥6mo / <6mo |
| Purpose | tourism / business / study / work / family / transit |
| Duration | ≤90 days / >90 days / open-ended |
| Employment | employed / self-employed / student / unemployed / retired |
| Funding | self-funded / sponsored / employer-funded / scholarship |
| Family | single / partnered / dependants / travelling with a minor |
| History | first-time / prior travel / prior refusal |
| Documents | complete / partial / none |

## What the rules engine exercises today

`rule-evaluator.spec.ts` (29 tests) covers, as boundary and property cases:

- nationality membership, including case-insensitive comparison — nationality
  reaches this layer from intake answers, OCR extraction and the partner API,
  none of which agree on casing
- age boundary at exactly 18; duration boundary at exactly 90 days
- numeric strings, because form inputs arrive as strings
- **the missing-fact case**, three-valued: a fact not supplied yields `unknown`,
  never `false`
- Kleene AND — a known `false` beats an unknown; Kleene OR — a known `true`
  beats an unknown
- negation propagating `unknown`
- a realistic nested subclass rule combining subclass, minor status, sponsor and
  passport type

## What is NOT exercised end to end

The rules engine is tested in isolation. **No profile has been driven through
the full application flow on this branch** — country selection, intake,
conditional questions, requirement generation, checklist, readiness.

The blocker is upstream and structural: `visa_requirements` is empty, so there
are no sourced requirements for a profile to be evaluated against. Until the
sync extracts and a reviewer approves the first set, an end-to-end profile test
would be testing the fallback path, not the product.

## Existing coverage elsewhere

`qa/visaai-autonomous-e2e/` holds the prior E2E program, and `qa/prefill-matrix/`
holds prefill fixtures. Those exercise the current `country_frameworks` path,
which this branch left deliberately untouched — see `COUNTRY_VISA_MODEL.md`.

## To close the gap

1. Extract and review requirements for one visa type (Canada visitor visa is the
   best candidate: most sources, the only static per-visa document checklist).
2. Build a profile fixture per equivalence class above.
3. Assert the generated checklist matches the sourced requirements for each,
   including that `unknown`-gated requirements render as "may be required" and
   never silently vanish.
4. Pairwise-combine the six highest-signal dimensions rather than attempting the
   full cross product.
