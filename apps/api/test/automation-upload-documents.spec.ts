import type { ConfigService } from '@nestjs/config';
import { AutomationService } from '../src/modules/automation/automation.service';
import type { Env } from '../src/config/configuration';

/**
 * REVIEW_HANDOFF §7.10: the legacy fill plan read the application's
 * documents with `{ error }` dropped, so a failed read produced a plan with
 * ZERO upload steps; and the "keep the newest re-upload" de-dupe relied on an
 * order the query never requested.
 */
function service(result: { data: unknown[] | null; error: unknown }) {
  const orders: Array<[string, unknown]> = [];
  const q: Record<string, unknown> = {
    select: () => q,
    eq: () => q,
    order: (col: string, o: unknown) => {
      orders.push([col, o]);
      return q;
    },
    then: (r: (v: unknown) => unknown) => Promise.resolve(result).then(r),
  };
  const supabase = {
    admin: {
      from: () => q,
      storage: {
        from: () => ({
          createSignedUrl: async (path: string) => ({
            data: { signedUrl: `https://s/${path}` },
          }),
        }),
      },
    },
    toPublicStorageUrl: (u: string) => u,
  };
  const svc = new AutomationService(
    supabase as never,
    {} as never,
    {} as never,
    { get: () => true } as unknown as ConfigService<Env>,
    { mint: () => 'exec', isValid: async () => true },
  );
  const load = (id: string) =>
    (
      svc as unknown as {
        loadUploadableDocuments(
          id: string,
        ): Promise<Array<{ documentType: string; fileName: string }>>;
      }
    ).loadUploadableDocuments(id);
  return { load, orders };
}

describe('legacy fill plan — uploadable documents', () => {
  it('throws on a failed read instead of planning zero uploads', async () => {
    const { load } = service({ data: null, error: { message: 'timeout' } });
    await expect(load('app-1')).rejects.toThrow('timeout');
  });

  it('asks for newest-first so the de-dupe keeps the latest re-upload', async () => {
    const { load, orders } = service({
      data: [
        {
          document_type: 'passport',
          storage_path: 'new.pdf',
          file_name: 'new.pdf',
        },
        {
          document_type: 'passport',
          storage_path: 'old.pdf',
          file_name: 'old.pdf',
        },
      ],
      error: null,
    });
    const docs = await load('app-1');
    expect(orders).toEqual([['created_at', { ascending: false }]]);
    expect(docs.map((d) => d.fileName)).toEqual(['new.pdf']);
  });
});
