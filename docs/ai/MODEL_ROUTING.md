# Model routing

**Generated table below** — regenerate with
`pnpm --filter api exec ts-node -P tsconfig.json scripts/ai/print-routing-table.ts`.
Model IDs and rates verified against `developers.openai.com` on 2026-08-20.

## Policy

1. **Deterministic code first.** If a database query, a rule engine, a regex or
   a hash answers it, no model is called. This is why `visa-rules/` exists: the
   conditional-requirement logic that used to be an LLM's problem is now a
   tested pure function.
2. **Smallest capable tier for bounded tasks** — classification, extraction,
   normalization.
3. **Balanced for genuine reasoning** or user-facing prose a person judges.
4. **Frontier only where evals justify the cost.** No task currently defaults to
   `frontier`; it is the escalation target for five.
5. **Human review where the risk is legal or the confidence is low** — every
   material government change (`visa_source_changes.requires_review`).

## Per-task routing

| Task | Was | Tier | Model | Effort | Max out | Cacheable | Batch | Threshold |
|---|---|---|---|---|---|---|---|---|
| `document_classification` | gpt-4o (vision path) | nano | `gpt-5.6-luna` | none | 200 | yes | yes | 95% |
| `field_extraction` | gpt-4o-mini | small | `gpt-5.6-luna` | low | 1200 | yes | yes | 92% |
| `source_normalization` | _new_ | balanced | `gpt-5.6-terra` | medium | 4000 | yes | yes | 90% |
| `change_classification` | _new_ | nano | `gpt-5.6-luna` | none | 600 | yes | yes | 93% |
| `recommendation_explanation` | _new_ | small | `gpt-5.6-luna` | low | 500 | no | no | 90% |
| `requirement_explanation` | _new_ | nano | `gpt-5.6-luna` | none | 350 | yes | no | 88% |
| `document_quality_feedback` | _new_ | nano | `gpt-5.6-luna` | none | 400 | yes | no | 90% |
| `user_draft_generation` | gpt-4o | balanced | `gpt-5.6-terra` | medium | 2048 | no | no | 90% |
| `intake_question_generation` | gpt-4o | small | `gpt-5.6-luna` | low | 1024 | no | no | 90% |
| `intake_answer_extraction` | gpt-4o-mini | nano | `gpt-5.6-luna` | none | 1024 | no | no | 92% |
| `form_prefill` | gpt-4o | balanced | `gpt-5.6-terra` | medium | 4096 | no | no | 92% |
| `vri_assessment` | gpt-4o | balanced | `gpt-5.6-terra` | medium | 1500 | no | no | 90% |
| `visa_category_suggestion` | gpt-4o-mini | small | `gpt-5.6-luna` | low | 6000 | no | no | 90% |
| `translation_assistance` | _new_ | nano | `gpt-5.6-luna` | none | 2000 | yes | yes | 90% |
| `visa_requirement_estimate` | gpt-4o-mini | small | `gpt-5.6-luna` | low | 600 | no | no | 85% |
| `profile_evaluation` | gpt-4o | balanced | `gpt-5.6-terra` | medium | 800 | no | no | 90% |
| `recommendation_copy` | gpt-4o-mini | small | `gpt-5.6-luna` | low | 800 | no | no | 88% |
| `support_assistant` | _new_ | small | `gpt-5.6-luna` | low | 600 | no | no | 88% |

## What moved, and the honest cost picture

**Six tasks moved off `gpt-4o`** ($2.50 in / $10.00 out per 1M):

| Task | To | Input rate change |
|---|---|---|
| `intake_question_generation` | `gpt-5.6-luna` | $2.50 → $0.20 (**12.5× cheaper**) |
| `document_classification` | `gpt-5.6-luna` | $2.50 → $0.20 (**12.5× cheaper**) |
| `user_draft_generation` | `gpt-5.6-terra` | $2.50 → $2.00 (20% cheaper in, 20% dearer out) |
| `form_prefill` | `gpt-5.6-terra` | same |
| `vri_assessment` | `gpt-5.6-terra` | same |
| `profile_evaluation` | `gpt-5.6-terra` | same |

**Five tasks moved off `gpt-4o-mini`** ($0.15 in / $0.60 out) to `gpt-5.6-luna`
($0.20 in / $1.20 out). **This is a headline price increase** and is stated as
such rather than presented as a saving. It is expected to be cost-neutral or
better in practice for two reasons, neither of which is yet measured in
production:

- **`reasoning.effort: 'none'`** on the `nano` tier suppresses reasoning tokens
  entirely. Output tokens are where Luna is 2× dearer, so this is the term that
  decides it.
- **Cached input is $0.02 vs $0.075** — 3.75× better. Only realised once prompts
  are restructured so the stable country/visa preamble forms a ≥1024-token
  prefix. That work is **not done** (see `OPENAI_ARCHITECTURE.md` §8).

If a `nano`-tier task turns out to emit reasoning tokens anyway, the correct
response is to pin that tier back to `gpt-4o-mini` via `AI_MODEL_NANO` and say
so — not to leave a regression in place because the newer model is newer.

## Escalation

`fallbackTier` is used when the default fails its **structural** check —
invalid schema, refusal, empty output — not when the answer merely looks poor.
Escalation must be strictly upward; a test asserts it for every task.

Five tasks escalate to `frontier`: `source_normalization`,
`user_draft_generation`, `form_prefill`, `vri_assessment`, `profile_evaluation`.

## Rollback

`AI_MODEL_NANO`, `AI_MODEL_SMALL`, `AI_MODEL_BALANCED`, `AI_MODEL_FRONTIER`.
Set one to any model ID, restart the API — no deploy, no code change. Unset
returns to the policy default. This is the only intended mechanism for reverting
a model decision.

## The tiers are not four models

`nano` and `small` resolve to the **same model** and differ only in
`reasoning.effort`. There is no `gpt-5.6-nano`. Anyone reading the table and
concluding "two tiers are redundant" should read `model-policy.ts` first: on
this model family the effort parameter, not the model name, is the cost dial.
