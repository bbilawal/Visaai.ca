import { AiService } from './ai.service';
import type { AiUsageMeter } from './ai-usage.meter';
import { AnalyticsEventBus } from '../../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../../analytics/events/catalog';
// ARCH-003: AiService now depends on the AiTelemetrySink port, not on the
// analytics bus. Wiring the real adapter here keeps these assertions on real
// AnalyticsEvent shapes end to end, and additionally covers the adapter.
import { AnalyticsAiTelemetryAdapter } from '../../analytics/adapters/ai-telemetry.adapter';

/** Config stub: no real provider keys — the chain is replaced by a fake below. */
function makeConfig() {
  return {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConstructorParameters<typeof AiService>[0];
}

function makeMeter(overrides: Partial<AiUsageMeter> = {}): AiUsageMeter {
  return {
    record: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AiUsageMeter;
}

describe('AiService.completeJSON — analytics emits', () => {
  it('emits ai.request before the provider call and ai.completed after success, with token usage', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const meter = makeMeter();
    const service = new AiService(
      makeConfig(),
      meter,
      new AnalyticsAiTelemetryAdapter(analytics),
    );

    // No API key is configured in makeConfig(), so the constructor builds an
    // empty chain. Swap in a fake provider (network boundary) the same way a
    // DB adapter would be faked — completeJSON's retry/fallback/analytics
    // logic is real; only the actual OpenAI HTTP call is stubbed.
    const fakeProvider = {
      name: 'openai',
      available: true,
      completeJSON: jest.fn().mockResolvedValue({
        content: '{"ok":true}',
        usage: { model: 'gpt-4o', inputTokens: 10, outputTokens: 20 },
      }),
    };
    (service as unknown as { chain: unknown[] }).chain = [fakeProvider];

    const content = await service.completeJSON({
      user: 'hello',
      meta: { operation: 'narrative', userId: 'u-1', applicationId: 'app-1' },
    });

    expect(content).toBe('{"ok":true}');
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      name: 'ai.request',
      user_id: 'u-1',
      application_id: 'app-1',
      props: { provider: 'openai', operation: 'narrative' },
    });
    expect(events[1]).toMatchObject({
      name: 'ai.completed',
      user_id: 'u-1',
      application_id: 'app-1',
      props: {
        provider: 'openai',
        model: 'gpt-4o',
        input_tokens: 10,
        output_tokens: 20,
      },
    });
    expect(meter.record).toHaveBeenCalled();
  });

  it('emits ai.completed with null token fields when no usage is returned', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const service = new AiService(
      makeConfig(),
      makeMeter(),
      new AnalyticsAiTelemetryAdapter(analytics),
    );
    const fakeProvider = {
      name: 'openai',
      available: true,
      completeJSON: jest.fn().mockResolvedValue({ content: '{}' }), // no usage
    };
    (service as unknown as { chain: unknown[] }).chain = [fakeProvider];

    await service.completeJSON({ user: 'hi' });

    const completed = events.find((e) => e.name === 'ai.completed');
    expect(completed).toMatchObject({
      props: {
        provider: 'openai',
        model: null,
        input_tokens: null,
        output_tokens: null,
      },
    });
  });

  it('does not throw when the analytics bus is omitted (Optional-safety)', async () => {
    const service = new AiService(makeConfig(), makeMeter());
    const fakeProvider = {
      name: 'openai',
      available: true,
      completeJSON: jest.fn().mockResolvedValue({ content: '{}' }),
    };
    (service as unknown as { chain: unknown[] }).chain = [fakeProvider];

    await expect(service.completeJSON({ user: 'hi' })).resolves.toBe('{}');
  });
});
