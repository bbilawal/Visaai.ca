import type { SupabaseClient } from '@supabase/supabase-js';
import { makeFinalizeDocumentNode } from './finalize-document';
import type { NarrativeState } from '../narrative.state';

type Row = { id: string; content_md: string } | null;

function db(existing: Row, calls: Array<[string, unknown, unknown?]>) {
  return {
    from: () => {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.maybeSingle = () => Promise.resolve({ data: existing, error: null });
      c.upsert = (row: unknown, opts: unknown) => {
        calls.push(['upsert', row, opts]);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: { id: existing?.id ?? 'new-id' },
                error: null,
              }),
          }),
        };
      };
      c.insert = (row: unknown) => {
        calls.push(['insert', row]);
        return {
          select: () => ({
            single: () =>
              Promise.resolve({
                data: null,
                error: {
                  message: 'duplicate key value violates unique constraint',
                },
              }),
          }),
        };
      };
      return c;
    },
  } as unknown as SupabaseClient;
}

const state = {
  applicationId: 'app-1',
  docType: 'loe',
  draft: 'New letter',
} as NarrativeState;

describe('finalizeDocument', () => {
  it('a regeneration replaces the one row per type and starts it UNAPPROVED', async () => {
    const calls: Array<[string, unknown, unknown?]> = [];
    const kept: unknown[] = [];
    const node = makeFinalizeDocumentNode(
      db({ id: 'doc-1', content_md: 'Old approved letter' }, calls),
      (prev) => {
        kept.push(prev);
        return Promise.resolve();
      },
    );
    const out = await node(state);
    expect(out.generatedDocumentId).toBe('doc-1');
    const upsert = calls.find((c) => c[0] === 'upsert')!;
    expect(upsert[1]).toMatchObject({
      application_id: 'app-1',
      doc_type: 'loe',
      content_md: 'New letter',
      approved_by_user: false,
    });
    expect(upsert[2]).toEqual({ onConflict: 'application_id,doc_type' });
    // the text it replaces is kept first (no overwrite without history)
    expect(kept).toEqual([{ id: 'doc-1', content_md: 'Old approved letter' }]);
  });

  it('does not overwrite when the previous text could not be kept', async () => {
    const calls: Array<[string, unknown, unknown?]> = [];
    const node = makeFinalizeDocumentNode(
      db({ id: 'doc-1', content_md: 'Old' }, calls),
      () => Promise.reject(new Error('revisions down')),
    );
    await expect(node(state)).rejects.toThrow(/revisions down/);
    expect(calls.find((c) => c[0] === 'upsert')).toBeUndefined();
  });

  it('a first generation is stored unapproved with no revision', async () => {
    const calls: Array<[string, unknown, unknown?]> = [];
    const kept: unknown[] = [];
    const node = makeFinalizeDocumentNode(db(null, calls), (p) => {
      kept.push(p);
      return Promise.resolve();
    });
    const out = await node(state);
    expect(out.generatedDocumentId).toBe('new-id');
    expect(kept).toEqual([]);
    expect(
      (calls[0][1] as { approved_by_user: boolean }).approved_by_user,
    ).toBe(false);
  });
});
