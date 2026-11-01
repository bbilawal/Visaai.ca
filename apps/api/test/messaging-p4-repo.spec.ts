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
    select: () => api,
    eq: (...a: unknown[]) => {
      spy?.('eq', ...a);
      return api;
    },
    order: () => api,
    limit: (n: number) => {
      spy?.('limit', n);
      return api;
    },
    textSearch: (...a: unknown[]) => {
      spy?.('textSearch', ...a);
      return api;
    },
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('MessagingRepository P4', () => {
  const repo = new MessagingRepository();

  it('listParticipants returns rows', async () => {
    const out = await repo.listParticipants(
      mockClient({ data: [{ user_id: 'u1' }], error: null }),
      'c1',
    );
    expect(out).toHaveLength(1);
  });

  it('listParticipants returns [] when empty', async () => {
    expect(
      await repo.listParticipants(
        mockClient({ data: null, error: null }),
        'c1',
      ),
    ).toEqual([]);
  });

  it('searchMessages uses websearch textSearch + conversation filter + limit', async () => {
    const calls: string[] = [];
    const db = mockClient({ data: [{ id: 'm1' }], error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    const out = await repo.searchMessages(db, 'c1', 'bank statement', 50);
    expect(out).toHaveLength(1);
    expect(
      calls.some((c) => c.startsWith('textSearch:search_tsv,bank statement')),
    ).toBe(true);
    expect(calls).toContain('eq:conversation_id,c1');
    expect(calls).toContain('limit:50');
  });
});
