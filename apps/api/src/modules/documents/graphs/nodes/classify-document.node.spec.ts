import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeClassifyDocumentNode } from './classify-document.node';

function makeSupabase(error: { message: string } | null = null) {
  const updates: Array<{ table: string; values: unknown; id: unknown }> = [];
  const from = jest.fn((table: string) => {
    let values: unknown;
    const builder: Record<string, unknown> = {
      update: jest.fn((v: unknown) => {
        values = v;
        return builder;
      }),
      eq: jest.fn((_col: string, id: unknown) => {
        updates.push({ table, values, id });
        return builder;
      }),
      then: (resolve: (v: unknown) => unknown) =>
        resolve({ data: null, error }),
    };
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, updates };
}

function state(over: Partial<DocumentState>): DocumentState {
  return {
    documentId: 'doc-1',
    applicationId: 'app-1',
    documentType: 'document',
    rawOcrText: '',
    extractedFields: {},
    error: null,
    ...over,
  } as DocumentState;
}

const REFUSAL = `Immigration, Refugees and Citizenship Canada
June 30, 2025
Muzaffar Ahmad
IMM 5621 — your application is refused.`;

const CNIC = `National Identity Card
Name
Muzaffar Ahmad
Father Name
Mian Abdul Rasheed EINUY
Identity Number
35202-1234567-1
Date of Birth
15.06.1961`;

describe('classify_document', () => {
  it('re-types a generic IRCC refusal letter and drops its letter-date DOB', async () => {
    const { client, updates } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        rawOcrText: REFUSAL,
        extractedFields: {
          full_name: 'Muzaffar Ahmad',
          date_of_birth: '2025-06-30',
        },
      }),
    );
    expect(out.documentType).toBe('refusal_letter');
    expect(out.classifiedFromContent).toBe(true);
    expect(out.extractedFields?.date_of_birth).toBeUndefined();
    expect(updates).toEqual([
      {
        table: 'documents',
        values: { document_type: 'refusal_letter' },
        id: 'doc-1',
      },
    ]);
  });

  it('re-types a generic CNIC and keeps the holder name, not the father name', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        rawOcrText: CNIC,
        extractedFields: {
          full_name: 'Mian Abdul Rasheed EINUY',
          date_of_birth: '15.06.1961',
        },
      }),
    );
    expect(out.documentType).toBe('national_id');
    expect(out.extractedFields).toEqual({
      full_name: 'Muzaffar Ahmad',
      date_of_birth: '15.06.1961',
      // #34: the card's own number, read from its "Identity Number" label.
      national_id_number: '35202-1234567-1',
    });
    expect(out.fieldAdjustments?.full_name).toBeDefined();
  });

  it('never re-types a document whose slot gave it a type', async () => {
    const { client, updates } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({ documentType: 'medical_exam', rawOcrText: REFUSAL }),
    );
    expect(out.documentType).toBe('medical_exam');
    expect(out.classifiedFromContent).toBe(false);
    expect(updates).toEqual([]);
  });

  it('flags a passport bio page in the previous-travel slot and fails the document (#15)', async () => {
    const { client, updates } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        documentType: 'previous_travel_evidence',
        rawOcrText: `PASSPORT
P<PAKAHMAD<<MUZAFFAR<<<<<<<<<<<<<<<<<<<<<<<<<
AB12345670PAK6106155M3001019<<<<<<<<<<<<<<02`,
        verificationResult: 'pass',
        extractedFields: {
          full_name: 'Muzaffar Ahmad',
          passport_number: 'AB1234567',
        },
      }),
    );
    expect(out.documentType).toBe('previous_travel_evidence');
    expect(out.slotMismatch).toMatchObject({
      expected: 'previous_travel_evidence',
      detected: 'passport',
    });
    expect(out.verificationResult).toBe('fail');
    expect(updates).toEqual([]);
  });

  it('leaves the verification result alone when the content fits the slot', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        documentType: 'national_id',
        rawOcrText: CNIC,
        verificationResult: 'pass',
        extractedFields: { full_name: 'Muzaffar Ahmad' },
      }),
    );
    expect(out.slotMismatch).toBeNull();
    expect(out.verificationResult).toBeUndefined();
    expect(out.extractedFields?.national_id_number).toBe('35202-1234567-1');
  });

  it('still refines fields when the type cannot be persisted', async () => {
    const { client } = makeSupabase({ message: 'boom' });
    const out = await makeClassifyDocumentNode(client)(
      state({
        rawOcrText: REFUSAL,
        extractedFields: { date_of_birth: '2025-06-30' },
      }),
    );
    expect(out.extractedFields?.date_of_birth).toBeUndefined();
  });

  it('does nothing after an upstream error', async () => {
    const { client, updates } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({ error: 'OCR failed', rawOcrText: REFUSAL }),
    );
    expect(out).toEqual({});
    expect(updates).toEqual([]);
  });
});
