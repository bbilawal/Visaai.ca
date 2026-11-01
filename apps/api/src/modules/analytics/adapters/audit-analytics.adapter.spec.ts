import { AuditAnalyticsAdapter } from './audit-analytics.adapter';
import { AnalyticsEventBus } from '../analytics-event-bus';

describe('AuditAnalyticsAdapter', () => {
  it('mirror emits an audit.mirrored analytics event', () => {
    const bus = new AnalyticsEventBus();
    const seen: any[] = [];
    bus.events$.subscribe((e) => seen.push(e));

    new AuditAnalyticsAdapter(bus).mirror('app-1', 'execution.completed');

    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('audit.mirrored');
    expect(seen[0].application_id).toBe('app-1');
    expect(seen[0].props.audit_type).toBe('execution.completed');
  });

  it('is a silent no-op when no bus is injected', () => {
    expect(() =>
      new AuditAnalyticsAdapter().mirror('app-2', 'EXECUTION_STARTED'),
    ).not.toThrow();
  });
});
