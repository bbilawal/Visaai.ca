import { AnalyticsEventBus } from './analytics-event-bus';
import { makeServerEvent } from './events/catalog';

describe('AnalyticsEventBus', () => {
  it('delivers emitted events to subscribers', () => {
    const bus = new AnalyticsEventBus();
    const seen: string[] = [];
    bus.events$.subscribe((e) => seen.push(e.name));
    bus.emit(makeServerEvent('user.registered', { user_id: 'u1' }));
    expect(seen).toEqual(['user.registered']);
  });

  it('emitSafe delivers the event and never throws to the producer', () => {
    const bus = new AnalyticsEventBus();
    const seen: string[] = [];
    bus.events$.subscribe((e) => seen.push(e.name));
    expect(() =>
      bus.emitSafe(makeServerEvent('user.active', { user_id: 'u1' })),
    ).not.toThrow();
    expect(seen).toEqual(['user.active']);
  });
});
