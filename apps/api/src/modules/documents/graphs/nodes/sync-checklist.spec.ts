import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeSyncChecklistNode } from './sync-checklist';

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

function makeSupabase(checklistItemId: string | null = 'item-1') {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    let isSingle = false;
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'update', 'eq', 'in']) {
      builder[m] = jest.fn((...args: unknown[]) => {
        calls.push({ table, op: m, args });
        return builder;
      });
    }
    builder.single = jest.fn(() => {
      isSingle = true;
      return builder;
    });
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === 'documents' && isSingle
          ? { data: { checklist_item_id: checklistItemId }, error: null }
          : { data: [], error: null },
      );
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

function state(over: Partial<DocumentState> = {}): DocumentState {
  return {
    documentId: 'doc-1',
    applicationId: 'app-1',
    documentType: 'previous_travel_evidence',
    verificationResult: 'pass',
    slotMismatch: null,
    error: null,
    ...over,
  } as DocumentState;
}

function checklistUpdates(calls: Call[]) {
  return calls
    .filter((c) => c.table === 'checklist_items' && c.op === 'update')
    .map((c) => c.args[0]);
}

describe('sync_checklist', () => {
  it('marks the slot verified on a clean pass', async () => {
    const { client, calls } = makeSupabase();
    await makeSyncChecklistNode(client)(state());
    expect(checklistUpdates(calls)).toEqual([{ status: 'verified' }]);
  });

  it('does not verify the slot on an expired document (prod 61f16bb5)', async () => {
    // The 21st Century policy expired 2026-05-31 passed its identity read and
    // so marked the super visa medical_insurance slot 'verified'.
    const { client, calls } = makeSupabase();
    await makeSyncChecklistNode(client)(state({ expiryStatus: 'fail' }));
    expect(checklistUpdates(calls)).toEqual([]);
  });

  it('re-opens the slot when the upload is the wrong document (#15)', async () => {
    const { client, calls } = makeSupabase();
    await makeSyncChecklistNode(client)(
      state({
        verificationResult: 'fail',
        slotMismatch: {
          expected: 'previous_travel_evidence',
          detected: 'passport',
          message: 'wrong document',
        },
      }),
    );
    expect(checklistUpdates(calls)).toEqual([{ status: 'missing' }]);
    // Only an item still sitting at 'uploaded' — never one another document
    // already verified.
    expect(calls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'checklist_items',
          op: 'eq',
          args: ['status', 'uploaded'],
        }),
      ]),
    );
  });
});
