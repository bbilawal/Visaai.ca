import { ConfigService } from '@nestjs/config';
import { IntakeService } from './intake.service';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { AiUsageMeter } from '../shared/ai/ai-usage.meter';
import { CheckpointService } from '../shared/langgraph/checkpoint.service';
import { AssignmentEventBus } from '../event-bus/assignment-event-bus';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

/**
 * Minimal Supabase query-builder stub for the createApplication insert chain
 * (see intake.service.spec.ts for the template this is adapted from).
 */
function makeDb() {
  const db = {
    from() {
      return {
        insert() {
          return {
            select() {
              return {
                single() {
                  return Promise.resolve({
                    data: { id: 'app-1' },
                    error: null,
                  });
                },
              };
            },
          };
        },
      };
    },
  };

  return db as any;
}

function makeService(analytics?: AnalyticsEventBus) {
  const config = {
    get: jest.fn().mockReturnValue('test-openai-key'),
  } as unknown as ConfigService;
  const bus = { emit: jest.fn() };
  return new IntakeService(
    {} as SupabaseService,
    {} as CheckpointService,
    config,
    bus as unknown as AssignmentEventBus,
    { record: async () => {} } as unknown as AiUsageMeter,
    analytics,
  );
}

describe('IntakeService.createApplication — analytics emission', () => {
  it('emits application.created with allowlisted, non-PII props when an application is created', async () => {
    const bus = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    bus.events$.subscribe((e) => seen.push(e));
    const service = makeService(bus);

    const id = await service.createApplication(makeDb(), 'user-1', {
      country: 'ca',
      state: 'ON',
    });

    expect(id).toBe('app-1');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      name: 'application.created',
      source: 'server',
      user_id: 'user-1',
      application_id: 'app-1',
      props: { country: 'CA', state: 'ON', framework_id: null },
    });
  });

  it('never throws when constructed without an analytics bus (Optional, additive)', async () => {
    const service = makeService(undefined);
    await expect(
      service.createApplication(makeDb(), 'user-1', { country: 'ca' }),
    ).resolves.toBe('app-1');
  });
});
