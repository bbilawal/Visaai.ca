# Prompt and token optimization

**Status: partially implemented.** The routing and budget work is done; the
prompt restructuring that unlocks caching is not. Both stated plainly below.

## Done

### Output budgets are per task

`maxTokens: 1024` was copy-pasted across LangGraph nodes regardless of what the
node emits. Two failure modes, in opposite directions:

- a bounded task with a generous cap is a bill nobody notices;
- a generative task with a tight cap is a truncated document the user sees.

Budgets now come from `task-registry.ts`. During migration each callsite's
existing budget was **carried over exactly** — `form_prefill` keeps 4096 and
`visa_category_suggestion` keeps 6000 — because lowering a cap during a
mechanical refactor silently drops fields off the end of a long government form.
Tightening them is a separate, measured change.

### Reasoning effort as the primary dial

On the GPT-5.6 family reasoning is a parameter, not a model line.
`reasoning.effort: 'none'` on the `nano` tier suppresses reasoning tokens
entirely, which is where the saving on bounded tasks now comes from.

### Deterministic work removed from prompts

`visa-rules/` moved conditional-requirement logic from prompt text into a tested
pure function: `evaluateRule()`, `factsUsed()`, `explainRule()`. Rules that used
to be described to a model in prose are now data the model never sees.

### Untrusted content is fenced, not duplicated

Fencing adds tokens, so it is applied where the content is genuinely untrusted
rather than everywhere. The directive appears once per system prompt, not per
fenced block.

## Not done — and these are the material ones

### Stable prefixes for prompt caching

**This is the single largest unrealised saving.** Cached input on `gpt-5.6-luna`
is $0.02/1M against $0.20 uncached — 10× — and on `terra` $0.20 against $2.00.

Realising it requires each prompt to open with a ≥1024-token block that is
**byte-identical across requests**: the VisaAI system policy, the extraction
schema, the tool definitions, the country/visa preamble. Volatile applicant data
must come after it. Today's prompts interleave the two, so the prefix changes
every request and nothing caches.

`cachingIsWorthIt(model, prefixTokens, expectedReuses)` already encodes the
economics, including refusing a one-shot prompt — on 5.6 a write costs 1.25×
input, so caching something read once is a net loss.

Suggested `prompt_cache_key` shape: `visa:{country}:{visaType}:{promptVersion}`.

### Unbounded context in the costliest callsite

The intake question node sends the full profile, the full checklist **and the
entire transcript** on every turn, against a ~2,700-token system prompt. Voice
windows to 8 turns and messaging to 20; intake windows to nothing.

This is the highest-value remaining token fix and it is not a model change: a
compact structured state plus the last N turns would cut the largest prompt in
the system. Deliberately left out of this branch — it changes what the model
sees, so it needs its eval suite first.

### Uncapped OCR text in translation

The document translation path sends the entire OCR text with no cap; a 40-page
bank statement goes whole. `derive-fields` caps at 24,000 characters and is the
only callsite that does. With a 1.05M context and a 272K surcharge cliff, an
uncapped path is now a cost cliff rather than an error.

### No application-level result cache

`task-registry.ts` declares `cacheable` and a TTL on every task and **nothing
reads them**. The cache key design is settled — task version, prompt version,
model policy version, normalized input hash, source version, locale — and the
highest-value target is `source_normalization`, where the nightly sync re-reads
hundreds of unchanged government pages whose bytes are immutable per version.

### Batch API unused

`batchEligible` is declared; the 50% discount is unclaimed. Best candidates:
`source_normalization` and `change_classification` on the nightly run, neither
of which has a user waiting.

## Measuring a change

Tokenize before and after on the same fixture set, then compare
`ai_usage_events` for the task over equivalent windows. A prompt change without
a token count before and after is not an optimization, it is an edit.
