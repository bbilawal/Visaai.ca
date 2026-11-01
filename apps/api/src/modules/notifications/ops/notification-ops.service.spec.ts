import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationOpsService } from './notification-ops.service';

/** Chainable supabase builder that resolves `result` when awaited / on maybeSingle. */
function chain(result: unknown) {
  const p: Record<string, unknown> = {};
  const self = () => p;
  Object.assign(p, {
    select: self,
    gte: self,
    eq: self,
    in: self,
    order: self,
    lt: self,
    limit: self,
    range: self,
    update: self,
    maybeSingle: () => Promise.resolve(result),
    then: (res: (v: unknown) => void) => res(result),
  });
  return p;
}

function svc(
  fromImpl: jest.Mock,
  queue: { getJobCounts?: jest.Mock; add?: jest.Mock } = {},
  extra: { listUsers?: jest.Mock; bus?: { emit: jest.Mock } } = {},
) {
  const supabase = {
    admin: {
      from: fromImpl,
      auth: { admin: { listUsers: extra.listUsers ?? jest.fn() } },
    },
  } as never;
  const q = {
    getJobCounts: jest.fn(),
    add: jest.fn().mockResolvedValue({ id: 'j' }),
    ...queue,
  } as never;
  const bus = (extra.bus ?? { emit: jest.fn() }) as never;
  return new NotificationOpsService(supabase, q, bus);
}

describe('NotificationOpsService', () => {
  describe('coerceRange', () => {
    it('coerces to a valid range (default 7d)', () => {
      expect(NotificationOpsService.coerceRange('24h')).toBe('24h');
      expect(NotificationOpsService.coerceRange('30d')).toBe('30d');
      expect(NotificationOpsService.coerceRange('bogus')).toBe('7d');
    });
  });

  describe('metrics', () => {
    it('assembles counts + queue into the read-model', async () => {
      const from = jest.fn(() => chain({ count: 1, error: null }));
      const s = svc(from, {
        getJobCounts: jest.fn().mockResolvedValue({
          waiting: 2,
          active: 1,
          completed: 9,
          failed: 3,
          delayed: 0,
        }),
      });
      const m = await s.metrics('7d');
      // 5 status counts, each mocked to 1 → total 5
      expect(m.total).toBe(5);
      expect(m.byStatus.sent).toBe(1);
      expect(m.byChannel.email).toBe(1);
      expect(m.queue.waiting).toBe(2);
      expect(m.queue.failed).toBe(3);
    });
  });

  describe('failed', () => {
    it('maps rows and computes nextCursor', async () => {
      const rows = [
        {
          id: 'd1',
          event_type: 'payment.received',
          channel: 'email',
          status: 'dead',
          attempts: 3,
          error: 'boom',
          user_id: 'u1',
          created_at: '2026-07-02T00:00:00Z',
        },
      ];
      const from = jest.fn(() => chain({ data: rows, count: 1, error: null }));
      const page = await svc(from).failed(null, 25);
      expect(page.rows[0]).toEqual(
        expect.objectContaining({
          id: 'd1',
          eventType: 'payment.received',
          userId: 'u1',
          error: 'boom',
        }),
      );
      expect(page.total).toBe(1);
      expect(page.nextCursor).toBeNull(); // 1 row ≤ limit
    });
  });

  describe('checkDlqThreshold', () => {
    const OLD_ENV = process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD;
    afterEach(() => {
      if (OLD_ENV === undefined)
        delete process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD;
      else process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD = OLD_ENV;
    });

    /**
     * OPS-001. Recipients resolved from `app_metadata.role` alone, so an admin
     * created through the RBAC tables never received the dead-letter alarm —
     * and on production nobody carries that metadata key at all.
     */
    it('reaches an admin who exists only as an RBAC platform_admin grant', async () => {
      process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD = '25';
      const from = jest.fn((table: string) =>
        table === 'user_roles'
          ? chain({
              data: [{ user_id: 'rbac-1', roles: { key: 'platform_admin' } }],
              error: null,
            })
          : chain({ count: 30, error: null }),
      );
      const listUsers = jest
        .fn()
        // GoTrue pages: everyone on page 1, page 2 empty.
        .mockImplementation(async ({ page }: { page: number }) =>
          page === 1
            ? {
                data: {
                  users: [
                    { id: 'rbac-1', email: 'rbac@x.com', app_metadata: {} },
                    { id: 'plain-1', email: 'plain@x.com', app_metadata: {} },
                  ],
                },
                error: null,
              }
            : { data: { users: [] }, error: null },
        );
      const bus = { emit: jest.fn() };

      const res = await svc(from, {}, { listUsers, bus }).checkDlqThreshold(
        new Date('2026-07-04T14:00:00Z'),
      );

      expect(res).toEqual({ alerted: true, dead: 30 });
      expect(bus.emit).toHaveBeenCalledTimes(1);
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'rbac-1' }),
      );
    });

    it('emits a window-bucketed admin alert when dead count exceeds the threshold', async () => {
      process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD = '25';
      const from = jest.fn(() => chain({ count: 30, error: null }));
      const listUsers = jest
        .fn()
        // GoTrue pages: everyone on page 1, page 2 empty.
        .mockImplementation(async ({ page }: { page: number }) =>
          page === 1
            ? {
                data: {
                  users: [
                    { id: 'admin-1', app_metadata: { role: 'admin' } },
                    { id: 'user-9', app_metadata: { role: 'user' } },
                  ],
                },
                error: null,
              }
            : { data: { users: [] }, error: null },
        );
      const bus = { emit: jest.fn() };
      const res = await svc(from, {}, { listUsers, bus }).checkDlqThreshold(
        new Date('2026-07-04T14:00:00Z'),
      );

      expect(res).toEqual({ alerted: true, dead: 30 });
      expect(bus.emit).toHaveBeenCalledTimes(1); // only the admin, not the plain user
      expect(bus.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'system.broadcast',
          userId: 'admin-1',
          broadcastId: 'dlq-alert:2026-07-04T14',
          data: expect.objectContaining({
            category: 'system',
            link: '/notification-ops',
          }),
        }),
      );
    });

    it('does not alert when dead count is at or below the threshold', async () => {
      process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD = '25';
      const from = jest.fn(() => chain({ count: 5, error: null }));
      const bus = { emit: jest.fn() };
      const res = await svc(from, {}, { bus }).checkDlqThreshold(
        new Date('2026-07-04T14:00:00Z'),
      );

      expect(res).toEqual({ alerted: false, dead: 5 });
      expect(bus.emit).not.toHaveBeenCalled();
    });
  });

  describe('retry', () => {
    it('rejects an in_app delivery', async () => {
      const from = jest.fn(() =>
        chain({
          data: { id: 'd', channel: 'in_app', status: 'failed' },
          error: null,
        }),
      );
      await expect(svc(from).retry('d')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects a non-failed delivery', async () => {
      const from = jest.fn(() =>
        chain({
          data: { id: 'd', channel: 'email', status: 'sent' },
          error: null,
        }),
      );
      await expect(svc(from).retry('d')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('404s when the delivery is missing', async () => {
      const from = jest.fn(() => chain({ data: null, error: null }));
      await expect(svc(from).retry('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('re-enqueues the channel job and resets status for a failed delivery', async () => {
      const from = jest
        .fn()
        .mockReturnValueOnce(
          chain({
            data: {
              id: 'd',
              notification_id: 'n1',
              user_id: 'u1',
              channel: 'email',
              status: 'dead',
            },
            error: null,
          }),
        ) // load delivery
        .mockReturnValueOnce(
          chain({ data: { title: 'Hi', body: 'B', link: '/x' }, error: null }),
        ) // load notification
        .mockReturnValueOnce(chain({ error: null })); // update status
      const add = jest.fn().mockResolvedValue({ id: 'j' });
      const res = await svc(from, { add }).retry('d');
      expect(res).toEqual({ requeued: true });
      expect(add).toHaveBeenCalledWith(
        'email',
        expect.objectContaining({ deliveryId: 'd', userId: 'u1', title: 'Hi' }),
        expect.objectContaining({ attempts: 3 }),
      );
    });
  });
});

/**
 * A misconfigured threshold must not disable the alarm. `Number('twenty')` is
 * NaN, and `dead > NaN` is false for every possible dead count — so a typo in
 * NOTIFICATION_DLQ_ALERT_THRESHOLD silently turned the dead-letter alert off
 * entirely, which is the one failure mode a watchdog cannot afford.
 */
describe('checkDlqThreshold — a misconfigured threshold', () => {
  const prev = process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD;
  afterEach(() => {
    if (prev === undefined) delete process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD;
    else process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD = prev;
  });

  function alertOn(value: string | undefined, dead: number) {
    if (value === undefined)
      delete process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD;
    else process.env.NOTIFICATION_DLQ_ALERT_THRESHOLD = value;
    const from = jest.fn((table: string) =>
      table === 'user_roles'
        ? chain({ data: [], error: null })
        : chain({ count: dead, error: null }),
    );
    const listUsers = jest
      .fn()
      // GoTrue pages: everyone on page 1, page 2 empty.
      .mockImplementation(async ({ page }: { page: number }) =>
        page === 1
          ? {
              data: {
                users: [{ id: 'admin-1', app_metadata: { role: 'admin' } }],
              },
              error: null,
            }
          : { data: { users: [] }, error: null },
      );
    const bus = { emit: jest.fn() };
    return svc(from, {}, { listUsers, bus }).checkDlqThreshold(
      new Date('2026-07-04T14:00:00Z'),
    );
  }

  it('falls back to the default rather than never firing', async () => {
    await expect(alertOn('twenty', 30)).resolves.toEqual({
      alerted: true,
      dead: 30,
    });
  });

  it('ignores a negative threshold', async () => {
    await expect(alertOn('-5', 30)).resolves.toMatchObject({ alerted: true });
  });

  it('still honours a valid threshold', async () => {
    await expect(alertOn('100', 30)).resolves.toEqual({
      alerted: false,
      dead: 30,
    });
  });
});
