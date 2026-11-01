import { chatModelForTask } from './model-factory';

/**
 * Pin the wire shape of the reasoning parameter.
 *
 * These tests exist because of a real outage. The factory shipped sending
 *
 *   modelKwargs: { reasoning: { effort: 'none' } }
 *
 * which is the **Responses API** shape. `/v1/chat/completions` — the endpoint
 * LangChain's ChatOpenAI actually calls — rejects it with
 * `400 Unknown parameter: 'reasoning'`. Every AI call in the product routes
 * through this factory, so intake, VRI, narrative, prefill and document field
 * derivation were all failing.
 *
 * Nothing caught it. The unit tests never inspected the constructed model, no
 * test hits the live API, and the eval harness reported the resulting 400s as
 * 0% model accuracy rather than as errors — so the one tool that DID exercise
 * the real endpoint blamed the prompt.
 *
 * A parameter name is exactly the kind of thing a type system cannot help with
 * (`modelKwargs` is deliberately open), so it is pinned here instead.
 */

/** Read back what was actually handed to the OpenAI client. */
const kwargs = (m: unknown): Record<string, unknown> | undefined =>
  (m as { modelKwargs?: Record<string, unknown> }).modelKwargs;

describe('chatModelForTask — reasoning effort wire format', () => {
  it('sends reasoning_effort FLAT, never a nested reasoning object', () => {
    const model = chatModelForTask('document_classification', {
      apiKey: 'sk-test',
    });

    const sent = kwargs(model);
    expect(sent).toBeDefined();
    expect(Object.keys(sent!)).toContain('reasoning_effort');

    // The exact regression: a nested `reasoning` key is a 400 from the API.
    expect(sent).not.toHaveProperty('reasoning');
  });

  it('carries the tier’s configured effort as the value', () => {
    // nano and small differ ONLY by effort, so the value has to survive.
    const nano = chatModelForTask('document_classification', {
      apiKey: 'sk-test',
      tier: 'nano',
    });
    const balanced = chatModelForTask('document_classification', {
      apiKey: 'sk-test',
      tier: 'balanced',
    });

    expect(kwargs(nano)!.reasoning_effort).toBe('none');
    expect(kwargs(balanced)!.reasoning_effort).toBeDefined();
    expect(kwargs(balanced)!.reasoning_effort).not.toBe('none');
  });

  it('omits the parameter entirely for a non-GPT-5 model', () => {
    // An operator pinning a tier back to gpt-4o must get a working call
    // rather than a 400 — gpt-4o does not accept a reasoning parameter at all.
    const model = chatModelForTask('document_classification', {
      apiKey: 'sk-test',
      overrides: { nano: 'gpt-4o-mini' },
      tier: 'nano',
    });

    const sent = kwargs(model);
    expect(sent?.reasoning_effort).toBeUndefined();
    expect(sent).not.toHaveProperty('reasoning');
  });

  it('takes maxTokens and timeout from the task registry, not a literal', () => {
    const model = chatModelForTask('document_classification', {
      apiKey: 'sk-test',
    }) as unknown as { maxTokens?: number; timeout?: number };

    expect(model.maxTokens).toBeGreaterThan(0);
    expect(model.timeout).toBeGreaterThan(0);
  });
});
