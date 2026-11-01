import { ForbiddenException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { DocumentsService } from './documents.service';

/**
 * Live 2026-10-20: a consultant marked a document "Needs re-upload"; the
 * applicant's vault kept showing it (and its slot) as Verified. GET
 * /documents/:applicationId now carries the consultant's latest decision on
 * each document — decision, note and date only.
 */

interface Call {
  table: string;
  method: string;
  args: unknown[];
}

function makeDb(opts: {
  owner?: boolean;
  docs: Array<Record<string, unknown>>;
  reviews?: Array<Record<string, unknown>>;
  reviewsError?: { message: string };
}) {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'order', 'single']) {
      builder[m] = jest.fn((...args: unknown[]) => {
        calls.push({ table, method: m, args });
        return builder;
      });
    }
    builder.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'applications')
        return resolve({
          data: opts.owner === false ? null : { id: 'app-1' },
          error: null,
        });
      if (table === 'documents')
        return resolve({ data: opts.docs, error: null });
      if (table === 'cross_verifications')
        return resolve({ data: [], error: null });
      if (table === 'application_item_reviews')
        return resolve({
          data: opts.reviewsError ? null : (opts.reviews ?? []),
          error: opts.reviewsError ?? null,
        });
      return resolve({ data: null, error: null });
    };
    return builder;
  });
  return { db: { from } as unknown as SupabaseClient, calls };
}

const service = () =>
  new DocumentsService({} as never, {} as never, { add: jest.fn() } as never);

const DOC_OLD = {
  id: 'doc-old',
  file_name: 'passport.pdf',
  checklist_item_id: 'slot-1',
  created_at: '2026-10-01T09:00:00Z',
  ocr_status: 'complete',
  document_verifications: [],
};
const REUPLOAD = {
  item_kind: 'document',
  item_id: 'doc-old',
  decision: 'needs_reupload',
  note: 'The photo page is cut off',
  created_at: '2026-10-02T10:00:00Z',
};

describe('DocumentsService.getDocuments — consultant review', () => {
  it('attaches the open re-upload request with its note and date', async () => {
    const { db } = makeDb({ docs: [DOC_OLD], reviews: [REUPLOAD] });
    const out = await service().getDocuments(db, 'app-1', 'user-1');
    expect(out.documents[0].consultant_review).toEqual({
      decision: 'needs_reupload',
      note: 'The photo page is cut off',
      decided_at: '2026-10-02T10:00:00Z',
      open: true,
    });
  });

  it('selects only decision, note and date — never the reviewer', async () => {
    const { db, calls } = makeDb({ docs: [DOC_OLD], reviews: [REUPLOAD] });
    await service().getDocuments(db, 'app-1', 'user-1');
    const select = calls.find(
      (c) => c.table === 'application_item_reviews' && c.method === 'select',
    );
    expect(select?.args[0]).toBe(
      'item_kind, item_id, decision, note, created_at',
    );
    expect(calls).toEqual(
      expect.arrayContaining([
        {
          table: 'application_item_reviews',
          method: 'eq',
          args: ['application_id', 'app-1'],
        },
      ]),
    );
  });

  it('a newer upload into the same slot closes the request (it stays on the old document)', async () => {
    const DOC_NEW = {
      ...DOC_OLD,
      id: 'doc-new',
      file_name: 'passport-2.pdf',
      created_at: '2026-10-03T09:00:00Z',
    };
    const { db } = makeDb({ docs: [DOC_NEW, DOC_OLD], reviews: [REUPLOAD] });
    const out = await service().getDocuments(db, 'app-1', 'user-1');
    const byId = new Map(out.documents.map((d) => [d.id, d]));
    expect(byId.get('doc-old')?.consultant_review).toMatchObject({
      decision: 'needs_reupload',
      open: false,
    });
    expect(byId.get('doc-new')?.consultant_review).toBeNull();
  });

  it('multi-file slot: a file uploaded BEFORE the request does not close it', async () => {
    const DOC_B = {
      ...DOC_OLD,
      id: 'doc-b',
      file_name: 'passport-back.pdf',
      created_at: '2026-10-01T12:00:00Z', // after A, before the decision
    };
    const { db } = makeDb({ docs: [DOC_B, DOC_OLD], reviews: [REUPLOAD] });
    const out = await service().getDocuments(db, 'app-1', 'user-1');
    const byId = new Map(out.documents.map((d) => [d.id, d]));
    expect(byId.get('doc-old')?.consultant_review).toMatchObject({
      decision: 'needs_reupload',
      open: true,
    });
  });

  it('a later approval wins, without a note', async () => {
    const { db } = makeDb({
      docs: [DOC_OLD],
      reviews: [
        REUPLOAD,
        {
          ...REUPLOAD,
          decision: 'approved',
          note: null,
          created_at: '2026-10-05T10:00:00Z',
        },
      ],
    });
    const out = await service().getDocuments(db, 'app-1', 'user-1');
    expect(out.documents[0].consultant_review).toEqual({
      decision: 'approved',
      note: null,
      decided_at: '2026-10-05T10:00:00Z',
      open: false,
    });
  });

  it('an unreadable review table leaves the vault working, with no review', async () => {
    const { db } = makeDb({
      docs: [DOC_OLD],
      reviewsError: { message: 'denied' },
    });
    const out = await service().getDocuments(db, 'app-1', 'user-1');
    expect(out.documents[0].consultant_review).toBeNull();
  });

  it('refuses a caller who does not own the application', async () => {
    const { db, calls } = makeDb({
      owner: false,
      docs: [DOC_OLD],
      reviews: [REUPLOAD],
    });
    await expect(
      service().getDocuments(db, 'app-1', 'user-2'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(calls.some((c) => c.table === 'application_item_reviews')).toBe(
      false,
    );
  });
});
