import { MessagingRepository } from '../src/modules/messaging/messaging.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(
  result: { data?: unknown; error?: unknown },
  spy?: (m: string, ...a: unknown[]) => void,
) {
  const api: Record<string, unknown> = {
    from: (t: string) => {
      spy?.('from', t);
      return api;
    },
    select: (s: string) => {
      spy?.('select', s);
      return api;
    },
    eq: (c: string, v: unknown) => {
      spy?.('eq', c, v);
      return api;
    },
    order: (c: string, o: unknown) => {
      spy?.('order', c, JSON.stringify(o));
      return api;
    },
    limit: (n: number) => {
      spy?.('limit', n);
      return api;
    },
    lt: (c: string, v: unknown) => {
      spy?.('lt', c, v);
      return api;
    },
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('MessagingRepository.listMessagesPage', () => {
  const repo = new MessagingRepository();

  it('newest-first window with limit, no before filter when null', async () => {
    const calls: string[] = [];
    const db = mockClient({ data: [{ id: 'm1' }], error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    const out = await repo.listMessagesPage(db, 'c1', 50, null);
    expect(out).toHaveLength(1);
    expect(calls).toContain('from:messages');
    expect(calls).toContain('eq:conversation_id,c1');
    expect(calls).toContain('order:created_at,{"ascending":false}');
    expect(calls).toContain('limit:50');
    expect(calls.some((c) => c.startsWith('lt:'))).toBe(false);
  });

  it('adds lt(created_at, before) when before is set', async () => {
    const calls: string[] = [];
    const db = mockClient({ data: [], error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    await repo.listMessagesPage(db, 'c1', 50, '2026-01-01T00:00:05Z');
    expect(calls).toContain('lt:created_at,2026-01-01T00:00:05Z');
  });

  it('throws on a query error', async () => {
    await expect(
      repo.listMessagesPage(
        mockClient({ data: null, error: { message: 'boom' } }),
        'c1',
        50,
        null,
      ),
    ).rejects.toThrow('boom');
  });
});
