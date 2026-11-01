import { renderEvent, entityIdOf } from './catalog';

describe('renderEvent', () => {
  it('renders consultant.assigned with a deep link and no undefined text', () => {
    const r = renderEvent({
      type: 'consultant.assigned',
      userId: 'u',
      applicationId: 'app1',
      data: { consultantName: 'Sam' },
    });
    expect(r.category).toBe('assignment');
    expect(r.link).toBe('/applications/app1');
    expect(r.title.length).toBeGreaterThan(0);
    expect(`${r.title} ${r.body}`).not.toMatch(/undefined|null/);
  });
  it('degrades gracefully when optional data is missing', () => {
    const r = renderEvent({
      type: 'consultant.assigned',
      userId: 'u',
      applicationId: 'app1',
    });
    expect(`${r.title} ${r.body}`).not.toMatch(/undefined/);
  });
  it('application.status_changed reflects the status and links to the app', () => {
    const r = renderEvent({
      type: 'application.status_changed',
      userId: 'u',
      applicationId: 'a2',
      data: { status: 'submitted' },
    });
    expect(r.category).toBe('application');
    expect(r.body.toLowerCase()).toContain('submitted');
    expect(r.link).toBe('/applications/a2');
  });
  it('entityIdOf returns the stable entity id per event', () => {
    expect(
      entityIdOf({ type: 'payment.received', userId: 'u', paymentId: 'p9' }),
    ).toBe('p9');
  });

  it('entityIdOf makes each application status transition distinct (dedupe per status)', () => {
    const submitted = entityIdOf({
      type: 'application.status_changed',
      userId: 'u',
      applicationId: 'app1',
      data: { status: 'submitted' },
    });
    const decided = entityIdOf({
      type: 'application.status_changed',
      userId: 'u',
      applicationId: 'app1',
      data: { status: 'decided' },
    });
    // Same application, different status → distinct dedupe keys so the second
    // transition is NOT silently swallowed by the first's in-app dedupe gate.
    expect(submitted).not.toBe(decided);
    expect(submitted).toContain('app1');
    expect(submitted).toContain('submitted');
  });

  it('system.broadcast renders the admin-authored copy verbatim', () => {
    const r = renderEvent({
      type: 'system.broadcast',
      userId: 'u',
      broadcastId: 'b1',
      data: {
        title: 'Maintenance',
        body: 'Down 2am UTC',
        link: '/status',
        category: 'system',
      },
    });
    expect(r).toEqual({
      category: 'system',
      title: 'Maintenance',
      body: 'Down 2am UTC',
      link: '/status',
    });
  });

  it('entityIdOf for a broadcast returns the broadcastId (per-broadcast dedupe)', () => {
    expect(
      entityIdOf({
        type: 'system.broadcast',
        userId: 'u',
        broadcastId: 'b1',
        data: { title: 't', body: 'b', link: '/', category: 'system' },
      }),
    ).toBe('b1');
  });
});
