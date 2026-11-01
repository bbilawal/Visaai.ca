import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeSyncChecklistNode } from './sync-checklist';
import { linkOrphanDocuments } from '../../slot-link';

jest.mock('../../slot-link', () => ({
  linkOrphanDocuments: jest.fn().mockResolvedValue(1),
}));

/**
 * A file uploaded to "Additional document" and recognised from its text
 * (passport, insurance policy) must land in its slot when one exists — prod
 * app 61f16bb5 left both unlinked while their slots read "Needed".
 */
function db(): SupabaseClient {
  const b: any = {
    select: () => b,
    eq: () => b,
    in: () => b,
    update: () => b,
    single: () => b,
    then: (r: any) => Promise.resolve({ data: [], error: null }).then(r),
  };
  return { from: () => b } as unknown as SupabaseClient;
}

const base = {
  documentId: 'doc-1',
  applicationId: 'app-1',
  documentType: 'passport',
  verificationResult: 'pass',
  slotMismatch: null,
  error: null,
} as unknown as DocumentState;

describe('sync_checklist — orphan documents', () => {
  beforeEach(() => jest.mocked(linkOrphanDocuments).mockClear());

  it('links unlinked, classified documents to their slots', async () => {
    await makeSyncChecklistNode(db())(base);
    expect(linkOrphanDocuments).toHaveBeenCalledWith(
      expect.anything(),
      'app-1',
    );
  });

  it('does not link a document whose processing failed', async () => {
    await makeSyncChecklistNode(db())({
      ...base,
      error: 'OCR failed',
    });
    expect(linkOrphanDocuments).not.toHaveBeenCalled();
  });
});
