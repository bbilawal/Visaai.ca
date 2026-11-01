import { MessagingRepository } from '../src/modules/messaging/messaging.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(
  result: { error?: unknown },
  spy?: (m: string, ...a: unknown[]) => void,
) {
  const api: Record<string, unknown> = {
    from: (t: string) => {
      spy?.('from', t);
      return api;
    },
    update: (v: unknown) => {
      spy?.('update', JSON.stringify(v));
      return api;
    },
    eq: (c: string, v: unknown) => {
      spy?.('eq', c, v);
      return api;
    },
    in: (c: string, v: unknown[]) => {
      spy?.('in', c, v.join('|'));
      return api;
    },
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('MessagingRepository delivered watermarks', () => {
  const repo = new MessagingRepository();

  it('advanceDelivered updates delivered_at for the conversation + user IN-list', async () => {
    const calls: string[] = [];
    const db = mockClient({ error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    await repo.advanceDelivered(db, 'c1', ['u1', 'u2'], 't0');
    expect(calls).toContain('from:conversation_participants');
    expect(calls).toContain('update:{"delivered_at":"t0"}');
    expect(calls).toContain('eq:conversation_id,c1');
    expect(calls).toContain('in:user_id,u1|u2');
  });

  it('advanceDelivered with no userIds makes no DB call', async () => {
    let touched = false;
    const db = mockClient({ error: null }, () => {
      touched = true;
    });
    await repo.advanceDelivered(db, 'c1', [], 't0');
    expect(touched).toBe(false);
  });

  it('advanceDelivered throws on error', async () => {
    await expect(
      repo.advanceDelivered(
        mockClient({ error: { message: 'boom' } }),
        'c1',
        ['u1'],
        't0',
      ),
    ).rejects.toThrow('boom');
  });

  it('advanceDeliveredForUser updates delivered_at for all of a user rows', async () => {
    const calls: string[] = [];
    const db = mockClient({ error: null }, (m, ...a) =>
      calls.push(`${m}:${a.join(',')}`),
    );
    await repo.advanceDeliveredForUser(db, 'u1', 't1');
    expect(calls).toContain('update:{"delivered_at":"t1"}');
    expect(calls).toContain('eq:user_id,u1');
  });

  it('advanceDeliveredForUser throws on error', async () => {
    await expect(
      repo.advanceDeliveredForUser(
        mockClient({ error: { message: 'nope' } }),
        'u1',
        't1',
      ),
    ).rejects.toThrow('nope');
  });
});
