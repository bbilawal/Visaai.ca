import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { makeClassifyDocumentNode } from './classify-document.node';
import {
  CNIC_SPOUSE,
  NIKAH_NAMA,
  PUNJAB_BIRTH_CERT_BILAWAL,
} from '../../ocr/__fixtures__/civil-records.fixtures';

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

  /**
   * Dry run 2026-10-15: a NADRA birth registration certificate dropped into
   * the sponsor's proof-of-relationship slot was stored as
   * `sponsor_proof_of_relationship`, so nothing downstream knew it was a
   * birth certificate.
   */
  describe('civil records in relationship slots', () => {
    it('stores a birth certificate in a relationship slot as birth_certificate', async () => {
      const { client, updates } = makeSupabase();
      const out = await makeClassifyDocumentNode(client)(
        state({
          documentType: 'sponsor_proof_of_relationship',
          rawOcrText: PUNJAB_BIRTH_CERT_BILAWAL,
          verificationResult: 'pass',
        }),
      );
      expect(out.documentType).toBe('birth_certificate');
      expect(out.classifiedFromContent).toBe(true);
      expect(out.slotMismatch).toBeNull();
      expect(out.verificationResult).toBeUndefined();
      // Only the type changes: the document stays linked to its slot.
      expect(updates).toEqual([
        {
          table: 'documents',
          values: { document_type: 'birth_certificate' },
          id: 'doc-1',
        },
      ]);
    });

    it('stores a nikah nama in a family-documents slot as marriage_certificate', async () => {
      const { client, updates } = makeSupabase();
      const out = await makeClassifyDocumentNode(client)(
        state({
          documentType: 'proof_of_relationship',
          rawOcrText: NIKAH_NAMA,
        }),
      );
      expect(out.documentType).toBe('marriage_certificate');
      expect(updates[0].values).toEqual({
        document_type: 'marriage_certificate',
      });
    });

    it('still re-types a civil record uploaded as a generic document', async () => {
      const { client } = makeSupabase();
      const out = await makeClassifyDocumentNode(client)(
        state({ rawOcrText: PUNJAB_BIRTH_CERT_BILAWAL }),
      );
      expect(out.documentType).toBe('birth_certificate');
    });

    it('leaves a relationship slot holding an identity card alone (#101)', async () => {
      const { client, updates } = makeSupabase();
      const out = await makeClassifyDocumentNode(client)(
        state({
          documentType: 'sponsor_proof_of_relationship',
          rawOcrText: CNIC_SPOUSE,
        }),
      );
      expect(out.documentType).toBe('sponsor_proof_of_relationship');
      expect(out.slotMismatch).toBeNull();
      expect(updates).toEqual([]);
    });

    it('never re-types a narrow slot: a birth certificate in the bank-statement slot keeps that type', async () => {
      const { client, updates } = makeSupabase();
      const out = await makeClassifyDocumentNode(client)(
        state({
          documentType: 'bank_statement',
          rawOcrText: PUNJAB_BIRTH_CERT_BILAWAL,
        }),
      );
      expect(out.documentType).toBe('bank_statement');
      expect(updates).toEqual([]);
    });

    it('keeps an already-civil type unchanged', async () => {
      const { client, updates } = makeSupabase();
      const out = await makeClassifyDocumentNode(client)(
        state({
          documentType: 'birth_certificate',
          rawOcrText: PUNJAB_BIRTH_CERT_BILAWAL,
        }),
      );
      expect(out.documentType).toBe('birth_certificate');
      expect(out.classifiedFromContent).toBe(false);
      expect(updates).toEqual([]);
    });
  });
});

describe('classify_document — readable supporting documents (super visa, 2026-10-16)', () => {
  // Prod app 61f16bb5: the host's 4,305-character invitation letter got
  // "identity ✗ Fail" because the grade counts extracted IDENTITY fields and a
  // letter has none; the host's T4 got "warn" for having one. Neither is an
  // identity document, so neither slot could ever reach "verified" and the
  // counter stuck at "2 of 6" while the slot badge said Verified.
  const LETTER = `To the Visa Officer, High Commission of Canada.
I, Mian Muhammad Sajawal, a Canadian citizen living in Milton, Ontario, invite my
mother Sumera Ahmad to visit me under the parent and grandparent super visa.
My family size is 4: myself, my spouse and our two children, listed below with
dates of birth. I meet the minimum necessary income for a family of 5.`;

  it('grades a readable host letter in its own slot as pass', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        documentType: 'host_letter_of_invitation',
        rawOcrText: LETTER,
        extractedFields: {},
        verificationResult: 'fail',
      }),
    );
    expect(out.verificationResult).toBe('pass');
  });

  it('grades the host T4 (one name field) as pass, not an identity warning', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        documentType: 'income_proof_option_one',
        rawOcrText: `${LETTER} Statement of Remuneration Paid T4 2024 employment income 98,000`,
        extractedFields: { full_name: 'SAJAWAL, MIAN MUHAMMAD' },
        verificationResult: 'warn',
      }),
    );
    expect(out.verificationResult).toBe('pass');
  });

  it('does not upgrade an identity document that yielded no fields', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        documentType: 'passport_copy',
        rawOcrText: LETTER,
        extractedFields: {},
        verificationResult: 'fail',
      }),
    );
    expect(out.verificationResult).toBeUndefined();
  });

  it('does not upgrade a near-empty read', async () => {
    const { client } = makeSupabase();
    const out = await makeClassifyDocumentNode(client)(
      state({
        documentType: 'host_letter_of_invitation',
        rawOcrText: 'blurry',
        extractedFields: {},
        verificationResult: 'fail',
      }),
    );
    expect(out.verificationResult).toBeUndefined();
  });
});
