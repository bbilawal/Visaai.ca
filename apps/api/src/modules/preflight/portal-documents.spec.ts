import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortalDocuments } from './portal-documents';

/** Every query resolves to the rows of its table, whatever the filters. */
function fakeDb(tables: Record<string, unknown[]>): SupabaseClient {
  return {
    from: (t: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve({ data: tables[t] ?? [], error: null }).then(res),
      };
      return q;
    },
  } as unknown as SupabaseClient;
}

const doc = (id: string) => ({
  id,
  document_type: 'passport',
  file_name: `${id}.pdf`,
  mime_type: 'application/pdf',
  upload_status: 'complete',
  ocr_status: 'complete',
  dup_status: null,
  created_at: '2026-10-29T00:00:00Z',
});

describe('loadPortalDocuments — a passport held for confirmation', () => {
  const verifications = [
    {
      document_id: 'doc-held',
      verification_type: 'identity',
      details_json: {
        extracted_fields: { full_name: 'MIKE NOVEMBER OSCAR' },
        holder_mismatch: {
          holder: 'MIKE NOVEMBER OSCAR',
          applicant: 'Kilo Tester',
          message: 'confirm',
          needs_confirmation: true,
        },
      },
    },
    {
      document_id: 'doc-ok',
      verification_type: 'identity',
      details_json: { extracted_fields: { full_name: 'KILO TESTER' } },
    },
  ];

  it('is not attached unless the consultant approved it', async () => {
    const out = await loadPortalDocuments(
      fakeDb({
        documents: [doc('doc-held'), doc('doc-ok')],
        application_item_reviews: [],
        document_verifications: verifications,
      }),
      'app-1',
    );
    expect(out.map((d) => d.id)).toEqual(['doc-ok']);
  });

  it('is attached once approved', async () => {
    const out = await loadPortalDocuments(
      fakeDb({
        documents: [doc('doc-held'), doc('doc-ok')],
        application_item_reviews: [
          {
            item_kind: 'document',
            item_id: 'doc-held',
            decision: 'approved',
            created_at: '2026-10-29T01:00:00Z',
          },
        ],
        document_verifications: verifications,
      }),
      'app-1',
    );
    expect(out.map((d) => d.id)).toEqual(['doc-held', 'doc-ok']);
  });
});

describe('loadPortalDocuments — a passport that is clearly someone else', () => {
  const verifications = [
    {
      document_id: 'doc-other',
      verification_type: 'identity',
      details_json: {
        extracted_fields: { full_name: 'QUEBEC ZULU' },
        holder_mismatch: {
          holder: 'QUEBEC ZULU',
          applicant: 'Kilo Tester',
          message: 'not yours',
          clearly_other: true,
        },
      },
    },
    {
      document_id: 'doc-ok',
      verification_type: 'identity',
      details_json: { extracted_fields: { full_name: 'KILO TESTER' } },
    },
  ];
  const approval = {
    item_kind: 'document',
    item_id: 'doc-other',
    decision: 'approved',
    created_at: '2026-10-29T01:00:00Z',
  };

  it.each([
    ['without a decision', []],
    ['even after a consultant approved it', [approval]],
  ])('is never attached %s', async (_l, reviews) => {
    const out = await loadPortalDocuments(
      fakeDb({
        documents: [doc('doc-other'), doc('doc-ok')],
        application_item_reviews: reviews,
        document_verifications: verifications,
      }),
      'app-1',
    );
    expect(out.map((d) => d.id)).toEqual(['doc-ok']);
  });
});

describe('loadPortalDocuments — the applicant confirmed a held passport', () => {
  const held = (id: string, mismatch: Record<string, unknown>) => ({
    document_id: id,
    verification_type: 'identity',
    details_json: {
      extracted_fields: { full_name: 'MIKE NOVEMBER OSCAR' },
      holder_mismatch: {
        holder: 'MIKE NOVEMBER OSCAR',
        applicant: 'Kilo Tester',
        message: 'confirm',
        ...mismatch,
      },
    },
  });
  const confirmed = (id: string) => ({
    document_id: id,
    application_id: 'app-1',
    created_at: '2026-10-30T01:00:00Z',
  });

  it('is attached once the applicant confirmed it, like an approval', async () => {
    const out = await loadPortalDocuments(
      fakeDb({
        documents: [doc('doc-held')],
        application_item_reviews: [],
        document_verifications: [
          held('doc-held', { needs_confirmation: true }),
        ],
        document_holder_confirmations: [confirmed('doc-held')],
      }),
      'app-1',
    );
    expect(out.map((d) => d.id)).toEqual(['doc-held']);
    // Not a consultant approval.
    expect(out[0].approved).toBe(false);
  });

  it('is never attached when clearly someone else, confirmed or not', async () => {
    const out = await loadPortalDocuments(
      fakeDb({
        documents: [doc('doc-other')],
        application_item_reviews: [],
        document_verifications: [held('doc-other', { clearly_other: true })],
        document_holder_confirmations: [confirmed('doc-other')],
      }),
      'app-1',
    );
    expect(out).toEqual([]);
  });

  it('stays out when the consultant asked for a re-upload', async () => {
    const out = await loadPortalDocuments(
      fakeDb({
        documents: [doc('doc-held')],
        application_item_reviews: [
          {
            item_kind: 'document',
            item_id: 'doc-held',
            decision: 'needs_reupload',
            created_at: '2026-10-30T02:00:00Z',
          },
        ],
        document_verifications: [
          held('doc-held', { needs_confirmation: true }),
        ],
        document_holder_confirmations: [confirmed('doc-held')],
      }),
      'app-1',
    );
    expect(out).toEqual([]);
  });

  it('does not release an unreadable-holder card (holder_unknown)', async () => {
    const out = await loadPortalDocuments(
      fakeDb({
        documents: [doc('doc-card')],
        application_item_reviews: [],
        document_verifications: [
          {
            document_id: 'doc-card',
            verification_type: 'identity',
            details_json: { extracted_fields: { holder_unknown: true } },
          },
        ],
        document_holder_confirmations: [confirmed('doc-card')],
      }),
      'app-1',
    );
    expect(out).toEqual([]);
  });
});
