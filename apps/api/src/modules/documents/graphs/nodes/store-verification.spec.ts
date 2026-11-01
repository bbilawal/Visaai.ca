import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeStoreVerificationNode } from './store-verification';

interface Call {
  table: string;
  op: string;
  args: unknown[];
}

function makeSupabase() {
  const calls: Call[] = [];
  const from = jest.fn((table: string) => {
    const builder: Record<string, unknown> = {};
    for (const m of ['insert', 'update', 'delete', 'eq', 'in']) {
      builder[m] = jest.fn((...args: unknown[]) => {
        calls.push({ table, op: m, args });
        return builder;
      });
    }
    builder.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: null, error: null });
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, calls };
}

function baseState(over: Partial<DocumentState> = {}): DocumentState {
  return {
    documentId: 'doc-1',
    applicationId: 'app-1',
    storagePath: 'p',
    mimeType: 'application/pdf',
    documentType: 'bank_statement',
    signedUrl: '',
    rawOcrText: 'text',
    extractedFields: { account_holder_name: 'X', bank_name: 'Y' },
    verificationResult: 'pass',
    verificationDetails: [],
    allDocsProcessed: false,
    error: null,
    ...over,
  } as DocumentState;
}

describe('store_verification', () => {
  /**
   * Dry run 2026-10-14: a document whose graph errored showed "Identity ✗ Fail"
   * three times — the processor rethrows so BullMQ retries (attempts: 3), and
   * every attempt appended another identity row. A re-run must REPLACE this
   * pipeline's rows for the document, not add to them.
   */
  it('clears earlier pipeline rows for the document before inserting', async () => {
    const { client, calls } = makeSupabase();

    await makeStoreVerificationNode(client)(baseState({ error: 'OCR failed' }));

    const verifCalls = calls.filter(
      (c) => c.table === 'document_verifications',
    );
    const delIdx = verifCalls.findIndex((c) => c.op === 'delete');
    const insIdx = verifCalls.findIndex((c) => c.op === 'insert');
    expect(delIdx).toBeGreaterThanOrEqual(0);
    expect(delIdx).toBeLessThan(insIdx);
    expect(verifCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ op: 'eq', args: ['document_id', 'doc-1'] }),
        expect.objectContaining({
          op: 'in',
          args: ['verification_type', ['identity', 'duplicate', 'expiry']],
        }),
      ]),
    );
  });

  it('records a content classification and field adjustments on the identity row', async () => {
    const { client, calls } = makeSupabase();

    await makeStoreVerificationNode(client)(
      baseState({
        documentType: 'refusal_letter',
        classifiedFromContent: true,
        fieldAdjustments: { date_of_birth: 'dropped' },
        extractedFields: { full_name: 'Muzaffar Ahmad' },
      }),
    );

    const insert = calls.find(
      (c) => c.table === 'document_verifications' && c.op === 'insert',
    );
    expect(insert?.args[0]).toMatchObject({
      verification_type: 'identity',
      details_json: {
        extracted_fields: { full_name: 'Muzaffar Ahmad' },
        classified_from_content: 'refusal_letter',
        field_adjustments: { date_of_birth: 'dropped' },
      },
    });
  });

  it('omits classification keys when nothing was adjusted', async () => {
    const { client, calls } = makeSupabase();

    await makeStoreVerificationNode(client)(baseState());

    const insert = calls.find(
      (c) => c.table === 'document_verifications' && c.op === 'insert',
    );
    const details = (insert?.args[0] as { details_json: object }).details_json;
    expect(details).not.toHaveProperty('classified_from_content');
    expect(details).not.toHaveProperty('field_adjustments');
  });

  it('records a slot/content mismatch with its message on the identity row (#15)', async () => {
    const { client, calls } = makeSupabase();
    const mismatch = {
      expected: 'previous_travel_evidence',
      detected: 'passport',
      message: 'This looks like a passport bio page.',
    };

    await makeStoreVerificationNode(client)(
      baseState({ slotMismatch: mismatch, verificationResult: 'fail' }),
    );

    const insert = calls.find(
      (c) => c.table === 'document_verifications' && c.op === 'insert',
    );
    expect(insert?.args[0]).toMatchObject({
      verification_type: 'identity',
      result: 'fail',
      details_json: { slot_mismatch: mismatch },
    });
  });
});
