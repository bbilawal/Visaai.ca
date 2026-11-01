import { MessagingRepository } from '../src/modules/messaging/messaging.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(
  result: { count?: number | null; error?: unknown },
  spy?: (m: string, ...a: unknown[]) => void,
) {
  const api: Record<string, unknown> = {
    from: (t: string) => {
      spy?.('from', t);
      return api;
    },
    select: (c: string, opts?: unknown) => {
      spy?.('select', c, JSON.stringify(opts));
      return api;
    },
    eq: (c: string, v: unknown) => {
      spy?.('eq', c, v);
      return api;
    },
    neq: (c: string, v: unknown) => {
      spy?.('neq', c, v);
      return api;
    },
    gt: (c: string, v: unknown) => {
      spy?.('gt', c, v);
      return api;
    },
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('MessagingRepository.countUnread', () => {
  const repo = new MessagingRepository();

  it('builds a head count filtered by conversation, other senders, and watermark', async () => {
    const calls: string[] = [];
    const db = mockClient({ count: 3, error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    const n = await repo.countUnread(db, 'c1', 'me', '2026-01-01T00:00:02Z');
    expect(n).toBe(3);
    expect(calls).toContain('from:messages');
    expect(calls).toContain('select:id,{"count":"exact","head":true}');
    expect(calls).toContain('eq:conversation_id,c1');
    expect(calls).toContain('neq:sender_id,me');
    expect(calls).toContain('gt:created_at,2026-01-01T00:00:02Z');
  });

  it('omits the watermark filter when watermark is null', async () => {
    const calls: string[] = [];
    const db = mockClient({ count: 5, error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    const n = await repo.countUnread(db, 'c1', 'me', null);
    expect(n).toBe(5);
    expect(calls.some((c) => c.startsWith('gt:'))).toBe(false);
  });

  it('returns 0 when count is null', async () => {
    expect(
      await repo.countUnread(
        mockClient({ count: null, error: null }),
        'c1',
        'me',
        null,
      ),
    ).toBe(0);
  });

  it('throws on a query error', async () => {
    await expect(
      repo.countUnread(
        mockClient({ count: null, error: { message: 'boom' } }),
        'c1',
        'me',
        null,
      ),
    ).rejects.toThrow('boom');
  });
});
