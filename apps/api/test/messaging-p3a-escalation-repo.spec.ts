import { EscalationRepository } from '../src/modules/messaging/escalation.repository.impl';
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
    maybeSingle: () => Promise.resolve(result),
  };
  (api as { then?: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve(result);
  return api as unknown as SupabaseClient;
}

describe('EscalationRepository', () => {
  const repo = new EscalationRepository();

  it('insert returns the row', async () => {
    const out = await repo.insert(
      mockClient({ data: { id: 'e1', status: 'open' }, error: null }),
      {
        conversationId: 'c1',
        applicationId: 'a1',
        escalatedBy: 'u1',
        escalationType: 'legal_review',
        reason: 'r',
      },
    );
    expect(out.id).toBe('e1');
  });

  it('getById returns null when missing', async () => {
    const out = await repo.getById(
      mockClient({ data: null, error: null }),
      'x',
    );
    expect(out).toBeNull();
  });

  it('markResolved throws on error', async () => {
    await expect(
      repo.markResolved(
        mockClient({ data: null, error: { message: 'boom' } }),
        'e1',
        'u1',
      ),
    ).rejects.toThrow('boom');
  });
});
