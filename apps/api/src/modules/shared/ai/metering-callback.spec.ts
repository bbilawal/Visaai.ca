import { extractTokens, makeMeteringCallback } from './metering-callback';
import type { AiUsageMeter } from './ai-usage.meter';

describe('extractTokens', () => {
  it('reads the OpenAI classic llmOutput.tokenUsage shape', () => {
    expect(
      extractTokens({
        llmOutput: { tokenUsage: { promptTokens: 120, completionTokens: 42 } },
      }),
    ).toEqual({ input: 120, output: 42, cachedInput: 0, cacheWrite: 0 });
  });

  it('reads the v1 usage_metadata on the generation message', () => {
    const output = {
      generations: [
        [
          {
            message: { usage_metadata: { input_tokens: 7, output_tokens: 3 } },
          },
        ],
      ],
    };
    expect(extractTokens(output)).toEqual({
      input: 7,
      output: 3,
      cachedInput: 0,
      cacheWrite: 0,
    });
  });

  it('returns zeros when no usage is present', () => {
    const zero = { input: 0, output: 0, cachedInput: 0, cacheWrite: 0 };
    expect(extractTokens({})).toEqual(zero);
    expect(extractTokens(undefined)).toEqual(zero);
  });

  it('reads cached tokens from the Chat Completions details shape', () => {
    expect(
      extractTokens({
        llmOutput: {
          usage: {
            prompt_tokens: 1000,
            completion_tokens: 50,
            prompt_tokens_details: { cached_tokens: 800 },
          },
        },
      }),
    ).toEqual({ input: 1000, output: 50, cachedInput: 800, cacheWrite: 0 });
  });

  it('reads cache writes from the Responses input_tokens_details shape', () => {
    // Without this the GPT-5.6 cache-write charge is invisible, and the cost
    // report understates spend exactly when someone asks whether caching paid.
    expect(
      extractTokens({
        llmOutput: {
          usage: {
            prompt_tokens: 2000,
            completion_tokens: 100,
            input_tokens_details: {
              cached_tokens: 1500,
              cache_write_tokens: 500,
            },
          },
        },
      }),
    ).toEqual({ input: 2000, output: 100, cachedInput: 1500, cacheWrite: 500 });
  });

  it('reads the LangChain usage_metadata cache fields', () => {
    expect(
      extractTokens({
        generations: [
          [
            {
              message: {
                usage_metadata: {
                  input_tokens: 900,
                  output_tokens: 10,
                  input_token_details: { cache_read: 700, cache_creation: 200 },
                },
              },
            },
          ],
        ],
      }),
    ).toEqual({ input: 900, output: 10, cachedInput: 700, cacheWrite: 200 });
  });

  it('treats a provider that reports no cache detail as uncached, not unknown', () => {
    // Zeros price identically to an uncached call, which is the correct
    // degradation for Azure DI and the per-page OCR vendors.
    const t = extractTokens({
      llmOutput: { tokenUsage: { promptTokens: 10, completionTokens: 1 } },
    });
    expect(t.cachedInput).toBe(0);
    expect(t.cacheWrite).toBe(0);
  });
});

describe('makeMeteringCallback', () => {
  function meterMock() {
    return { record: jest.fn(async () => {}) } as unknown as AiUsageMeter;
  }

  it('records priced usage with the operation, model and tokens', () => {
    const meter = meterMock();
    const cb = makeMeteringCallback(
      meter,
      { operation: 'narrative', applicationId: 'app-1' },
      'gpt-4o',
    );
    cb.handleLLMEnd?.(
      {
        llmOutput: { tokenUsage: { promptTokens: 100, completionTokens: 20 } },
      } as never,
      'run-1',
    );
    expect(meter.record).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'narrative',
        applicationId: 'app-1',
        provider: 'openai',
        model: 'gpt-4o',
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
      }),
    );
  });

  it('passes cache token counts through to the meter', () => {
    const meter = meterMock();
    const cb = makeMeteringCallback(
      meter,
      { operation: 'intake' },
      'gpt-5.6-luna',
    );
    cb.handleLLMEnd?.(
      {
        llmOutput: {
          usage: {
            prompt_tokens: 5000,
            completion_tokens: 100,
            prompt_tokens_details: {
              cached_tokens: 4096,
              cache_write_tokens: 904,
            },
          },
        },
      } as never,
      'run-3',
    );
    expect(meter.record).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gpt-5.6-luna',
        inputTokens: 5000,
        cachedInputTokens: 4096,
        cacheWriteTokens: 904,
      }),
    );
  });

  it('does not record a no-op call with zero tokens', () => {
    const meter = meterMock();
    const cb = makeMeteringCallback(meter, { operation: 'vri' }, 'gpt-4o-mini');
    cb.handleLLMEnd?.({ llmOutput: {} } as never, 'run-2');
    expect(meter.record).not.toHaveBeenCalled();
  });
});
