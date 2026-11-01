import { NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DocumentsService } from './documents.service';

/**
 * DELETE /documents/item/:id. The 500 seen in the 2026-10-14 dry run was the
 * database (append-only audit_events FK, fixed by migration). These cover the
 * code-level order of operations around it.
 */

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

interface Results {
  deleteRows?: Array<{ id: string }>;
  deleteError?: { message: string } | null;
  remaining?: Array<{ id: string }>;
}

const DOC = {
  id: 'doc-1',
  application_id: 'app-1',
  storage_path: 'user-1/app-1/a.pdf',
  checklist_item_id: 'item-1',
  applications: { user_id: 'user-1' },
};

function makeDb(r: Results = {}) {
  const calls: Call[] = [];
  const events: string[] = [];
  const remove = jest.fn((paths: string[]) => {
    events.push('storage.remove');
    return Promise.resolve({ data: paths, error: null });
  });
  const from = jest.fn((table: string) => {
    let op = 'select';
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'update', 'delete', 'eq', 'neq', 'limit']) {
      builder[m] = jest.fn((...args: unknown[]) => {
        calls.push({ table, op: m, args });
        if (m === 'delete' || m === 'update') op = m;
        return builder;
      });
    }
    builder.single = jest.fn(() => builder);
    builder.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'documents' && op === 'delete') {
        events.push('documents.delete');
        return resolve({
          data: r.deleteError ? null : (r.deleteRows ?? [{ id: DOC.id }]),
          error: r.deleteError ?? null,
        });
      }
      if (table === 'documents' && op === 'select') {
        const isLookup = calls.some(
          (c) =>
            c.table === 'documents' &&
            c.op === 'eq' &&
            c.args[0] === 'checklist_item_id',
        );
        return resolve(
          isLookup && events.includes('documents.delete')
            ? { data: r.remaining ?? [], error: null }
            : { data: DOC, error: null },
        );
      }
      if (table === 'checklist_items' && op === 'update') {
        events.push('checklist.update');
      }
      return resolve({ data: null, error: null });
    };
    return builder;
  });
  const db = {
    from,
    storage: { from: jest.fn(() => ({ remove })) },
  } as unknown as SupabaseClient;
  return { db, calls, events, remove };
}

function service() {
  const admin = {
    from: jest.fn(() => ({
      insert: jest.fn(() => Promise.resolve({ error: null })),
    })),
  };
  return new DocumentsService(
    { admin } as never,
    {} as never,
    { add: jest.fn() } as never,
  );
}

describe('DocumentsService.deleteDocument', () => {
  it('deletes the database row BEFORE removing the file from storage', async () => {
    const { db, events } = makeDb();
    await expect(
      service().deleteDocument(db, 'doc-1', 'user-1'),
    ).resolves.toEqual({ deleted: true });
    expect(events.indexOf('documents.delete')).toBeLessThan(
      events.indexOf('storage.remove'),
    );
  });

  it('keeps the file when the row cannot be deleted, so nothing is orphaned', async () => {
    const { db, remove } = makeDb({ deleteError: { message: 'fk violation' } });
    await expect(
      service().deleteDocument(db, 'doc-1', 'user-1'),
    ).rejects.toThrow(/fk violation/);
    expect(remove).not.toHaveBeenCalled();
  });

  it('reports not found — not success — when no row was actually deleted', async () => {
    const { db, remove } = makeDb({ deleteRows: [] });
    await expect(
      service().deleteDocument(db, 'doc-1', 'user-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(remove).not.toHaveBeenCalled();
  });

  it('re-opens the checklist item when this was its last document', async () => {
    const { db, calls } = makeDb({ remaining: [] });
    await service().deleteDocument(db, 'doc-1', 'user-1');
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'checklist_items',
          op: 'update',
          args: [{ status: 'missing' }],
        }),
      ]),
    );
  });

  it('leaves the checklist item alone while another document still fills it', async () => {
    const { db, events } = makeDb({ remaining: [{ id: 'doc-2' }] });
    await service().deleteDocument(db, 'doc-1', 'user-1');
    expect(events).not.toContain('checklist.update');
  });
});
