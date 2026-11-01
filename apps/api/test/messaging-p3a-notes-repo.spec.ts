import { ConsultantNotesRepository } from '../src/modules/messaging/consultant-notes.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(result: { data?: unknown; error?: unknown }) {
  const api: Record<string, unknown> = {
    from: () => api,
    select: () => api,
    insert: () => api,
    update: () => api,
    eq: () => api,
    order: () => api,
    single: () => Promise.resolve(result),
    then: undefined,
  };
  // listByConversation awaits the builder directly (no single()): make it thenable
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('ConsultantNotesRepository', () => {
  const repo = new ConsultantNotesRepository();

  it('insert returns the row', async () => {
    const out = await repo.insert(
      mockClient({ data: { id: 'n1' }, error: null }),
      {
        conversationId: 'c1',
        applicationId: 'a1',
        authorId: 'u1',
        body: 'note',
      },
    );
    expect(out.id).toBe('n1');
  });

  it('insert throws on error', async () => {
    await expect(
      repo.insert(mockClient({ data: null, error: { message: 'boom' } }), {
        conversationId: 'c1',
        applicationId: 'a1',
        authorId: 'u1',
        body: 'note',
      }),
    ).rejects.toThrow('boom');
  });

  it('listByConversation returns [] when empty', async () => {
    const out = await repo.listByConversation(
      mockClient({ data: [], error: null }),
      'c1',
    );
    expect(out).toEqual([]);
  });
});
