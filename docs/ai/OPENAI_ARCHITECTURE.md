# OpenAI architecture

**Status:** implemented 2026-08-20/21. Model facts verified against
`developers.openai.com` on 2026-08-20 — see §7 for the re-verification procedure,
because these change.

---

## 1. What this replaced

Every AI callsite chose its own model with a string literal. `gpt-4o` and
`gpt-4o-mini` appeared across 12 source files. Three consequences:

1. **Changing model strategy meant a 12-file diff**, so it never happened, so
   every task — including one-token classification — ran on a 2024 frontier
   model.
2. **There was nowhere to say what a task IS.** Output schema, latency class,
   sensitivity, cost ceiling, cache policy: none of it could be declared, so
   none of it could be enforced.
3. **No task could be evaluated.** "Is the cheap model good enough here?" had no
   unit of analysis to ask the question about.

There was a partial gateway — `shared/ai/ai.service.ts` had provider fallback,
retry and usage metering — but its model was a literal on line 61, so it was a
resilience layer, not a routing layer.

## 2. The three layers

```
  feature code            asks for a TASK
        │
        ▼
  task-registry.ts        what the task IS: schema, latency, sensitivity,
                          output budget, cost ceiling, cache policy,
                          eval threshold, prompt version, TIER
        │
        ▼
  model-policy.ts         tier -> concrete model + reasoning effort + cache mode
        │                 THE ONLY FILE CONTAINING A MODEL ID
        ▼
  model-factory.ts        builds the client, attaches metering
```

A feature never names a model. `model-policy.ts` is the only file where a model
ID appears, so an OpenAI lineup change is a one-file edit and a rollback is an
environment variable.

## 3. Task registry

`apps/api/src/modules/shared/ai/task-registry.ts`. 16 tasks, each declaring:

| Field | Why it is enforced |
|---|---|
| `defaultTier` / `fallbackTier` | routing and escalation; fallback must be strictly higher (tested) |
| `consumer` | `machine` consumers MUST use structured output (tested) — parsing prose is the fragile-parsing failure the spec bans |
| `latency` | `interactive` tasks are never batch-eligible (tested) |
| `sensitivity` | drives redaction and provider retention posture |
| `maxOutputTokens` | a bounded task with no cap is a bill nobody notices |
| `maxCostUsd` | per-request ceiling |
| `cacheable` + `cacheTtlSeconds` | must agree (tested); false for anything depending on live applicant facts |
| `qualityThreshold` | an unevaluated task is one nobody can safely downgrade |
| `promptVersion` | part of the cache key, so a prompt edit invalidates cache |

## 4. Tier → model

| Tier | Model | Reasoning effort | Rationale |
|---|---|---|---|
| `nano` | `gpt-5.6-luna` | `none` | bounded, mechanical |
| `small` | `gpt-5.6-luna` | `low` | standard extraction, short generation |
| `balanced` | `gpt-5.6-terra` | `medium` | multi-step reasoning, user-facing prose |
| `frontier` | `gpt-5.6-sol` | `high` | genuinely hard reasoning |

**There is no `gpt-5.6-nano`.** The 5.6 family has three members and Luna is the
bottom. The `nano` tier still exists because it means something different from
`small` — it selects `reasoning.effort: 'none'`, and now that reasoning is a
parameter rather than a model line, that is where the saving comes from.

Per-tier override via `AI_MODEL_NANO` / `_SMALL` / `_BALANCED` / `_FRONTIER`.
This is the rollback lever: pin a tier back and restart, no deploy.

## 5. Three pricing facts that shaped the design

Each is a place where the obvious move would have been wrong.

**`gpt-4o-mini` → Luna is a price INCREASE on uncached tokens** ($0.15/$0.60 →
$0.20/$1.20). It only pays off through the cache ($0.075 → $0.02 per 1M, a 3.75×
better read rate) and through `effort: 'none'` suppressing reasoning tokens.
Tasks on `gpt-4o-mini` are therefore not migrated for cost reasons — they
migrate when they clear their eval threshold, and the cost report states the
delta either way.

**Cache writes are billed on GPT-5.6**, at 1.25× the uncached input rate — a
line item that did not exist on 4o. A prompt written once and never re-read
costs *more* cached than uncached. `cachingIsWorthIt()` refuses that case, and
`cacheMode: 'explicit'` exists so a stable prefix can be cached without the
volatile suffix also being written.

**Above 272K input tokens the whole request bills at 2× input / 1.5× output.**
One oversized applicant document silently doubles that call. Priced explicitly
in `ai-usage.pricing.ts` rather than discovered in a bill.

## 6. Cost observability

`ai_usage_events` gains `cached_input_tokens` and `cache_write_tokens`
(migration `20260820130000`). Without them, GPT-5.6's billed cache writes are
invisible and "did caching pay for itself?" has no numerator.

`extractTokens()` reads all four shapes the SDK reports cache detail in
(Responses `input_tokens_details`, Chat Completions `prompt_tokens_details`,
LangChain `usage_metadata.input_token_details`, and the classic
`tokenUsage`). A provider reporting no cache detail yields zeros, which price
identically to an uncached call — the correct degradation, not a guess.

`operation` on each event is now the **task name**, not a per-graph string. The
old value (`'intake'`) could not distinguish the expensive node from the cheap
one inside the same graph, which is exactly the question a cost report is asked.

## 7. Re-verifying model facts

These change. Before trusting anything in §4 or §5:

1. `https://developers.openai.com/api/docs/models` — note that
   `platform.openai.com/docs/*` 301s here now, and `openai.com/api/pricing`
   returns 403.
2. `https://developers.openai.com/api/docs/pricing` (and `.md`, which is the
   more scrapeable twin).
3. `https://developers.openai.com/api/docs/guides/prompt-caching` — check
   whether the cache-write multiplier and the 1024-token minimum still hold.
4. `https://developers.openai.com/api/docs/deprecations`.

**Snapshot risk:** the GPT-5.6 family currently publishes no dated snapshot IDs
(`gpt-5.6-sol`'s snapshot list contains only itself), unlike GPT-5.4 and GPT-5.
A model ID here cannot currently be pinned to a date. If OpenAI starts
publishing dated snapshots, pin them in `model-policy.ts`.

## 8. What is not done

- **Prompt caching is designed for but not yet exercised.** `cachingIsWorthIt()`
  and `cacheMode` exist and are tested; no callsite yet restructures its prompt
  so the country/visa preamble is a stable ≥1024-token prefix. That restructure
  is the next material cost change and is where the cached-input rate actually
  starts paying.
- **No application-level AI result cache.** `task-registry.ts` declares
  `cacheable` on every task and nothing reads it yet.
- **Batch API not used.** `batchEligible` is declared; the discount (50%) is
  unclaimed. The best candidates are `source_normalization` and
  `change_classification` on the nightly sync.
- **Three callsites still hold literals** by necessity: `openai-ocr.provider.ts`
  (vision), `openai-stt.provider.ts` and `openai-tts.provider.ts` (speech).
  These are modality-specific models, not chat tiers, so the tier abstraction
  does not fit them. They need their own small registry.

See `MODEL_ROUTING.md` for per-task tiers, `AI_EVALS.md` for the harness, and
`AI_COST_REPORT.md` for measured before/after.
