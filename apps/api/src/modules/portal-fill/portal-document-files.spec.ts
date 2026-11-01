/**
 * PortalDocumentFiles.load re-checks, at dispatch, that a document may still
 * be attached. For a form that must be signed (IMM 5476 on TRV; the PR
 * portal's IMM 1344/5532/5533) the consultant's approval must still stand:
 * document decisions are not part of the lock hash, so an approval withdrawn
 * after the lock is only caught here (review of PR #285).
 */
import {
  PortalDocumentFiles,
  uploadNeedsSignature,
} from './portal-document-files';

const DOC = '00000000-0000-4000-8000-000000000042';

function fakeSupabase(decisions: string[]) {
  const docRow = {
    id: DOC,
    document_type: 'imm5476',
    file_name: 'IMM5476-signed.pdf',
    mime_type: 'application/pdf',
    storage_path: 'app-1/IMM5476-signed.pdf',
    upload_status: 'complete',
    ocr_status: 'complete',
    dup_status: 'unique',
    created_at: '2026-10-15T00:00:00Z',
  };
  const reviews = decisions.map((decision, i) => ({
    item_kind: 'document',
    item_id: DOC,
    decision,
    created_at: String(i + 1),
  }));
  // A query chain that is awaitable after any number of .eq() calls and
  // also answers .maybeSingle().
  const chain = (rows: unknown[]) => {
    const c: Record<string, unknown> = {
      eq: () => c,
      maybeSingle: () =>
        Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(res, rej),
    };
    return c;
  };
  const download = jest.fn(() =>
    Promise.resolve({
      data: { arrayBuffer: () => Promise.resolve(Buffer.from('%PDF-1.7')) },
      error: null,
    }),
  );
  const admin = {
    from: (t: string) => ({
      select: () =>
        chain(
          t === 'documents'
            ? [docRow]
            : t === 'application_item_reviews'
              ? reviews
              : [],
        ),
    }),
    storage: { from: () => ({ download }) },
  };
  return { supabase: { admin } as never, download };
}

describe('uploadNeedsSignature', () => {
  it('is true for the signed-form slots on any portal prefix', () => {
    expect(uploadNeedsSignature('ircc_upload_representative')).toBe(true);
    expect(uploadNeedsSignature('pr_upload_imm1344')).toBe(true);
    expect(uploadNeedsSignature('pr_upload_imm5532')).toBe(true);
    expect(uploadNeedsSignature('pr_upload_imm5533')).toBe(true);
  });
  it('is false for ordinary upload slots', () => {
    expect(uploadNeedsSignature('ircc_upload_passport')).toBe(false);
    expect(uploadNeedsSignature('ircc_upload_funds')).toBe(false);
    expect(uploadNeedsSignature('ircc_upload_national_id')).toBe(false);
  });
});

describe('PortalDocumentFiles.load for a form that must be signed', () => {
  it('attaches it while the consultant approval stands', async () => {
    const { supabase, download } = fakeSupabase(['approved']);
    const file = await new PortalDocumentFiles(supabase).load(
      'app-1',
      DOC,
      'ircc_upload_representative',
    );
    expect(file).toMatchObject({
      name: 'IMM5476-signed.pdf',
      mimeType: 'application/pdf',
    });
    expect(download).toHaveBeenCalled();
  });

  it('refuses it — never reading the file — when the approval was withdrawn to undecided after the lock', async () => {
    // Approved (what the lock saw), then moved back to undecided.
    const { supabase, download } = fakeSupabase(['approved', 'undecided']);
    const file = await new PortalDocumentFiles(supabase).load(
      'app-1',
      DOC,
      'ircc_upload_representative',
    );
    expect(file).toBeNull();
    expect(download).not.toHaveBeenCalled();
  });

  it('refuses a never-approved copy on a PR signed-form slot', async () => {
    const { supabase } = fakeSupabase([]);
    expect(
      await new PortalDocumentFiles(supabase).load(
        'app-1',
        DOC,
        'pr_upload_imm1344',
      ),
    ).toBeNull();
  });
});

describe('PortalDocumentFiles.load for an ordinary slot', () => {
  it('attaches an undecided (eligible) document — approval is only required for signed forms', async () => {
    const { supabase } = fakeSupabase([]);
    const file = await new PortalDocumentFiles(supabase).load(
      'app-1',
      DOC,
      'ircc_upload_passport',
    );
    expect(file?.name).toBe('IMM5476-signed.pdf');
  });

  it('still refuses a rejected document', async () => {
    const { supabase } = fakeSupabase(['approved', 'rejected']);
    expect(
      await new PortalDocumentFiles(supabase).load(
        'app-1',
        DOC,
        'ircc_upload_passport',
      ),
    ).toBeNull();
  });
});
