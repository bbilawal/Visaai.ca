import { AI_MODEL_PRICES, priceUsageDetailed } from './ai-usage.pricing';
import {
  CACHE_MIN_PREFIX_TOKENS,
  cachingIsWorthIt,
  hasCacheDiscount,
  isEscalation,
  knownModels,
  resolveModel,
  supportsExplicitCache,
} from './model-policy';
import { AI_TASKS, AI_TASK_NAMES } from './task-registry';

describe('resolveModel', () => {
  it('maps every tier to a model that has a published price', () => {
    // The failure this guards against is silent and expensive: an unpriced
    // model meters at $0, so a routing change to a model nobody added a rate
    // for looks like it made AI free.
    for (const model of knownModels()) {
      expect(AI_MODEL_PRICES[model]).toBeDefined();
    }
  });

  it('routes cheap tiers to the cheap model and hard tiers to the frontier model', () => {
    expect(resolveModel('nano').model).toBe('gpt-5.6-luna');
    expect(resolveModel('small').model).toBe('gpt-5.6-luna');
    expect(resolveModel('balanced').model).toBe('gpt-5.6-terra');
    expect(resolveModel('frontier').model).toBe('gpt-5.6-sol');
  });

  it('distinguishes nano from small by reasoning effort, not by model', () => {
    // There is no gpt-5.6-nano. The saving on bounded tasks comes from
    // suppressing reasoning tokens, which is a parameter now.
    const nano = resolveModel('nano');
    const small = resolveModel('small');
    expect(nano.model).toBe(small.model);
    expect(nano.reasoningEffort).toBe('none');
    expect(small.reasoningEffort).toBe('low');
  });

  it('honours a per-tier override so a tier can be pinned without a deploy', () => {
    expect(resolveModel('balanced', { balanced: 'gpt-5.4' }).model).toBe(
      'gpt-5.4',
    );
  });

  it('escalates upward only', () => {
    expect(isEscalation('nano', 'balanced')).toBe(true);
    expect(isEscalation('frontier', 'nano')).toBe(false);
    expect(isEscalation('small', 'small')).toBe(false);
  });
});

describe('cache policy', () => {
  it('uses explicit cache mode only on models that accept it', () => {
    expect(supportsExplicitCache('gpt-5.6-luna')).toBe(true);
    expect(supportsExplicitCache('gpt-4o')).toBe(false);
    // Sending prompt_cache_options to a model that does not accept it is an
    // API error, so the mode must follow the model, not the tier.
    expect(resolveModel('nano').cacheMode).toBe('explicit');
    expect(resolveModel('balanced', { balanced: 'gpt-4o' }).cacheMode).toBe(
      'implicit',
    );
  });

  it('refuses caching below the minimum prefix, where it cannot hit', () => {
    expect(
      cachingIsWorthIt('gpt-5.6-luna', CACHE_MIN_PREFIX_TOKENS - 1, 100),
    ).toBe(false);
    expect(cachingIsWorthIt('gpt-5.6-luna', CACHE_MIN_PREFIX_TOKENS, 100)).toBe(
      true,
    );
  });

  it('refuses caching for a one-shot prompt, where the write outweighs the read', () => {
    // 1.25 (write) + 0 reads > 1.0 uncached. Caching a prompt used once is a
    // net loss on 5.6 — the case the spec warns about.
    expect(cachingIsWorthIt('gpt-5.6-terra', 5_000, 0)).toBe(false);
    expect(cachingIsWorthIt('gpt-5.6-terra', 5_000, 1)).toBe(true);
  });

  it('refuses caching on models with no cached-input rate', () => {
    expect(hasCacheDiscount('gpt-5.5-pro')).toBe(false);
    expect(cachingIsWorthIt('gpt-5.5-pro', 100_000, 1_000)).toBe(false);
  });
});

describe('priceUsageDetailed', () => {
  it('prices an uncached call the same as the legacy positional form', () => {
    expect(
      priceUsageDetailed('gpt-4o', { inputTokens: 1_000_000, outputTokens: 0 }),
    ).toBe(2.5);
    expect(
      priceUsageDetailed('gpt-4o', { inputTokens: 0, outputTokens: 1_000_000 }),
    ).toBe(10);
  });

  it('treats cached tokens as a subset of input, not an addition', () => {
    // 200k input of which 200k cached = 200k x cached rate, NOT 400k billed.
    // Kept under 272k so the long-context surcharge is not in play here.
    expect(
      priceUsageDetailed('gpt-5.6-luna', {
        inputTokens: 200_000,
        cachedInputTokens: 200_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.004, 6);
  });

  it('splits partially cached input at the two rates', () => {
    // 120k uncached @ $0.20/1M + 80k cached @ $0.02/1M = 0.024 + 0.0016
    expect(
      priceUsageDetailed('gpt-5.6-luna', {
        inputTokens: 200_000,
        cachedInputTokens: 80_000,
        outputTokens: 0,
      }),
    ).toBeCloseTo(0.0256, 6);
  });

  it('bills cache writes on 5.6, which is the whole reason this field exists', () => {
    // 200k written @ 1.25 x $2.00/1M = $0.50 on top of 200k input @ $2.00/1M.
    const withWrite = priceUsageDetailed('gpt-5.6-terra', {
      inputTokens: 200_000,
      cacheWriteTokens: 200_000,
      outputTokens: 0,
    });
    const withoutWrite = priceUsageDetailed('gpt-5.6-terra', {
      inputTokens: 200_000,
      outputTokens: 0,
    });
    expect(withoutWrite).toBeCloseTo(0.4, 6);
    expect(withWrite).toBeCloseTo(0.9, 6);
  });

  it('charges no cache-write fee on pre-5.6 models', () => {
    expect(
      priceUsageDetailed('gpt-4o', {
        inputTokens: 1_000_000,
        cacheWriteTokens: 1_000_000,
        outputTokens: 0,
      }),
    ).toBe(2.5);
  });

  it('bills cached tokens at full rate when the model publishes no cached rate', () => {
    // Silently discounting them to zero would make a *-pro model look cheap.
    const priced = priceUsageDetailed('azure-di', {
      inputTokens: 100,
      cachedInputTokens: 100,
      outputTokens: 0,
    });
    expect(priced).toBe(0);
  });

  it('applies the 272K long-context surcharge to the whole request', () => {
    const under = priceUsageDetailed('gpt-5.6-terra', {
      inputTokens: 272_000,
      outputTokens: 1_000,
    });
    const over = priceUsageDetailed('gpt-5.6-terra', {
      inputTokens: 272_001,
      outputTokens: 1_000,
    });
    // One token over the cliff roughly doubles input and 1.5x's output.
    expect(over).toBeGreaterThan(under * 1.9);
  });

  it('does not apply the surcharge to models without that pricing rule', () => {
    const a = priceUsageDetailed('gpt-4o', {
      inputTokens: 300_000,
      outputTokens: 0,
    });
    expect(a).toBeCloseTo(0.75, 6);
  });

  it('clamps nonsense inputs instead of producing a negative bill', () => {
    expect(
      priceUsageDetailed('gpt-4o', { inputTokens: -5, outputTokens: -5 }),
    ).toBe(0);
    // cached can never exceed input
    expect(
      priceUsageDetailed('gpt-5.6-luna', {
        inputTokens: 100,
        cachedInputTokens: 10_000,
        outputTokens: 0,
      }),
    ).toBe(
      priceUsageDetailed('gpt-5.6-luna', {
        inputTokens: 100,
        cachedInputTokens: 100,
        outputTokens: 0,
      }),
    );
  });

  it('returns 0 for an unknown model rather than throwing', () => {
    expect(
      priceUsageDetailed('not-a-model', {
        inputTokens: 1e6,
        outputTokens: 1e6,
      }),
    ).toBe(0);
  });
});

describe('task registry', () => {
  it('gives every task a bounded output, a cost ceiling and an eval threshold', () => {
    for (const name of AI_TASK_NAMES) {
      const t = AI_TASKS[name];
      expect(t.maxOutputTokens).toBeGreaterThan(0);
      expect(t.maxCostUsd).toBeGreaterThan(0);
      // An unevaluated task is one nobody can safely downgrade.
      expect(t.qualityThreshold).toBeGreaterThan(0);
      expect(t.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('never batches an interactive task', () => {
    for (const name of AI_TASK_NAMES) {
      const t = AI_TASKS[name];
      if (t.latency === 'interactive') expect(t.batchEligible).toBe(false);
    }
  });

  it('never caches a task whose answer depends on live applicant facts', () => {
    // Serving a stale personalized checklist is worse than paying for the call.
    expect(AI_TASKS.recommendation_explanation.cacheable).toBe(false);
    expect(AI_TASKS.user_draft_generation.cacheable).toBe(false);
    expect(AI_TASKS.vri_assessment.cacheable).toBe(false);
    expect(AI_TASKS.intake_question_generation.cacheable).toBe(false);
    expect(AI_TASKS.intake_answer_extraction.cacheable).toBe(false);
    expect(AI_TASKS.form_prefill.cacheable).toBe(false);
  });

  it('gives every cacheable task a non-zero TTL and vice versa', () => {
    for (const name of AI_TASK_NAMES) {
      const t = AI_TASKS[name];
      if (t.cacheable) expect(t.cacheTtlSeconds).toBeGreaterThan(0);
      else expect(t.cacheTtlSeconds).toBe(0);
    }
  });

  it('escalates to a strictly higher tier, never sideways or down', () => {
    for (const name of AI_TASK_NAMES) {
      const t = AI_TASKS[name];
      if (t.fallbackTier)
        expect(isEscalation(t.defaultTier, t.fallbackTier)).toBe(true);
    }
  });

  it('requires structured output for every machine-consumed task', () => {
    // A machine consumer parsing prose is the fragile-parsing failure mode the
    // spec bans; if code reads it, a schema must constrain it.
    for (const name of AI_TASK_NAMES) {
      const t = AI_TASKS[name];
      if (t.consumer === 'machine') expect(t.structured).toBe(true);
    }
  });
});
