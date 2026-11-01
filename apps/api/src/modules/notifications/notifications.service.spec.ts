/**
 * TDD spec for NotificationsService.emit()
 *
 * RED phase: written before the service implementation.
 * GREEN phase: passes once the service is implemented.
 */
import { Logger } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { NotificationEvent } from './events/catalog';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

// ---------------------------------------------------------------------------
// Chainable Supabase admin mock
// ---------------------------------------------------------------------------

function makeSingle(result: { data: unknown; error: unknown }) {
  return jest.fn().mockResolvedValue(result);
}

function makeAdminMock(
  notifInsertResult: { data: unknown; error: unknown } = {
    data: { id: 'notif-uuid-1' },
    error: null,
  },
) {
  const single = makeSingle(notifInsertResult);
  const select = jest.fn().mockReturnValue({ single });
  const insert = jest.fn().mockReturnValue({ select });
  const update = jest
    .fn()
    .mockReturnValue({ eq: jest.fn().mockResolvedValue({ error: null }) });
  const from = jest.fn((table: string) => {
    if (table === 'notifications') return { insert };
    return { update };
  });
  return { from, _single: single, _insert: insert, _select: select };
}

// ---------------------------------------------------------------------------
// Shared event fixture
// ---------------------------------------------------------------------------

const event: NotificationEvent = {
  type: 'consultant.assigned',
  userId: 'user-abc',
  applicationId: 'app-xyz',
  data: { consultantName: 'Alice' },
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('NotificationsService.emit()', () => {
  let service: NotificationsService;
  let adminMock: ReturnType<typeof makeAdminMock>;
  let supabase: { admin: typeof adminMock };
  let deliveries: {
    record: jest.Mock;
    attachNotification: jest.Mock;
    markStatus: jest.Mock;
    deleteById: jest.Mock;
  };
  let prefRepo: { getForUser: jest.Mock };
  let queue: { add: jest.Mock };
  let messagingBus: { emit: jest.Mock };

  beforeEach(() => {
    // Silence Logger output during tests
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    adminMock = makeAdminMock();
    supabase = { admin: adminMock };

    deliveries = {
      record: jest.fn().mockResolvedValue({ created: true, id: 'del-uuid-1' }),
      attachNotification: jest.fn().mockResolvedValue(undefined),
      markStatus: jest.fn().mockResolvedValue(undefined),
      deleteById: jest.fn().mockResolvedValue(undefined),
    };

    prefRepo = {
      getForUser: jest
        .fn()
        .mockResolvedValue({ email_enabled: false, push_enabled: true }),
    };

    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    messagingBus = { emit: jest.fn() };

    service = new NotificationsService(
      supabase as any,
      deliveries,
      prefRepo as any,
      queue as any,
      { events$: { subscribe: jest.fn() }, emit: jest.fn() } as any,
      {
        render: jest.fn().mockResolvedValue({
          category: 'assignment',
          title: 'T',
          body: 'B',
          link: '/applications/app-xyz',
        }),
      } as any,
      messagingBus as any,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── T1: happy-path in-app ──────────────────────────────────────────────────
  it('records an in_app delivery and inserts a notifications row', async () => {
    await service.emit(event);

    // delivery.record gate is written as 'queued' (intent), not 'sent'
    expect(deliveries.record).toHaveBeenCalledWith(
      adminMock,
      expect.objectContaining({
        channel: 'in_app',
        status: 'queued',
        userId: 'user-abc',
      }),
    );
    // promoted to 'sent' only after the feed row is durable
    expect(deliveries.markStatus).toHaveBeenCalledWith(
      adminMock,
      'del-uuid-1',
      'sent',
    );

    // notifications insert was called
    expect(adminMock.from).toHaveBeenCalledWith('notifications');
    expect(adminMock._insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'user-abc',
        type: 'consultant.assigned',
        category: 'assignment',
      }),
    );

    // attachNotification links the delivery to the new notifications row
    expect(deliveries.attachNotification).toHaveBeenCalledWith(
      adminMock,
      'del-uuid-1',
      'notif-uuid-1',
    );
  });

  // ── analytics: mirror the confirmed in-app delivery as notification.sent ───
  it('emits a notification.sent analytics event once the in-app delivery is confirmed sent', async () => {
    const analytics = new AnalyticsEventBus();
    const seen: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => seen.push(e));

    const analyticsService = new NotificationsService(
      supabase as any,
      deliveries,
      prefRepo as any,
      queue as any,
      { events$: { subscribe: jest.fn() }, emit: jest.fn() } as any,
      {
        render: jest.fn().mockResolvedValue({
          category: 'assignment',
          title: 'T',
          body: 'B',
          link: '/applications/app-xyz',
        }),
      } as any,
      messagingBus as any,
      analytics,
    );

    await analyticsService.emit(event);

    expect(seen).toHaveLength(1);
    expect(seen[0].name).toBe('notification.sent');
    expect(seen[0].user_id).toBe('user-abc');
    expect(seen[0].props).toEqual({
      channel: 'in_app',
      category: 'assignment',
    });
  });

  // ── realtime: publish a notification stream event after the feed insert ────
  it('publishes a notification stream event to the messaging bus for the recipient', async () => {
    await service.emit(event);

    expect(messagingBus.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'notification',
        recipient_ids: ['user-abc'],
      }),
    );
  });

  it('does not publish a stream event when the delivery is a dedupe no-op', async () => {
    deliveries.record.mockResolvedValueOnce({
      created: false,
      id: 'del-existing',
    });
    await service.emit(event);
    expect(messagingBus.emit).not.toHaveBeenCalled();
  });

  // ── T2: dedupe idempotency gate ────────────────────────────────────────────
  it('skips notifications insert and queue adds when in_app record returns {created:false}', async () => {
    deliveries.record.mockResolvedValueOnce({
      created: false,
      id: 'del-existing',
    });

    await service.emit(event);

    // No notifications row inserted
    expect(adminMock.from).not.toHaveBeenCalledWith('notifications');
    // No channel queue jobs
    expect(queue.add).not.toHaveBeenCalled();
  });

  // ── T3: pref-gated channel enqueue ────────────────────────────────────────
  it('enqueues only web_push when email_enabled:false and push_enabled:true', async () => {
    prefRepo.getForUser.mockResolvedValue({
      email_enabled: false,
      push_enabled: true,
    });
    // Make second record() call (for web_push channel) return created:true
    deliveries.record
      .mockResolvedValueOnce({ created: true, id: 'del-in-app' }) // in_app gate
      .mockResolvedValueOnce({ created: true, id: 'del-push' }); // web_push

    await service.emit(event);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'web_push',
      expect.objectContaining({ userId: 'user-abc' }),
      expect.objectContaining({ attempts: 3 }),
    );
    expect(queue.add).not.toHaveBeenCalledWith(
      'email',
      expect.anything(),
      expect.anything(),
    );
  });

  it('enqueues both email and web_push when both prefs enabled', async () => {
    prefRepo.getForUser.mockResolvedValue({
      email_enabled: true,
      push_enabled: true,
    });
    deliveries.record
      .mockResolvedValueOnce({ created: true, id: 'del-in-app' })
      .mockResolvedValueOnce({ created: true, id: 'del-email' })
      .mockResolvedValueOnce({ created: true, id: 'del-push' });

    await service.emit(event);

    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith(
      'email',
      expect.any(Object),
      expect.any(Object),
    );
    expect(queue.add).toHaveBeenCalledWith(
      'web_push',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('enqueues an sms job when sms_enabled is true', async () => {
    prefRepo.getForUser.mockResolvedValue({
      email_enabled: false,
      push_enabled: false,
      sms_enabled: true,
    });
    deliveries.record
      .mockResolvedValueOnce({ created: true, id: 'del-in-app' })
      .mockResolvedValueOnce({ created: true, id: 'del-sms' });

    await service.emit(event);

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      'sms',
      expect.any(Object),
      expect.any(Object),
    );
  });

  it('mutes email + push when the event category is opted out (in-app still delivered)', async () => {
    prefRepo.getForUser.mockResolvedValue({
      email_enabled: true,
      push_enabled: true,
      categories: { assignment: false },
    });
    await service.emit(event); // event category = 'assignment'
    expect(adminMock.from).toHaveBeenCalledWith('notifications'); // in-app still inserted
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('delays email/push during quiet hours instead of dropping them', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-01T23:00:00Z'));
    prefRepo.getForUser.mockResolvedValue({
      email_enabled: true,
      push_enabled: true,
      categories: {},
      quiet_hours_start: 22,
      quiet_hours_end: 7,
      timezone: null,
    });
    deliveries.record
      .mockResolvedValueOnce({ created: true, id: 'del-in-app' })
      .mockResolvedValueOnce({ created: true, id: 'del-email' })
      .mockResolvedValueOnce({ created: true, id: 'del-push' });

    await service.emit(event);

    const emailCall = queue.add.mock.calls.find(
      (c: unknown[]) => c[0] === 'email',
    );
    expect(emailCall).toBeDefined();
    expect((emailCall as unknown[])[2]).toEqual(
      expect.objectContaining({ delay: expect.any(Number) }),
    );
    expect(
      ((emailCall as unknown[])[2] as { delay: number }).delay,
    ).toBeGreaterThan(0);
    jest.useRealTimers();
  });

  // ── T4: caller isolation — emit() must NEVER throw ────────────────────────
  it('resolves without throwing when the notifications insert fails, and releases the dedupe lock', async () => {
    const failAdmin = makeAdminMock({
      data: null,
      error: { message: 'DB is down', code: '500' },
    });
    supabase.admin = failAdmin;
    service = new NotificationsService(
      supabase as any,
      deliveries,
      prefRepo as any,
      queue as any,
      { events$: { subscribe: jest.fn() }, emit: jest.fn() } as any,
      {
        render: jest.fn().mockResolvedValue({
          category: 'assignment',
          title: 'T',
          body: 'B',
          link: '/x',
        }),
      } as any,
      messagingBus as any,
    );

    await expect(service.emit(event)).resolves.toBeUndefined();
    // gate lock released so a later emit can retry (no permanent silent loss)
    expect(deliveries.deleteById).toHaveBeenCalledWith(failAdmin, 'del-uuid-1');
    // feed insert failed → no realtime signal published
    expect(messagingBus.emit).not.toHaveBeenCalled();
  });

  it('resolves without throwing when getForUser rejects (isolation)', async () => {
    prefRepo.getForUser.mockRejectedValue(new Error('prefs unreachable'));
    await expect(service.emit(event)).resolves.toBeUndefined();
  });

  it('resolves without throwing when a channel enqueue throws', async () => {
    prefRepo.getForUser.mockResolvedValue({
      email_enabled: false,
      push_enabled: true,
    });
    deliveries.record
      .mockResolvedValueOnce({ created: true, id: 'del-in-app' })
      .mockResolvedValueOnce({ created: true, id: 'del-push' });
    queue.add.mockRejectedValueOnce(new Error('Redis unreachable'));

    await expect(service.emit(event)).resolves.toBeUndefined();
  });

  // ── T5: dedupe skip for channel (not just in-app) ─────────────────────────
  it('skips channel queue.add when channel record returns {created:false}', async () => {
    prefRepo.getForUser.mockResolvedValue({
      email_enabled: false,
      push_enabled: true,
    });
    deliveries.record
      .mockResolvedValueOnce({ created: true, id: 'del-in-app' })
      .mockResolvedValueOnce({ created: false, id: 'del-existing-push' }); // push already queued

    await service.emit(event);

    expect(queue.add).not.toHaveBeenCalled();
  });
});
