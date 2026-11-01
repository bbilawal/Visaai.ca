/**
 * TDD spec for NotificationFeedService
 *
 * Key invariants verified:
 *  1. list() maps DB rows to NotificationFeedItem (camelCase, data ?? {})
 *  2. list() slices at limit and computes nextCursor from the extra row
 *  3. list() returns nextCursor=null when fewer than limit+1 rows returned
 *  4. unreadCount() returns count (and 0 when count is null)
 *  5. markRead() enforces own-rows-only via BOTH .eq('id') AND .eq('user_id')
 *  6. markAllRead() passes only user_id filter (bulk update)
 */
import { NotificationFeedService } from './notification-feed.service';

// ---------------------------------------------------------------------------
// Chainable Supabase builder helpers
// ---------------------------------------------------------------------------

/**
 * A builder whose every method returns itself and that is thenable
 * (resolves to `result` when awaited).
 *
 * Individual method mocks are exposed as `jest.Mock` so callers can assert
 * calls if needed.
 */
function makeFluentBuilder(result: unknown) {
  const builder: Record<string, unknown> = {};

  for (const method of [
    'select',
    'eq',
    'order',
    'limit',
    'lt',
    'is',
    'update',
  ]) {
    builder[method] = jest.fn().mockReturnValue(builder);
  }

  // Make the builder awaitable
  builder['then'] = (
    onfulfilled: (v: unknown) => unknown,
    onrejected?: (e: unknown) => unknown,
  ) => Promise.resolve(result).then(onfulfilled, onrejected);

  return builder as Record<string, jest.Mock> & { then: unknown };
}

/** Builder specifically for the count (head:true) query. */
function makeCountBuilder(result: { count: number | null; error: unknown }) {
  return makeFluentBuilder(result);
}

/** Builder for the main row-select query. */
function makeListBuilder(result: { data: unknown; error: unknown }) {
  return makeFluentBuilder(result);
}

// ---------------------------------------------------------------------------
// Row fixture
// ---------------------------------------------------------------------------

function makeRow(i: number) {
  return {
    id: `id-${i}`,
    type: 'consultant.assigned',
    category: 'assignment',
    title: `Title ${i}`,
    body: `Body ${i}`,
    link: `/applications/app-${i}`,
    data: { consultantName: 'Alice' },
    read_at: i === 0 ? null : '2026-01-01T00:00:00Z',
    created_at: `2026-01-${String(30 - i).padStart(2, '0')}T00:00:00Z`,
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('NotificationFeedService', () => {
  let service: NotificationFeedService;
  let fromMock: jest.Mock;

  let forUserMock: jest.Mock;

  beforeEach(() => {
    fromMock = jest.fn();
    const client = { from: fromMock };
    forUserMock = jest.fn(() => client);
    // admin present but reads/mark-reads must use forUser(token) (RLS backstop)
    const supabaseMock = { admin: { from: jest.fn() }, forUser: forUserMock };
    service = new NotificationFeedService(supabaseMock as never);
  });

  it('reads the feed with the caller-scoped RLS client, not service-role admin', async () => {
    fromMock
      .mockReturnValueOnce(makeListBuilder({ data: [makeRow(0)], error: null }))
      .mockReturnValueOnce(makeCountBuilder({ count: 1, error: null }));

    await service.list('jwt-token', 'user-1', null, 20);

    expect(forUserMock).toHaveBeenCalledWith('jwt-token');
  });

  // ── list() ─────────────────────────────────────────────────────────────────

  describe('list()', () => {
    it('maps DB rows to NotificationFeedItem with camelCase fields', async () => {
      const rows = [makeRow(0)];

      fromMock
        .mockReturnValueOnce(makeListBuilder({ data: rows, error: null }))
        .mockReturnValueOnce(makeCountBuilder({ count: 1, error: null }));

      const page = await service.list('tok', 'user-1', null, 20);

      expect(page.rows).toHaveLength(1);
      const item = page.rows[0];
      expect(item.id).toBe('id-0');
      expect(item.type).toBe('consultant.assigned');
      expect(item.category).toBe('assignment');
      expect(item.title).toBe('Title 0');
      expect(item.body).toBe('Body 0');
      expect(item.link).toBe('/applications/app-0');
      expect(item.data).toEqual({ consultantName: 'Alice' });
      expect(item.readAt).toBeNull();
      expect(item.createdAt).toBe(rows[0].created_at);
    });

    it('maps null data to an empty object', async () => {
      const row = { ...makeRow(1), data: null };

      fromMock
        .mockReturnValueOnce(makeListBuilder({ data: [row], error: null }))
        .mockReturnValueOnce(makeCountBuilder({ count: 0, error: null }));

      const page = await service.list('tok', 'user-1', null, 20);
      expect(page.rows[0].data).toEqual({});
    });

    it('slices to limit and sets nextCursor from the peek-ahead row', async () => {
      // 21 rows returned (limit=20) — last one is the cursor hint
      const rows21 = Array.from({ length: 21 }, (_, i) => makeRow(i));
      // Capture before the service call because the service mutates the array
      // (Array.pop()) — rows21[20] would be undefined afterwards.
      const expectedCursor = rows21[20].created_at;

      fromMock
        .mockReturnValueOnce(makeListBuilder({ data: rows21, error: null }))
        .mockReturnValueOnce(makeCountBuilder({ count: 3, error: null }));

      const page = await service.list('tok', 'user-1', null, 20);

      expect(page.rows).toHaveLength(20);
      expect(page.nextCursor).toBe(expectedCursor);
    });

    it('sets nextCursor=null when fewer than limit+1 rows are returned', async () => {
      const rows5 = Array.from({ length: 5 }, (_, i) => makeRow(i));

      fromMock
        .mockReturnValueOnce(makeListBuilder({ data: rows5, error: null }))
        .mockReturnValueOnce(makeCountBuilder({ count: 5, error: null }));

      const page = await service.list('tok', 'user-1', null, 20);

      expect(page.rows).toHaveLength(5);
      expect(page.nextCursor).toBeNull();
    });

    it('includes the unread count from the count query', async () => {
      const rows = [makeRow(0)];

      fromMock
        .mockReturnValueOnce(makeListBuilder({ data: rows, error: null }))
        .mockReturnValueOnce(makeCountBuilder({ count: 7, error: null }));

      const page = await service.list('tok', 'user-1', null, 20);
      expect(page.unread).toBe(7);
    });

    it('throws when the DB returns an error', async () => {
      fromMock.mockReturnValueOnce(
        makeListBuilder({ data: null, error: new Error('db error') }),
      );

      await expect(service.list('tok', 'user-1', null, 20)).rejects.toThrow(
        'db error',
      );
    });

    it('renders a message-ping row (null title + message_id) as a "New message" item', async () => {
      const ping = {
        id: 'ping-1',
        type: 'message.received',
        category: 'system',
        title: null,
        body: null,
        link: null,
        data: null,
        read_at: null,
        created_at: '2026-07-04T10:00:00Z',
        conversation_id: 'conv-1',
        message_id: 'msg-1',
        conversations: { application_id: 'app-9' },
      };

      fromMock
        .mockReturnValueOnce(makeListBuilder({ data: [ping], error: null }))
        .mockReturnValueOnce(makeCountBuilder({ count: 1, error: null }));

      const page = await service.list('tok', 'user-1', null, 20);
      const item = page.rows[0];
      expect(item.title).toBe('New message');
      expect(item.category).toBe('support');
      expect(item.link).toBe('/messages/app-9');
      expect(item.conversationId).toBe('conv-1');
      expect(item.messageId).toBe('msg-1');
    });

    it('falls back to /messages when a message-ping row has no application id', async () => {
      const ping = {
        id: 'ping-2',
        type: 'message.received',
        category: 'system',
        title: null,
        body: null,
        link: null,
        data: null,
        read_at: null,
        created_at: '2026-07-04T10:00:00Z',
        conversation_id: 'conv-2',
        message_id: 'msg-2',
        conversations: null,
      };

      fromMock
        .mockReturnValueOnce(makeListBuilder({ data: [ping], error: null }))
        .mockReturnValueOnce(makeCountBuilder({ count: 1, error: null }));

      const page = await service.list('tok', 'user-1', null, 20);
      expect(page.rows[0].link).toBe('/messages');
    });
  });

  // ── unreadCount() ───────────────────────────────────────────────────────────

  describe('unreadCount()', () => {
    it('returns the count from the head query', async () => {
      fromMock.mockReturnValueOnce(makeCountBuilder({ count: 4, error: null }));
      await expect(service.unreadCount('tok', 'user-1')).resolves.toBe(4);
    });

    it('returns 0 when Supabase count is null', async () => {
      fromMock.mockReturnValueOnce(
        makeCountBuilder({ count: null, error: null }),
      );
      await expect(service.unreadCount('tok', 'user-1')).resolves.toBe(0);
    });
  });

  // ── markRead() ──────────────────────────────────────────────────────────────

  describe('markRead()', () => {
    it('applies both .eq("id") and .eq("user_id") for own-rows-only enforcement', async () => {
      // Track which (column, value) pairs are passed to each .eq() call
      const eqCalls: Array<[string, unknown]> = [];

      const updateBuilder: Record<string, unknown> = {};
      updateBuilder['update'] = jest.fn().mockReturnValue(updateBuilder);
      updateBuilder['eq'] = jest
        .fn()
        .mockImplementation((col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return updateBuilder;
        });
      // Make the final result of .eq('user_id', ...) awaitable
      updateBuilder['then'] = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (e: unknown) => unknown,
      ) => Promise.resolve({ error: null }).then(onfulfilled, onrejected);

      fromMock.mockReturnValueOnce(updateBuilder);

      const result = await service.markRead('tok', 'user-xyz', 'notif-abc');

      // Both filters must be present
      expect(eqCalls).toContainEqual(['id', 'notif-abc']);
      expect(eqCalls).toContainEqual(['user_id', 'user-xyz']);
      expect(result).toEqual({ ok: true });
    });

    it('sets read_at to an ISO date string', async () => {
      const updateMock = jest.fn();
      const eqBuilder: Record<string, unknown> = {};
      eqBuilder['eq'] = jest.fn().mockReturnValue(eqBuilder);
      eqBuilder['then'] = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (e: unknown) => unknown,
      ) => Promise.resolve({ error: null }).then(onfulfilled, onrejected);

      const updateBuilder = { update: updateMock.mockReturnValue(eqBuilder) };
      fromMock.mockReturnValueOnce(updateBuilder);

      await service.markRead('tok', 'user-1', 'notif-1');

      const updateArg = updateMock.mock.calls[0][0] as { read_at: string };
      expect(updateArg.read_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  // ── markAllRead() ───────────────────────────────────────────────────────────

  describe('markAllRead()', () => {
    it('filters by user_id and only updates rows where read_at is null', async () => {
      const isCalls: Array<[string, unknown]> = [];
      const eqCalls: Array<[string, unknown]> = [];

      const builder: Record<string, unknown> = {};
      builder['update'] = jest.fn().mockReturnValue(builder);
      builder['eq'] = jest
        .fn()
        .mockImplementation((col: string, val: unknown) => {
          eqCalls.push([col, val]);
          return builder;
        });
      builder['is'] = jest
        .fn()
        .mockImplementation((col: string, val: unknown) => {
          isCalls.push([col, val]);
          return builder;
        });
      builder['then'] = (
        onfulfilled: (v: unknown) => unknown,
        onrejected?: (e: unknown) => unknown,
      ) => Promise.resolve({ error: null }).then(onfulfilled, onrejected);

      fromMock.mockReturnValueOnce(builder);

      await service.markAllRead('tok', 'user-xyz');

      expect(eqCalls).toContainEqual(['user_id', 'user-xyz']);
      expect(isCalls).toContainEqual(['read_at', null]);
    });
  });
});
