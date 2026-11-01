import { PushSubscriptionRepository } from '../src/modules/notifications/push-subscription.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(result: { data?: unknown; error?: unknown }) {
  const api: Record<string, unknown> = {
    from: () => api,
    select: () => api,
    insert: () => api,
    upsert: () => api,
    update: () => api,
    delete: () => api,
    eq: () => api,
    order: () => api,
    single: () => Promise.resolve(result),
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('PushSubscriptionRepository', () => {
  const repo = new PushSubscriptionRepository();

  it('upsert returns the row', async () => {
    const out = await repo.upsert(
      mockClient({ data: { id: 's1' }, error: null }),
      {
        userId: 'u1',
        endpoint: 'https://x',
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
      },
    );
    expect(out.id).toBe('s1');
  });

  it('upsert throws on error', async () => {
    await expect(
      repo.upsert(mockClient({ data: null, error: { message: 'boom' } }), {
        userId: 'u1',
        endpoint: 'https://x',
        p256dh: 'p',
        auth: 'a',
        userAgent: null,
      }),
    ).rejects.toThrow('boom');
  });

  it('listForUser returns [] when empty', async () => {
    const out = await repo.listForUser(
      mockClient({ data: [], error: null }),
      'u1',
    );
    expect(out).toEqual([]);
  });

  it('deleteByEndpoint throws on error', async () => {
    await expect(
      repo.deleteByEndpoint(
        mockClient({ data: null, error: { message: 'del' } }),
        'https://x',
      ),
    ).rejects.toThrow('del');
  });
});
