import { NotificationPreferenceRepository } from '../src/modules/notifications/notification-preference.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(result: { data?: unknown; error?: unknown }) {
  const api: Record<string, unknown> = {
    from: () => api,
    select: () => api,
    upsert: () => api,
    update: () => api,
    eq: () => api,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('NotificationPreferenceRepository', () => {
  const repo = new NotificationPreferenceRepository();

  it('getForUser returns the stored row', async () => {
    const out = await repo.getForUser(
      mockClient({
        data: {
          user_id: 'u1',
          email_enabled: false,
          push_enabled: true,
          updated_at: 't',
        },
        error: null,
      }),
      'u1',
    );
    expect(out.email_enabled).toBe(false);
  });

  it('getForUser defaults all-enabled when no row', async () => {
    const out = await repo.getForUser(
      mockClient({ data: null, error: null }),
      'u1',
    );
    expect(out).toEqual(
      expect.objectContaining({
        user_id: 'u1',
        email_enabled: true,
        push_enabled: true,
      }),
    );
  });

  it('upsert returns the row', async () => {
    const out = await repo.upsert(
      mockClient({
        data: {
          user_id: 'u1',
          email_enabled: false,
          push_enabled: true,
          updated_at: 't',
        },
        error: null,
      }),
      'u1',
      { email_enabled: false },
    );
    expect(out.email_enabled).toBe(false);
  });
});
