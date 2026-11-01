import { makeServerEvent, parseClientEvent, AnalyticsEvent } from './catalog';

describe('catalog', () => {
  it('makeServerEvent fills envelope defaults', () => {
    const e = makeServerEvent('application.created', {
      user_id: 'u1',
      application_id: 'a1',
      props: { visa_type: 'visitor' },
    });
    expect(e.name).toBe('application.created');
    expect(e.source).toBe('server');
    expect(e.schema_version).toBe(1);
    expect(e.event_id).toMatch(/[0-9a-f-]{36}/);
    expect(typeof e.occurred_at).toBe('string');
    expect(e.props.visa_type).toBe('visitor');
    expect(e.anonymous_id).toBeNull();
  });

  it('parseClientEvent accepts a valid client event', () => {
    const raw = {
      event_id: '11111111-1111-1111-1111-111111111111',
      name: 'page.viewed',
      occurred_at: new Date().toISOString(),
      anonymous_id: 'anon-1',
      session_id: 's1',
      props: { path: '/pricing' },
    };
    const e = parseClientEvent(raw) as AnalyticsEvent;
    expect(e).not.toBeNull();
    expect(e.source).toBe('client');
    expect(e.name).toBe('page.viewed');
    expect(e.user_id).toBeNull();
  });

  it('parseClientEvent rejects an unknown event name', () => {
    expect(
      parseClientEvent({
        name: 'evil.event',
        event_id: 'x',
        occurred_at: 'now',
      }),
    ).toBeNull();
  });

  it('parseClientEvent rejects a server-only event name from a client', () => {
    expect(
      parseClientEvent({
        event_id: '22222222-2222-2222-2222-222222222222',
        name: 'payment.succeeded',
        occurred_at: new Date().toISOString(),
      }),
    ).toBeNull();
  });
});
