import { MessagingRepository } from '../src/modules/messaging/messaging.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

// Minimal fluent mock: each call records the chain and returns a settable result.
function mockClient(result: { data?: unknown; error?: unknown }) {
  const calls: Record<string, unknown[]> = {};
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      calls[name] = args;
      return api;
    };
  const api: Record<string, unknown> = {
    from: rec('from'),
    select: rec('select'),
    insert: rec('insert'),
    update: rec('update'),
    upsert: rec('upsert'),
    eq: rec('eq'),
    order: rec('order'),
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
    then: undefined,
  };
  return { client: api as unknown as SupabaseClient, calls };
}

describe('MessagingRepository', () => {
  const repo = new MessagingRepository();

  it('getConversationByApplication returns null when no row', async () => {
    const { client } = mockClient({ data: null, error: null });
    const out = await repo.getConversationByApplication(client, 'app-1');
    expect(out).toBeNull();
  });

  it('insertConversation returns the inserted row', async () => {
    const row = {
      id: 'c1',
      application_id: 'app-1',
      status: 'open',
      last_message_at: null,
      created_at: 't',
    };
    const { client, calls } = mockClient({ data: row, error: null });
    const out = await repo.insertConversation(client, 'app-1');
    expect(out.id).toBe('c1');
    expect(calls.from[0]).toBe('conversations');
  });

  it('insertMessage throws on error', async () => {
    const { client } = mockClient({ data: null, error: { message: 'boom' } });
    await expect(
      repo.insertMessage(client, {
        conversationId: 'c1',
        senderId: 'u1',
        senderRole: 'user',
        category: 'general',
        body: 'hi',
        parentMessageId: null,
      }),
    ).rejects.toThrow('boom');
  });
});
