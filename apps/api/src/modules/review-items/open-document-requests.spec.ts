import {
  isSuperseded,
  openRequestSlots,
  withOpenRequestSlots,
  latestDocumentDecisions,
  openDocumentRequests,
} from './open-document-requests';

const doc = (id: string, slot: string | null, at: string) => ({
  id,
  checklist_item_id: slot,
  created_at: at,
});
const dec = (id: string, decision: string, at: string, note = 'blurry') => ({
  item_kind: 'document',
  item_id: id,
  decision,
  note,
  created_at: at,
});

describe('openDocumentRequests', () => {
  it('a needs_reupload or rejected latest decision is open', () => {
    const docs = [doc('d1', 's1', '2026-10-01'), doc('d2', 's2', '2026-10-01')];
    const open = openDocumentRequests(docs, [
      dec('d1', 'needs_reupload', '2026-10-02T10:00:00Z'),
      dec('d2', 'rejected', '2026-10-02T10:00:00Z'),
    ]);
    expect([...open.keys()].sort()).toEqual(['d1', 'd2']);
  });

  it('a later approval of the same document closes it (latest wins)', () => {
    const docs = [doc('d1', 's1', '2026-10-01')];
    const open = openDocumentRequests(docs, [
      dec('d1', 'needs_reupload', '2026-10-02T10:00:00Z'),
      dec('d1', 'approved', '2026-10-03T10:00:00Z'),
    ]);
    expect(open.size).toBe(0);
  });

  it('a newer upload into the same slot closes it; the decision stays on the old document', () => {
    const docs = [
      doc('old', 's1', '2026-10-01T09:00:00Z'),
      doc('new', 's1', '2026-10-04T09:00:00Z'),
    ];
    const decisions = [dec('old', 'needs_reupload', '2026-10-02T10:00:00Z')];
    expect(openDocumentRequests(docs, decisions).size).toBe(0);
    expect(latestDocumentDecisions(decisions).get('old')?.decision).toBe(
      'needs_reupload',
    );
    expect(isSuperseded(docs[0], docs, '2026-10-02T10:00:00Z')).toBe(true);
    expect(isSuperseded(docs[1], docs, '2026-10-02T10:00:00Z')).toBe(false);
  });

  it('an upload into a DIFFERENT slot does not close it', () => {
    const docs = [
      doc('old', 's1', '2026-10-01T09:00:00Z'),
      doc('other', 's2', '2026-10-04T09:00:00Z'),
    ];
    const open = openDocumentRequests(docs, [
      dec('old', 'rejected', '2026-10-02T10:00:00Z'),
    ]);
    expect([...open.keys()]).toEqual(['old']);
  });

  it('an unslotted document stays open until the consultant decides again', () => {
    const docs = [
      doc('loose', null, '2026-10-01T09:00:00Z'),
      doc('loose2', null, '2026-10-04T09:00:00Z'),
    ];
    const open = openDocumentRequests(docs, [
      dec('loose', 'needs_reupload', '2026-10-02T10:00:00Z'),
    ]);
    expect([...open.keys()]).toEqual(['loose']);
  });

  it('ignores generated-item decisions and approvals', () => {
    const docs = [doc('d1', 's1', '2026-10-01')];
    const open = openDocumentRequests(docs, [
      { ...dec('d1', 'rejected', '2026-10-02'), item_kind: 'generated' },
      dec('d1', 'approved', '2026-10-01T12:00:00Z'),
    ]);
    expect(open.size).toBe(0);
  });
});

describe('openDocumentRequests — review fixes', () => {
  it('multi-file slot: a file uploaded BEFORE the decision is not a replacement (A then B, re-upload A)', () => {
    const docs = [
      doc('A', 'bank', '2026-10-01T09:00:00Z'),
      doc('B', 'bank', '2026-10-02T09:00:00Z'),
    ];
    const decisions = [dec('A', 'needs_reupload', '2026-10-05T10:00:00Z')];
    expect([...openDocumentRequests(docs, decisions).keys()]).toEqual(['A']);
    expect(isSuperseded(docs[0], docs, '2026-10-05T10:00:00Z')).toBe(false);
    // An upload into the slot after the decision is the replacement.
    const withC = [...docs, doc('C', 'bank', '2026-10-06T09:00:00Z')];
    expect(openDocumentRequests(withC, decisions).size).toBe(0);
  });

  it('deleting the requested document does not close the request', () => {
    const decisions = [dec('gone', 'needs_reupload', '2026-10-05T10:00:00Z')];
    const docs = [doc('other', 's2', '2026-10-01T09:00:00Z')];
    const open = openDocumentRequests(docs, decisions);
    expect(open.get('gone')).toEqual({ doc: null, decision: decisions[0] });
  });

  it('a deleted requested document is answered by an upload after the decision', () => {
    const decisions = [dec('gone', 'rejected', '2026-10-05T10:00:00Z')];
    const docs = [doc('new', 's1', '2026-10-06T09:00:00Z')];
    expect(openDocumentRequests(docs, decisions).size).toBe(0);
  });
});

describe('openRequestSlots / withOpenRequestSlots (server completion)', () => {
  function db(
    docs: unknown[],
    reviews: unknown[],
    error: { message: string } | null = null,
  ) {
    return {
      from: (table: string) => {
        const b: Record<string, unknown> = {};
        b.select = () => b;
        b.eq = () => b;
        b.then = (resolve: (v: unknown) => unknown) =>
          resolve(
            table === 'documents'
              ? { data: docs, error: null }
              : { data: error ? null : reviews, error },
          );
        return b;
      },
    } as never;
  }

  it('returns the slots holding an open request', async () => {
    const slots = await openRequestSlots(
      db(
        [doc('d1', 'pp', '2026-10-01'), doc('d2', 'bank', '2026-10-01')],
        [dec('d1', 'needs_reupload', '2026-10-02T00:00:00Z')],
      ),
      'app-1',
    );
    expect([...slots]).toEqual(['pp']);
  });

  it('throws on a read error (callers decide how to degrade)', async () => {
    await expect(
      openRequestSlots(db([], [], { message: 'denied' }), 'app-1'),
    ).rejects.toThrow(/denied/);
  });

  it('marks requested slots missing; waived stays waived', () => {
    const items = [
      { id: 'pp', status: 'verified' },
      { id: 'bank', status: 'waived' },
      { id: 'photo', status: 'verified' },
    ];
    expect(
      withOpenRequestSlots(items, new Set(['pp', 'bank'])).map((i) => i.status),
    ).toEqual(['missing', 'waived', 'verified']);
  });
});
