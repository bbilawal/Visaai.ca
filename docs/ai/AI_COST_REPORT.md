# OpenAI cost report

**Reporting date:** 2026-08-21.
**Status: structural change measured; runtime cost NOT measured.**

Read this section before any number below it.

## What can and cannot be claimed

The spec (§81) requires before/after measurements of AI calls per journey,
tokens, cost, latency, tier distribution, cache hit rate and escalation rate.

**Those runtime numbers do not exist yet, and this report does not invent
them.** Producing them needs a funded OpenAI key and traffic through the
migrated callsites; this branch has neither. `ai_usage_events` on production
holds only pre-migration `gpt-4o`/`gpt-4o-mini` rows.

What IS measured is the structural change: which task runs on which model, at
which published rate, with which output ceiling. That is a real before/after and
it is below. What is a projection is labelled a projection.

## Before → after, by published rate

Rates per 1M tokens, from `developers.openai.com/api/docs/pricing`, 2026-08-20.

| Task | Before | in / out | After | in / out | Input Δ |
|---|---|---|---|---|---|
| `intake_question_generation` | gpt-4o | 2.50 / 10.00 | gpt-5.6-luna | 0.20 / 1.20 | **−92%** |
| `document_classification` | gpt-4o | 2.50 / 10.00 | gpt-5.6-luna | 0.20 / 1.20 | **−92%** |
| `user_draft_generation` | gpt-4o | 2.50 / 10.00 | gpt-5.6-terra | 2.00 / 12.00 | −20% |
| `form_prefill` | gpt-4o | 2.50 / 10.00 | gpt-5.6-terra | 2.00 / 12.00 | −20% |
| `vri_assessment` | gpt-4o | 2.50 / 10.00 | gpt-5.6-terra | 2.00 / 12.00 | −20% |
| `profile_evaluation` | gpt-4o | 2.50 / 10.00 | gpt-5.6-terra | 2.00 / 12.00 | −20% |
| `field_extraction` | gpt-4o-mini | 0.15 / 0.60 | gpt-5.6-luna | 0.20 / 1.20 | **+33%** |
| `intake_answer_extraction` | gpt-4o-mini | 0.15 / 0.60 | gpt-5.6-luna | 0.20 / 1.20 | **+33%** |
| `visa_category_suggestion` | gpt-4o-mini | 0.15 / 0.60 | gpt-5.6-luna | 0.20 / 1.20 | **+33%** |
| `visa_requirement_estimate` | gpt-4o-mini | 0.15 / 0.60 | gpt-5.6-luna | 0.20 / 1.20 | **+33%** |
| `recommendation_copy` | gpt-4o-mini | 0.15 / 0.60 | gpt-5.6-luna | 0.20 / 1.20 | **+33%** |

**Five tasks got more expensive per uncached token, and output is 2× dearer on
all five.** That is the honest headline and it is stated first rather than
buried under the 92% wins.

Two mechanisms are expected to more than absorb it, neither yet measured:

- `reasoning.effort: 'none'` on the `nano` tier suppresses reasoning tokens.
  Output is where Luna is 2× dearer, so this is the deciding term.
- Cached input is $0.02 vs $0.075 — 3.75× better — **once prompts are
  restructured** so the stable preamble forms a ≥1024-token prefix. Not done.

If measurement shows a `nano` task emitting reasoning tokens anyway, pin
`AI_MODEL_NANO=gpt-4o-mini` and record the reversal. The override exists for
exactly this.

## Metering gap closed

`ai_usage_events` could not have priced GPT-5.6 correctly before this branch:

| | Before | After |
|---|---|---|
| cached input tokens | not recorded | `cached_input_tokens` |
| cache write tokens | not recorded | `cache_write_tokens` |
| cache write cost | **not priced at all** | 1.25× input rate |
| 272K long-context surcharge | not priced | 2× in / 1.5× out |
| `operation` granularity | per graph (`'intake'`) | per task |

Cache writes are billed on GPT-5.6 and were free on 4o. Routing to 5.6 without
this change would have **understated spend by up to 25% of input cost on every
cache miss** — precisely when someone is judging whether caching paid off.

The `operation` change matters as much: `'intake'` covered both the expensive
question-generation node and the cheap extraction node, so no report could say
which half the money went to. It is now the task name.

## Structural savings that need no model

Two changes reduce cost without touching a rate:

**Output ceilings are now per task, from the registry.** `maxTokens: 1024` was
copy-pasted across nodes regardless of whether the node emits a three-word label
or a two-page letter. `document_classification` is capped at 200 and
`change_classification` at 600.

**Deterministic work left the model.** `visa-rules/` moved conditional
requirement logic out of prompts into a tested pure function — zero tokens where
there used to be a call.

## To produce the measured report

1. Run the eval suites (`AI_EVALS.md`) — confirms or refutes each tier.
2. Deploy with a funded key; let one week of real traffic through.
3. Query `ai_usage_events` grouped by `operation`, comparing to the
   pre-migration window:

```sql
select operation, model,
       count(*)                                       as calls,
       sum(input_tokens)                              as input,
       sum(cached_input_tokens)                       as cached,
       sum(cache_write_tokens)                        as writes,
       sum(output_tokens)                             as output,
       round(sum(request_cost_usd), 4)                as usd,
       round(sum(cached_input_tokens)::numeric
             / nullif(sum(input_tokens), 0), 3)       as cache_hit_ratio
from ai_usage_events
where created_at >= now() - interval '7 days'
group by operation, model
order by usd desc;
```

4. Cost per application: join `ai_usage_events` on `application_id`.
5. Escalation rate: currently not recorded. The gateway would need to log the
   tier actually used versus the task default — a known gap.
