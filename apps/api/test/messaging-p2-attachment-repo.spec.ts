import { AttachmentRepository } from '../src/modules/messaging/attachment.repository.impl';
import type { SupabaseClient } from '@supabase/supabase-js';

function mockClient(result: { data?: unknown; error?: unknown }) {
  const api: Record<string, unknown> = {
    from: () => api,
    select: () => api,
    insert: () => api,
    eq: () => api,
    maybeSingle: () => Promise.resolve(result),
    single: () => Promise.resolve(result),
  };
  return api as unknown as SupabaseClient;
}

describe('AttachmentRepository', () => {
  const repo = new AttachmentRepository();

  it('insertAttachment returns the row', async () => {
    const row = { id: 'at1', kind: 'image' };
    const out = await repo.insertAttachment(
      mockClient({ data: row, error: null }),
      {
        messageId: 'm1',
        conversationId: 'c1',
        storagePath: 'p',
        fileName: 'f.png',
        mimeType: 'image/png',
        sizeBytes: 10,
        kind: 'image',
      },
    );
    expect(out.id).toBe('at1');
  });

  it('insertVoice throws on error', async () => {
    await expect(
      repo.insertVoice(mockClient({ data: null, error: { message: 'boom' } }), {
        messageId: 'm1',
        conversationId: 'c1',
        storagePath: 'p',
        mimeType: 'audio/webm',
        durationMs: 100,
        sizeBytes: 10,
      }),
    ).rejects.toThrow('boom');
  });

  it('getAttachment returns null when not visible', async () => {
    const out = await repo.getAttachment(
      mockClient({ data: null, error: null }),
      'x',
    );
    expect(out).toBeNull();
  });
});
