import {
  planOrphanLinks,
  linkOrphanDocuments,
  slotStatusFor,
} from './slot-link';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Prod app 61f16bb5 (super visa, 2026-10-16): the applicant's passport and
 * insurance policy were uploaded through "Additional document" because the
 * checklist had no slot for either. Both were classified correctly
 * (`passport`, `medical_insurance`) and stayed unlinked — so when the slots
 * appear, the files must land in them instead of asking for a second upload.
 */
describe('planOrphanLinks', () => {
  const items = [
    {
      id: 'i-pass',
      document_type: 'passport_copy',
      status: 'missing',
      meta: { kind: 'document' },
    },
    {
      id: 'i-ins',
      document_type: 'medical_insurance',
      status: 'missing',
      meta: { kind: 'document' },
    },
    {
      id: 'i-form',
      document_type: 'form_imm_5257',
      status: 'missing',
      meta: { kind: 'form' },
    },
    {
      id: 'i-done',
      document_type: 'proof_of_relationship',
      status: 'verified',
      meta: { kind: 'document' },
    },
  ];

  it('links a classified orphan to the missing slot of the same kind', () => {
    const links = planOrphanLinks(
      [
        { id: 'd-pass', document_type: 'passport', checklist_item_id: null },
        {
          id: 'd-ins',
          document_type: 'medical_insurance',
          checklist_item_id: null,
        },
      ],
      items,
    );
    expect(links).toEqual([
      { documentId: 'd-pass', itemId: 'i-pass' },
      { documentId: 'd-ins', itemId: 'i-ins' },
    ]);
  });

  it('matches through the extraction aliases (health_insurance is the policy)', () => {
    const links = planOrphanLinks(
      [{ id: 'd', document_type: 'health_insurance', checklist_item_id: null }],
      items,
    );
    expect(links).toEqual([{ documentId: 'd', itemId: 'i-ins' }]);
  });

  it('never links an unclassified upload, a linked document, a form or a satisfied slot', () => {
    const links = planOrphanLinks(
      [
        { id: 'generic', document_type: 'document', checklist_item_id: null },
        {
          id: 'linked',
          document_type: 'passport',
          checklist_item_id: 'elsewhere',
        },
        { id: 'form', document_type: 'form_imm_5257', checklist_item_id: null },
        {
          id: 'bc',
          document_type: 'proof_of_relationship',
          checklist_item_id: null,
        },
      ],
      items,
    );
    expect(links).toEqual([]);
  });

  it('fills one slot once, even with two candidate files', () => {
    const links = planOrphanLinks(
      [
        { id: 'p1', document_type: 'passport', checklist_item_id: null },
        { id: 'p2', document_type: 'passport', checklist_item_id: null },
      ],
      items,
    );
    expect(links).toEqual([{ documentId: 'p1', itemId: 'i-pass' }]);
  });

  /**
   * Prod app 61f16bb5 (super visa v2, 2026-10-16): the new medical_insurance
   * slot took "Medical Insurance_compressed.pdf" — a 21st Century policy that
   * expired 2026-05-31 (expiry_status 'fail') — while "DUMMY_insurance.pdf",
   * the policy covering 2027-03-01 → 2028-03-01, stayed unlinked.
   */
  describe('an expired document never wins over a valid one', () => {
    const ins = {
      id: 'i-ins',
      document_type: 'medical_insurance',
      status: 'missing',
      meta: { kind: 'document' },
    };

    it('fills a missing slot with the valid candidate, not the first one', () => {
      const links = planOrphanLinks(
        [
          {
            id: 'expired',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'fail',
          },
          {
            id: 'covering',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'pass',
          },
        ],
        [ins],
      );
      expect(links).toEqual([{ documentId: 'covering', itemId: 'i-ins' }]);
    });

    it('prefers an unchecked file over an expired one', () => {
      const links = planOrphanLinks(
        [
          {
            id: 'expired',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'fail',
          },
          {
            id: 'pending',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: null,
          },
        ],
        [ins],
      );
      expect(links).toEqual([{ documentId: 'pending', itemId: 'i-ins' }]);
    });

    it('still links an expired file to an empty slot when it is all there is', () => {
      // The slot then shows the file and why it fails, instead of "Needed"
      // with the file hidden under "Additional document".
      const links = planOrphanLinks(
        [
          {
            id: 'expired',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'fail',
          },
        ],
        [ins],
      );
      expect(links).toEqual([{ documentId: 'expired', itemId: 'i-ins' }]);
    });

    it('gives a slot whose only file failed expiry the valid orphan (the 61f16bb5 state)', () => {
      const links = planOrphanLinks(
        [
          {
            id: 'expired',
            document_type: 'medical_insurance',
            checklist_item_id: 'i-ins',
            expiry_status: 'fail',
          },
          {
            id: 'covering',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'pass',
          },
        ],
        [{ ...ins, status: 'verified' }],
      );
      expect(links).toEqual([{ documentId: 'covering', itemId: 'i-ins' }]);
    });

    it('does not pile a second expired file onto a slot holding an expired one', () => {
      const links = planOrphanLinks(
        [
          {
            id: 'expired',
            document_type: 'medical_insurance',
            checklist_item_id: 'i-ins',
            expiry_status: 'fail',
          },
          {
            id: 'also-expired',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'fail',
          },
        ],
        [{ ...ins, status: 'uploaded' }],
      );
      expect(links).toEqual([]);
    });

    it('leaves a slot alone once it holds a file that passes', () => {
      const links = planOrphanLinks(
        [
          {
            id: 'good',
            document_type: 'medical_insurance',
            checklist_item_id: 'i-ins',
            expiry_status: 'pass',
          },
          {
            id: 'other',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'pass',
          },
        ],
        [{ ...ins, status: 'verified' }],
      );
      expect(links).toEqual([]);
    });

    it('never touches a waived slot', () => {
      const links = planOrphanLinks(
        [
          {
            id: 'expired',
            document_type: 'medical_insurance',
            checklist_item_id: 'i-ins',
            expiry_status: 'fail',
          },
          {
            id: 'covering',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'pass',
          },
        ],
        [{ ...ins, status: 'waived' }],
      );
      expect(links).toEqual([]);
    });

    it('between two policies the expiry check cannot separate, takes the one covering the stay', () => {
      const stay = { entryDate: '2027-03-01', departureDate: '2028-02-28' };
      const links = planOrphanLinks(
        [
          {
            id: 'short',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'unknown',
            fields: {
              coverage_start_date: '2027-03-01',
              coverage_end_date: '2027-06-01',
            },
          },
          {
            id: 'covering',
            document_type: 'medical_insurance',
            checklist_item_id: null,
            expiry_status: 'unknown',
            fields: {
              coverage_start_date: '2027-03-01',
              coverage_end_date: '2028-03-01',
            },
          },
        ],
        [ins],
        stay,
      );
      expect(links).toEqual([{ documentId: 'covering', itemId: 'i-ins' }]);
    });
  });
});

describe('slotStatusFor', () => {
  const ok = { ocr_status: 'complete', identityPass: true };

  it('is missing with no file', () => {
    expect(slotStatusFor([]).status).toBe('missing');
  });

  it('is verified when a read file passes identity and is in date', () => {
    expect(slotStatusFor([{ ...ok, expiry_status: 'pass' }])).toEqual({
      status: 'verified',
      expiredOnly: false,
    });
  });

  it('is only uploaded when every file failed its expiry check', () => {
    expect(
      slotStatusFor([
        { ...ok, expiry_status: 'fail' },
        { ...ok, expiry_status: 'fail' },
      ]),
    ).toEqual({ status: 'uploaded', expiredOnly: true });
  });

  it('one valid file verifies the slot beside an expired one', () => {
    expect(
      slotStatusFor([
        { ...ok, expiry_status: 'fail' },
        { ...ok, expiry_status: 'pass' },
      ]).status,
    ).toBe('verified');
  });

  it('is uploaded while a file is unread or its identity check did not pass', () => {
    expect(
      slotStatusFor([{ ocr_status: 'pending', identityPass: false }]).status,
    ).toBe('uploaded');
    expect(
      slotStatusFor([{ ocr_status: 'complete', identityPass: false }]).status,
    ).toBe('uploaded');
  });
});

describe('linkOrphanDocuments', () => {
  function fakeDb(opts: {
    documents: Array<Record<string, unknown>>;
    items: Array<Record<string, unknown>>;
    verifications?: Array<Record<string, unknown>>;
    profiles?: Array<Record<string, unknown>>;
  }) {
    const updates: Array<{
      table: string;
      values: Record<string, unknown>;
      id: unknown;
    }> = [];
    const db = {
      from(table: string) {
        const rows =
          table === 'documents'
            ? opts.documents
            : table === 'checklist_items'
              ? opts.items
              : table === 'application_profiles'
                ? (opts.profiles ?? [])
                : (opts.verifications ?? []);
        const b: any = {
          select: () => b,
          eq: () => b,
          in: () => b,
          is: () => b,
          update: (values: Record<string, unknown>) => ({
            eq: (_c: string, id: unknown) => {
              updates.push({ table, values, id });
              const chain: any = {
                eq: () => chain,
                then: (r: any) => Promise.resolve({ error: null }).then(r),
              };
              return chain;
            },
          }),
          then: (r: any) =>
            Promise.resolve({ data: rows, error: null }).then(r),
        };
        return b;
      },
    };
    return { db: db as unknown as SupabaseClient, updates };
  }

  it('links the file and marks the slot verified when its read passed', async () => {
    const { db, updates } = fakeDb({
      documents: [
        {
          id: 'd-pass',
          document_type: 'passport',
          checklist_item_id: null,
          ocr_status: 'complete',
        },
      ],
      items: [
        {
          id: 'i-pass',
          document_type: 'passport_copy',
          status: 'missing',
          meta: { kind: 'document' },
        },
      ],
      verifications: [
        {
          document_id: 'd-pass',
          verification_type: 'identity',
          result: 'pass',
        },
      ],
    });
    await linkOrphanDocuments(db, 'app-1');
    expect(updates).toEqual([
      {
        table: 'documents',
        values: { checklist_item_id: 'i-pass' },
        id: 'd-pass',
      },
      {
        table: 'checklist_items',
        values: { status: 'verified' },
        id: 'i-pass',
      },
    ]);
  });

  it('marks the slot uploaded when the read has not passed', async () => {
    const { db, updates } = fakeDb({
      documents: [
        {
          id: 'd-ins',
          document_type: 'medical_insurance',
          checklist_item_id: null,
          ocr_status: 'pending',
        },
      ],
      items: [
        {
          id: 'i-ins',
          document_type: 'medical_insurance',
          status: 'missing',
          meta: { kind: 'document' },
        },
      ],
    });
    await linkOrphanDocuments(db, 'app-1');
    expect(updates[1]).toEqual({
      table: 'checklist_items',
      values: { status: 'uploaded' },
      id: 'i-ins',
    });
  });

  it('never throws', async () => {
    const db = {
      from: () => {
        throw new Error('down');
      },
    } as unknown as SupabaseClient;
    await expect(linkOrphanDocuments(db, 'app-1')).resolves.toBe(0);
  });

  it('re-homes the 61f16bb5 slot: links the covering policy and keeps the slot verified on it', async () => {
    const { db, updates } = fakeDb({
      documents: [
        {
          id: 'e7db6eec',
          document_type: 'medical_insurance',
          file_name: 'Medical Insurance_compressed.pdf',
          checklist_item_id: 'i-ins',
          ocr_status: 'complete',
          expiry_status: 'fail',
        },
        {
          id: '9b656b36',
          document_type: 'medical_insurance',
          file_name: 'DUMMY_insurance.pdf',
          checklist_item_id: null,
          ocr_status: 'complete',
          expiry_status: 'pass',
        },
      ],
      items: [
        {
          id: 'i-ins',
          document_type: 'medical_insurance',
          status: 'verified',
          meta: { kind: 'document', min_validity_months: 12 },
        },
      ],
      verifications: [
        {
          document_id: 'e7db6eec',
          verification_type: 'identity',
          result: 'pass',
        },
        {
          document_id: 'e7db6eec',
          verification_type: 'expiry',
          result: 'fail',
          details_json: { basis: 'expired' },
        },
        {
          document_id: '9b656b36',
          verification_type: 'identity',
          result: 'pass',
        },
        {
          document_id: '9b656b36',
          verification_type: 'expiry',
          result: 'pass',
          details_json: { basis: 'valid' },
        },
      ],
    });
    await expect(linkOrphanDocuments(db, 'app-1')).resolves.toBe(1);
    // The link, and no checklist write: the slot already reads 'verified',
    // which is now true because of the covering policy.
    expect(updates).toEqual([
      {
        table: 'documents',
        values: { checklist_item_id: 'i-ins' },
        id: '9b656b36',
      },
    ]);
  });

  it('demotes a verified slot whose only file failed expiry, and says why', async () => {
    const { db, updates } = fakeDb({
      documents: [
        {
          id: 'e7db6eec',
          document_type: 'medical_insurance',
          file_name: 'Medical Insurance_compressed.pdf',
          checklist_item_id: 'i-ins',
          ocr_status: 'complete',
          expiry_status: 'fail',
        },
      ],
      items: [
        {
          id: 'i-ins',
          document_type: 'medical_insurance',
          status: 'verified',
          meta: { kind: 'document', min_validity_months: 12 },
        },
      ],
      verifications: [
        {
          document_id: 'e7db6eec',
          verification_type: 'identity',
          result: 'pass',
        },
        {
          document_id: 'e7db6eec',
          verification_type: 'expiry',
          result: 'fail',
          details_json: { basis: 'expired' },
        },
      ],
    });
    await linkOrphanDocuments(db, 'app-1');
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      table: 'checklist_items',
      id: 'i-ins',
      values: {
        status: 'uploaded',
        meta: {
          kind: 'document',
          min_validity_months: 12,
          needs_attention: true,
          attention_source: 'expiry',
        },
      },
    });
    const msg = (updates[0].values.meta as Record<string, unknown>)
      .attention_message as string;
    expect(msg).toContain('Medical Insurance_compressed.pdf');
    expect(msg).toContain('expired');
  });

  it('clears its own expiry notice once a valid file verifies the slot', async () => {
    const { db, updates } = fakeDb({
      documents: [
        {
          id: 'old',
          document_type: 'medical_insurance',
          file_name: 'old.pdf',
          checklist_item_id: 'i-ins',
          ocr_status: 'complete',
          expiry_status: 'fail',
        },
        {
          id: 'new',
          document_type: 'medical_insurance',
          file_name: 'new.pdf',
          checklist_item_id: 'i-ins',
          ocr_status: 'complete',
          expiry_status: 'pass',
        },
      ],
      items: [
        {
          id: 'i-ins',
          document_type: 'medical_insurance',
          status: 'uploaded',
          meta: {
            kind: 'document',
            needs_attention: true,
            attention_message: 'old',
            attention_source: 'expiry',
          },
        },
      ],
      verifications: [
        { document_id: 'old', verification_type: 'identity', result: 'pass' },
        { document_id: 'new', verification_type: 'identity', result: 'pass' },
      ],
    });
    await linkOrphanDocuments(db, 'app-1');
    expect(updates).toEqual([
      {
        table: 'checklist_items',
        values: { status: 'verified', meta: { kind: 'document' } },
        id: 'i-ins',
      },
    ]);
  });

  it("never overwrites another feature's attention notice", async () => {
    const { db, updates } = fakeDb({
      documents: [
        {
          id: 'bc',
          document_type: 'passport',
          file_name: 'p.pdf',
          checklist_item_id: 'i-p',
          ocr_status: 'complete',
          expiry_status: 'fail',
        },
      ],
      items: [
        {
          id: 'i-p',
          document_type: 'passport_copy',
          status: 'verified',
          meta: {
            kind: 'document',
            needs_attention: true,
            attention_message: 'family gap note',
          },
        },
      ],
      verifications: [
        { document_id: 'bc', verification_type: 'identity', result: 'pass' },
      ],
    });
    await linkOrphanDocuments(db, 'app-1');
    expect(updates).toEqual([
      {
        table: 'checklist_items',
        values: { status: 'uploaded' },
        id: 'i-p',
      },
    ]);
  });
});
