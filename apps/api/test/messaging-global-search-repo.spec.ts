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

const nestedRow = {
  id: 'm1',
  conversation_id: 'c1',
  sender_role: 'user',
  category: 'documents',
  body: 'bank statement',
  created_at: 't',
  conversations: {
    application_id: 'app-1',
    applications: {
      country_frameworks: { country_code: 'CA', visa_type: 'work permit' },
    },
  },
};

describe('MessagingRepository.searchAllMessages', () => {
  const repo = new MessagingRepository();

  it('flattens the embedded chain into application_id + label parts', async () => {
    const out = await repo.searchAllMessages(
      mockClient({ data: [nestedRow], error: null }),
      'bank statement',
      50,
    );
    expect(out).toEqual([
      {
        id: 'm1',
        conversation_id: 'c1',
        application_id: 'app-1',
        category: 'documents',
        sender_role: 'user',
        body: 'bank statement',
        created_at: 't',
        country_code: 'CA',
        visa_type: 'work permit',
      },
    ]);
  });

  it('missing country_framework → null label parts, row still returned', async () => {
    const row = {
      ...nestedRow,
      conversations: { application_id: 'app-2', applications: {} },
    };
    const out = await repo.searchAllMessages(
      mockClient({ data: [row], error: null }),
      'bank',
      50,
    );
    expect(out[0].application_id).toBe('app-2');
    expect(out[0].country_code).toBeNull();
    expect(out[0].visa_type).toBeNull();
  });

  it('applications null → row kept with null label parts', async () => {
    const row = {
      ...nestedRow,
      conversations: { application_id: 'app-3', applications: null },
    };
    const out = await repo.searchAllMessages(
      mockClient({ data: [row], error: null }),
      'bank',
      50,
    );
    expect(out).toHaveLength(1);
    expect(out[0].application_id).toBe('app-3');
    expect(out[0].country_code).toBeNull();
    expect(out[0].visa_type).toBeNull();
  });

  it('skips a row that has no application_id (never emits a fake id)', async () => {
    const row = { ...nestedRow, conversations: {} };
    const out = await repo.searchAllMessages(
      mockClient({ data: [row], error: null }),
      'bank',
      50,
    );
    expect(out).toHaveLength(0);
  });

  it('uses websearch textSearch on search_tsv + limit', async () => {
    const calls: string[] = [];
    const db = mockClient({ data: [], error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    await repo.searchAllMessages(db, 'bank statement', 50);
    expect(
      calls.some((c) => c.startsWith('textSearch:search_tsv,bank statement')),
    ).toBe(true);
    expect(calls).toContain('limit:50');
  });

  it('throws on a query error', async () => {
    await expect(
      repo.searchAllMessages(
        mockClient({ data: null, error: { message: 'boom' } }),
        'x',
        50,
      ),
    ).rejects.toThrow('boom');
  });
});
