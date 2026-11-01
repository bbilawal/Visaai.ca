# AI evals

`apps/api/src/modules/shared/ai/evals/eval-harness.ts` — 18 tests.

## Why it exists

Two of the spec's non-negotiable rules are unenforceable without it:

- **Rule 17** — use the cheapest model that passes measured quality thresholds.
- **Rule 24** — never switch to a cheaper model solely because it costs less.

Both require a way to measure one task at one tier. This is that way.

## What it is not

A model benchmark. It measures **one VisaAI task** against fixtures drawn from
that task's real inputs, scored by that task's own definition of correct. A
model scoring 0.99 on a public leaderboard and 0.71 on `document_classification`
is a bad model for `document_classification`, and this harness says so.

## How the recommendation works

`recommendTier()` runs the task across all four tiers and returns the cheapest
that **clears its threshold**. The ordering is the entire mechanism:

```
  passing = reports.filter(meetsThreshold)   // quality gate FIRST
  winner  = passing[0]                       // TIER_ORDER is cheapest-first
```

A tier that fails is not a candidate at any price. That is what turns rule 24
from an intention into a property of the code, and it is asserted directly:

> `it('never recommends a cheaper tier that failed its threshold')`

When the **configured** tier fails, the harness recommends an upgrade and says
so in plain language — a task below its quality threshold is producing wrong
answers cheaply, which is worse than producing right ones expensively.

When **no** tier passes, it recommends nothing and says *"Do not route this task
automatically — it needs a better prompt, a better schema, or human review."*

## Scoring rules that matter

**A structural failure is never a pass.** Unparseable JSON that happens to
contain the right substring is not a correct answer. Asserted.

**A thrown call is a failed case, not a crashed run.** A tier that times out on
a third of the set has told you something important about itself and must still
appear in the report with its failures counted.

**Cost is priced per case with the tier's actual model rate**, through the same
`priceUsageDetailed()` the production meter uses — so an eval's cost estimate
and a production bill cannot drift.

## Fixture safety

`assertFixtureIsSafe()` refuses a fixture set containing:

| Marker | Why |
|---|---|
| passport MRZ (`P<GBR...`) | a real passport scan |
| 13–19 digit runs | card or account number |
| IBAN pattern | bank details |
| `NNN-NN-NNNN` | US social security number |
| any non-`example.*` email domain | a real person's address |

These tasks run over passports, bank statements and family records, and a
fixture file gets copied onto laptops and printed into CI logs. The check is
blunt rather than clever on purpose: the careless case is the one that actually
happens — someone pastes a real OCR dump in to debug a failure and forgets to
take it out.

## Status: measured 2026-08-21

## Status: RUN 2026-08-21 against the live API

Both suites have now been evaluated against real OpenAI endpoints with a funded
key. The tier assignments below are **measured**, not reasoned.

### document_classification — measured, and the configured tier is right

Threshold 95%. Configured tier `nano`. Recommended `nano`.

| Tier | Model | Passed | Pass rate | $/case | p50 | avg in | avg out |
|---|---|---|---|---|---|---|---|
| nano | gpt-5.6-luna | 10/10 | 100.0% | $0.000035 | 714ms | 146 | 5 |
| small | gpt-5.6-luna | 10/10 | 100.0% | $0.000035 | 545ms | 146 | 5 |
| balanced | gpt-5.6-terra | 10/10 | 100.0% | $0.000399 | 612ms | 146 | 9 |
| frontier | gpt-5.6-sol | 10/10 | 100.0% | $0.000984 | 1058ms | 146 | 9 |

Every tier passes, so the cheapest wins and the existing assignment is
confirmed. Frontier costs **28x** nano to produce the same answers on this
task.

### field_extraction — measured, after the suite was fixed

Threshold 92%. Configured tier was `small`; **lowered to `nano` on this
measurement**.

| Tier | Model | Passed | Pass rate | $/case | p50 | avg in | avg out |
|---|---|---|---|---|---|---|---|
| nano | gpt-5.6-luna | 10/10 | 100.0% | $0.000115 | 959ms | 239 | 56 |
| small | gpt-5.6-luna | 9/10 | 90.0% | $0.000160 | 1126ms | 239 | 93 |
| balanced | gpt-5.6-terra | 10/10 | 100.0% | $0.001351 | 1210ms | 239 | 73 |
| frontier | gpt-5.6-sol | 10/10 | 100.0% | $0.004791 | 2908ms | 239 | 120 |

`nano` is cheaper **and** more accurate than the tier it replaces. This is the
downgrade rule 24 permits, and it is worth being precise about why: nano is
chosen because it clears the threshold, with cost only as a tie-break among
tiers that already passed. A cheaper tier that failed would not have been a
candidate at any price.

`small` failing `non-latin-name` while `nano` passes is real and repeatable.
The two are the same model and differ only in reasoning effort (`low` vs
`none`); on a dual-script name the extra reasoning talks itself into
normalising a field the prompt asked to be copied exactly.

#### The first measurement of this task was wrong, and said the opposite

An earlier run scored nano 80, small 70, balanced 70, frontier 80 and concluded
*"no tier met the threshold — do not auto-route"*. Every one of those numbers
was real, and none of them described the product.

The runner was sending a hand-authored five-field instruction — `full_name`,
`date_of_birth`, `document_number`, `expiry_date`, `issuing_authority`.
Production builds its prompt from `extractionPromptFor(documentType)` over a
typed per-type schema, where a passport has eleven keys and the identifier is
`passport_number`. **There is no `document_number` anywhere in the product.**

Both permanent failures were artifacts of that gap, confirmed by running the
two prompts against identical inputs:

* `non-latin-name` expected `full_name: 'WEI ZHANG'` — a Latin-only,
  given-name-first normalisation nothing had asked for. Under the production
  prompt the model returns `given_name: '伟 / WEI'`, `family_name: '张 / ZHANG'`,
  which is what *"exactly as printed"* means.
* `degraded-ocr` expected the passport number `EX00000O5` to be silently
  repaired to `EX0000005` — while the same prompt said *"Do NOT infer"*. The
  fixture required the behaviour it forbade. The model returned the verbatim
  string, which for a visa product is the right answer: a repaired passport
  number is indistinguishable from a real one downstream, and a wrong repair
  puts a number the applicant does not hold onto a government form. That is now
  pinned as a test rather than treated as a failure.

The lesson generalises past this suite: **an eval that does not send the
production prompt is measuring a hypothesis, not a system**, and it will
confidently recommend changes to a model that is not the thing at fault.

### The first run measured nothing, and said the opposite

Worth recording, because the failure mode is subtle. The first live run
returned 0/10 on every tier for both suites and concluded *"No tier met the
threshold — it needs a better prompt, a better schema, or human review."*

Every number in it was an artifact: $0.000000 per case, 0 input tokens, 0
output tokens, ~100ms latency. Nothing had been sent. `chatModelForTask` was
passing `reasoning: { effort }` — the Responses API shape — to
`/v1/chat/completions`, which answers `400 Unknown parameter: 'reasoning'`.

The harness had captured that error on every case and printed only a COUNT of
"structural fails", so a run where nothing executed was indistinguishable from
a run where the model answered everything wrongly — and the verdict it printed
blamed the prompt. The harness now leads with an explicit "this run produced no
measurement" warning and prints the first error verbatim.

Two lessons stand: a 0% pass rate with $0 cost and 0 tokens is never a model
result, and an eval that cannot tell you *why* a case failed will eventually
send someone to fix the wrong layer.

### To run one

```bash
cd apps/api
OPENAI_API_KEY=sk-... npx ts-node -P tsconfig.json scripts/run-evals.ts document_classification
OPENAI_API_KEY=sk-... npx ts-node -P tsconfig.json scripts/run-evals.ts --all
```

Paste the markdown it prints into `AI_COST_REPORT.md`. It costs real money —
every case runs against all four tiers — so the per-suite form is the default
and `--all` is opt-in. The full `--all` run above cost well under a cent in
total; the expensive part is frontier, at roughly $0.003 per case.

`assertFixtureIsSafe` runs on every invocation, not just when the fixtures were
written, so a set that later acquires real data cannot be sent to a third party.

### The two fixture sets, and what they are built to catch

**`document_classification`** — 10 cases. Three clean, three **confusion
pairs**, two degraded, two must-not-guess.

The confusion pairs are the point. A set of only clean documents makes every
tier pass and the recommendation meaningless. Payslip-vs-employment-letter,
bank-letter-vs-bank-statement and national-ID-vs-passport are the pairs that
separate tiers, and each mislabelling marks the wrong checklist item satisfied.
The two `unknown` cases exist because a classifier that forces every input into
the nearest label will mark a requirement satisfied by a parking ticket.

**`field_extraction`** — 10 cases, built around one failure: **does the model
invent a value that is not on the document?** Four cases have a genuinely
absent field where `null` is the correct answer. An extractor that fills every
slot because the schema has five writes a fabricated expiry date into an
applicant's profile, which then drives a reminder and a readiness score.

Two cases are the same digits, `03/04/1990`, with the document stating
DD/MM/YYYY in one and MM/DD/YYYY in the other. VisaAI serves both conventions;
a model that assumes one corrupts half its inputs. Also covered: a dual-script
name, a multi-word surname, degraded OCR, and a document carrying three dates
where taking the issue date as the expiry makes an expired passport look valid.

The scorer requires every field to match **including the nulls**, so inventing
a value fails the case rather than partially passing it.

### Still to write

`intake_answer_extraction` (interactive, moved from `gpt-4o-mini` to nano),
`source_normalization` (most expensive task in the registry), and
`user_draft_generation` (a person reads the output and judges the product).
