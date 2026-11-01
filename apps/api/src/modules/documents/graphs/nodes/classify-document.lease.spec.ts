import type { DocumentState } from '../document.state';
import {
  agreementKind,
  classifyDocumentText,
  refineIdentityFields,
  slotContentMismatch,
} from './classify-document';
import { makeClassifyDocumentNode } from './classify-document.node';
import { makeSyncProfileNode, mergeExtractedIntoProfile } from './sync-profile';
import { DOCUMENT_SOURCES_KEY } from './sync-family';
import { makeFakeDb } from '../../family-gaps/__fixtures__/fake-db';

/**
 * Prod 2026-10-19 (Canada business visitor): two Pakistani shop rent deeds on
 * stamp paper, naming landlord and tenant "S/O" somebody with their CNICs,
 * were filed as `national_id`, and the LANDLORD's CNIC became the applicant's
 * pending national ID number.
 *
 * Every name, number and address below is invented.
 */
const RENT_DEED = `NON JUDICIAL STAMP PAPER
RENT AGREEMENT
This rent agreement is made at Exampleville on 01-03-2024 between
Placeholder Landlord Alpha S/O Placeholder Father One, holder of CNIC No.
11111-2222222-3, resident of House 1, Sample Street, Exampleville
(hereinafter called the LANDLORD / FIRST PARTY)
AND
Placeholder Tenant Beta S/O Placeholder Father Two, holder of CNIC No.
44444-5555555-6, resident of House 2, Sample Road, Exampleville
(hereinafter called the TENANT / SECOND PARTY).
The landlord lets Shop No. 7, Sample Market, to the tenant for a period of
the tenancy of eleven months on a monthly rent of Rs. 25,000 and a security
deposit of Rs. 50,000.
WITNESSES
1. Placeholder Witness One CNIC 77777-8888888-9
2. Placeholder Witness Two CNIC 12121-3434343-5`;

/** The same deed with the parties' CNIC copies scanned onto the last page. */
const RENT_DEED_WITH_CARDS = `${RENT_DEED}
PAKISTAN National Identity Card
Name
Placeholder Landlord Alpha
Father Name
Placeholder Father One
Identity Number
11111-2222222-3
Date of Birth
01.01.1970
Date of Issue
02.02.2020
Date of Expiry
02.02.2030
Holder's Signature`;

/** A bilingual kirayanama, Urdu title and roles, no English title. */
const KIRAYANAMA = `کرایہ نامہ
مالک مکان: Placeholder Landlord Gamma S/O Placeholder Father Three
شناختی کارڈ نمبر 22222-3333333-4
کرایہ دار: Placeholder Tenant Delta S/O Placeholder Father Four
شناختی کارڈ نمبر 55555-6666666-7
گواہ`;

/** An untitled tenancy: both parties, terms and clauses, no card layout. */
const UNTITLED_TENANCY = `This deed is executed on 05-05-2024 between Placeholder Lessor
Epsilon S/O Placeholder Father Five, CNIC 33333-4444444-5 (the lessor), and
Placeholder Lessee Zeta S/O Placeholder Father Six, CNIC 66666-7777777-8
(the lessee), for the premises at Plot 9, Sample Bazaar.
In witness whereof the parties have signed before the witnesses.`;

/** Some other deed between two parties that quotes their identity cards. */
const PARTNERSHIP_DEED = `PARTNERSHIP DEED
This deed is made between Placeholder Partner Eta S/O Placeholder Father
Seven, Identity Card No. 13131-2424242-1 (hereinafter the first party) and
Placeholder Partner Theta S/O Placeholder Father Eight, Identity Card No.
35353-4646464-2 (hereinafter the second party).
Witnesses: 1. ____ 2. ____`;

/** A partnership deed that quotes no CNIC beside "S/O" at all. */
const DEED_NO_CNIC = `PARTNERSHIP DEED
This deed is made between Placeholder Partner Lambda (hereinafter the first
party) and Placeholder Partner Mu (hereinafter the second party), who agree
to carry on business together at Sample Market, Exampleville. The first party
shall contribute the shop fittings and the second party the stock in trade.
Witnesses: 1. Placeholder Witness Three 2. Placeholder Witness Four`;

/** A bank statement with a rent line (negative case). */
const BANK_STATEMENT_WITH_RENT = `SAMPLE BANK LIMITED
Account Statement
Account Title: Placeholder Customer Nu
Account No: 0000123456789
Opening Balance 120,000.00
02-03-2024 RENT AGREEMENT FEE 1,500.00
05-03-2024 Monthly rent received 25,000.00
Closing Balance 143,500.00`;

/** An invitation letter that mentions a lease (negative case). */
const INVITATION_WITH_LEASE = `Sample Trading Inc.
Dear Placeholder Visitor Xi,
We invite you to visit our office in Exampletown, Canada, to review the
new showroom. We have signed a lease agreement for premises on Sample
Avenue and would like your input on the fit-out.
Sincerely, Placeholder Host Omicron`;

/** Parties named only by name — no "landlord" / "tenant" (review R1). */
const NAMED_PARTIES_RENT = `RENT AGREEMENT Placeholder Owner Pi S/O Placeholder Father Ten CNIC No
11111-1111111-1 lets shop no 4 to Placeholder Renter Rho S/O Placeholder
Father Eleven CNIC No 22222-2222222-2 monthly rent of Rs 50000.
Witness 1 Witness 2`;

/** A shop owner and tenant, no other clause. */
const SHOP_OWNER_RENT = `Rent Agreement
Shop owner: Placeholder Owner Sigma S/O Placeholder Father Twelve
Tenant: Placeholder Renter Tau S/O Placeholder Father Thirteen`;

/** A real-looking CNIC scan (invented values). */
const CNIC_CARD = `PAKISTAN National Identity Card
Name
Placeholder Person Iota
Father Name
Placeholder Father Nine
Gender M Country of Stay Pakistan
Identity Number
99999-8888888-7
Date of Birth
03.04.1985
Date of Issue
05.06.2019
Date of Expiry
05.06.2029`;

const LANDLORD_READ = {
  full_name: 'Placeholder Landlord Alpha',
  date_of_birth: '1970-01-01',
  national_id_number: '11111-2222222-3',
  issue_date: '2020-02-02',
  expiry_date: '2030-02-02',
};

describe('agreementKind', () => {
  it.each([
    ['an English rent agreement', RENT_DEED],
    [
      'a rent deed with the parties’ CNIC copies attached',
      RENT_DEED_WITH_CARDS,
    ],
    ['an Urdu kirayanama', KIRAYANAMA],
    ['an untitled lease between lessor and lessee', UNTITLED_TENANCY],
  ])('recognises %s as a lease', (_label, text) => {
    expect(agreementKind(text)).toBe('lease_agreement');
  });

  it('recognises another deed between a first and second party', () => {
    expect(agreementKind(PARTNERSHIP_DEED)).toBe('agreement');
  });

  it('never takes an identity card for an agreement', () => {
    expect(agreementKind(CNIC_CARD)).toBeNull();
    expect(agreementKind('')).toBeNull();
    expect(agreementKind(null)).toBeNull();
  });

  it('needs more than a passing "tenant" on an identity card', () => {
    expect(
      agreementKind(`${CNIC_CARD}\nlandlord tenant witness first party`),
    ).toBeNull();
  });
});

describe('classifyDocumentText — a mention of a lease is not a lease', () => {
  it('keeps a bank statement with a rent agreement fee a bank statement', () => {
    expect(agreementKind(BANK_STATEMENT_WITH_RENT)).toBeNull();
    expect(classifyDocumentText(BANK_STATEMENT_WITH_RENT)).toBe(
      'bank_statement',
    );
  });

  it('does not take an invitation letter mentioning a lease for one', () => {
    expect(agreementKind(INVITATION_WITH_LEASE)).toBeNull();
    expect(classifyDocumentText(INVITATION_WITH_LEASE)).not.toBe(
      'lease_agreement',
    );
  });
});

describe('classifyDocumentText — agreements are not ID cards', () => {
  it('files a rent deed as lease_agreement, not national_id', () => {
    expect(classifyDocumentText(RENT_DEED)).toBe('lease_agreement');
    expect(classifyDocumentText(RENT_DEED_WITH_CARDS)).toBe('lease_agreement');
    expect(classifyDocumentText(KIRAYANAMA)).toBe('lease_agreement');
  });

  it('files another two-party deed quoting identity cards as agreement', () => {
    expect(classifyDocumentText(PARTNERSHIP_DEED)).toBe('agreement');
  });

  it('files a rent agreement naming its parties only by name as a lease (R1)', () => {
    // Standalone it is not enough for a lease…
    expect(agreementKind(NAMED_PARTIES_RENT)).toBeNull();
    // …but against an identity card, the title and its terms settle it.
    expect(agreementKind(NAMED_PARTIES_RENT, { againstIdCard: true })).toBe(
      'lease_agreement',
    );
    expect(classifyDocumentText(NAMED_PARTIES_RENT)).toBe('lease_agreement');
  });

  it('takes a shop owner as the landlord', () => {
    expect(agreementKind(SHOP_OWNER_RENT)).toBe('lease_agreement');
    expect(classifyDocumentText(SHOP_OWNER_RENT)).toBe('lease_agreement');
  });

  it('still files the card itself as national_id', () => {
    expect(classifyDocumentText(CNIC_CARD)).toBe('national_id');
  });
});

describe('refineIdentityFields — an agreement yields no identity', () => {
  it('drops everything quoted from the parties', () => {
    const r = refineIdentityFields('lease_agreement', RENT_DEED_WITH_CARDS, {
      ...LANDLORD_READ,
      sex: 'M',
    });
    expect(r.fields).toEqual({});
    expect(r.adjustments.national_id_number).toMatch(/agreement/);
    expect(r.adjustments.date_of_birth).toMatch(/agreement/);
  });

  it('keeps fields that are not identity', () => {
    const r = refineIdentityFields('lease_agreement', RENT_DEED, {
      property_address: 'Shop No. 7, Sample Market',
    });
    expect(r.fields).toEqual({ property_address: 'Shop No. 7, Sample Market' });
  });

  it('guards a still ID-typed lease too', () => {
    const r = refineIdentityFields('national_id', RENT_DEED, LANDLORD_READ);
    expect(r.fields.national_id_number).toBeUndefined();
    expect(r.fields.full_name).toBeUndefined();
  });

  it('leaves a real ID card alone', () => {
    const read: Record<string, unknown> = {
      full_name: 'Placeholder Person Iota',
    };
    const r = refineIdentityFields('national_id', CNIC_CARD, read);
    expect(r.fields.national_id_number).toBe('99999-8888888-7');
    expect(r.fields.full_name).toBe('Placeholder Person Iota');
  });
});

describe('slotContentMismatch — a lease in a slot', () => {
  it('fails a lease in the national ID slot', () => {
    const m = slotContentMismatch('national_id', RENT_DEED);
    expect(m?.detected).toBe('lease_agreement');
    expect(m?.message).toMatch(/rent or lease agreement/);
  });

  it.each([
    'proof_of_business_premises',
    'property_document',
    'proof_of_funds',
    'proof_of_ties',
  ])('accepts a lease in %s', (slot) => {
    expect(slotContentMismatch(slot, RENT_DEED)).toBeNull();
  });
});

// ─── The graph node ──────────────────────────────────────────────────────────

function state(over: Partial<DocumentState>): DocumentState {
  return {
    documentId: 'doc-lease',
    applicationId: 'app-1',
    documentType: 'document',
    rawOcrText: '',
    extractedFields: {},
    error: null,
    ...over,
  } as DocumentState;
}

describe('classify_document node — rent deeds (prod 2026-10-19)', () => {
  it('re-types an "Additional document" lease and keeps no identity', async () => {
    const fake = makeFakeDb({ documents: [{ id: 'doc-lease' }] });
    const out = await makeClassifyDocumentNode(fake.client)(
      state({ rawOcrText: RENT_DEED, extractedFields: { ...LANDLORD_READ } }),
    );
    expect(out.documentType).toBe('lease_agreement');
    expect(out.extractedFields).toEqual({});
    expect(out.slotMismatch).toBeNull();
    expect(fake.tables.documents[0].document_type).toBe('lease_agreement');
  });

  it('corrects a lease misfiled as national_id on re-read (stored type kept by the job)', async () => {
    const fake = makeFakeDb({
      documents: [{ id: 'doc-lease', checklist_item_id: null }],
    });
    const out = await makeClassifyDocumentNode(fake.client)(
      state({
        documentType: 'national_id',
        rawOcrText: RENT_DEED_WITH_CARDS,
        extractedFields: { ...LANDLORD_READ },
      }),
    );
    expect(out.documentType).toBe('lease_agreement');
    expect(out.classifiedFromContent).toBe(true);
    expect(out.extractedFields?.national_id_number).toBeUndefined();
    expect(out.slotMismatch).toBeNull();
    expect(fake.tables.documents[0].document_type).toBe('lease_agreement');
  });

  it('fails a lease uploaded into the national ID slot', async () => {
    const fake = makeFakeDb({
      documents: [{ id: 'doc-lease', checklist_item_id: 'item-id' }],
      checklist_items: [{ id: 'item-id', document_type: 'national_id' }],
    });
    const out = await makeClassifyDocumentNode(fake.client)(
      state({
        documentType: 'national_id',
        rawOcrText: RENT_DEED,
        extractedFields: { ...LANDLORD_READ },
      }),
    );
    expect(out.documentType).toBe('lease_agreement');
    expect(out.slotMismatch?.expected).toBe('national_id');
    expect(out.verificationResult).toBe('fail');
    expect(out.extractedFields?.national_id_number).toBeUndefined();
  });

  it('re-types a named-parties rent agreement stored as national_id (R1)', async () => {
    const fake = makeFakeDb({
      documents: [{ id: 'doc-lease', checklist_item_id: null }],
    });
    const out = await makeClassifyDocumentNode(fake.client)(
      state({
        documentType: 'national_id',
        rawOcrText: NAMED_PARTIES_RENT,
        extractedFields: { national_id_number: '11111-1111111-1' },
      }),
    );
    expect(out.documentType).toBe('lease_agreement');
    expect(out.extractedFields?.national_id_number).toBeUndefined();
  });

  it('fails a deed with no CNIC beside S/O in the national ID slot', async () => {
    expect(agreementKind(DEED_NO_CNIC)).toBe('agreement');
    // Re-detection from the text alone would not flag it.
    expect(slotContentMismatch('national_id', DEED_NO_CNIC)).toBeNull();
    const fake = makeFakeDb({
      documents: [{ id: 'doc-lease', checklist_item_id: 'item-id' }],
      checklist_items: [{ id: 'item-id', document_type: 'national_id' }],
    });
    const out = await makeClassifyDocumentNode(fake.client)(
      state({
        documentType: 'national_id',
        rawOcrText: DEED_NO_CNIC,
        verificationResult: 'warn',
      }),
    );
    expect(out.documentType).toBe('agreement');
    expect(out.slotMismatch?.detected).toBe('agreement');
    expect(out.slotMismatch?.message).toMatch(
      /an agreement between two parties.*national id/,
    );
    expect(out.verificationResult).toBe('fail');
  });

  it('fails closed when the upload slot cannot be read', async () => {
    // No documents row: the lookup fails, and the stored ID type stands in.
    const fake = makeFakeDb({});
    const out = await makeClassifyDocumentNode(fake.client)(
      state({
        documentType: 'national_id',
        rawOcrText: DEED_NO_CNIC,
        verificationResult: 'warn',
      }),
    );
    expect(out.documentType).toBe('agreement');
    expect(out.slotMismatch?.expected).toBe('national_id');
    expect(out.verificationResult).toBe('fail');
  });

  it('leaves a real CNIC in the national ID slot as it was', async () => {
    const fake = makeFakeDb({ documents: [{ id: 'doc-lease' }] });
    const out = await makeClassifyDocumentNode(fake.client)(
      state({
        documentType: 'national_id',
        rawOcrText: CNIC_CARD,
        extractedFields: { full_name: 'Placeholder Person Iota' },
      }),
    );
    expect(out.documentType).toBe('national_id');
    expect(out.classifiedFromContent).toBe(false);
    expect(out.extractedFields?.national_id_number).toBe('99999-8888888-7');
    expect(fake.writes).toEqual([]);
  });
});

describe('sync_profile — a re-read lease retracts its earlier misread', () => {
  it('forgets the values the ID-card misread wrote, keeps the applicant’s own', async () => {
    const fake = makeFakeDb({
      application_profiles: [
        {
          application_id: 'app-1',
          profile_json: {
            national_id_number: '11111-2222222-3',
            full_name: 'Placeholder Applicant Kappa',
            [DOCUMENT_SOURCES_KEY]: {
              national_id_number: {
                document_id: 'doc-lease',
                document_type: 'national_id',
                value: '11111-2222222-3',
              },
            },
          },
        },
      ],
    });
    await makeSyncProfileNode(fake.client)(
      state({
        documentType: 'lease_agreement',
        rawOcrText: RENT_DEED,
        extractedFields: {},
      }),
    );
    const p = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(p.national_id_number).toBeNull();
    expect(p.full_name).toBe('Placeholder Applicant Kappa');
    expect(p[DOCUMENT_SOURCES_KEY]).toEqual({});
  });

  it('still merges what the agreement legitimately carries', async () => {
    const fake = makeFakeDb({
      application_profiles: [
        {
          application_id: 'app-1',
          profile_json: {
            national_id_number: '11111-2222222-3',
            [DOCUMENT_SOURCES_KEY]: {
              national_id_number: {
                document_id: 'doc-lease',
                document_type: 'national_id',
                value: '11111-2222222-3',
              },
            },
          },
        },
      ],
    });
    await makeSyncProfileNode(fake.client)(
      state({
        documentType: 'lease_agreement',
        rawOcrText: RENT_DEED,
        extractedFields: { employer: 'Sample Traders' },
      }),
    );
    const p = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(p.national_id_number).toBeNull();
    expect(p.employer_name).toBe('Sample Traders');
  });

  it("never fills the owned-property Ties keys from a lease's premises", async () => {
    const fake = makeFakeDb({
      application_profiles: [{ application_id: 'app-1', profile_json: {} }],
    });
    await makeSyncProfileNode(fake.client)(
      state({
        documentType: 'lease_agreement',
        rawOcrText: RENT_DEED,
        extractedFields: {
          property_address: 'Shop No. 7, Sample Market',
          property_type: 'shop',
        },
      }),
    );
    const p = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(p.property_address).toBeUndefined();
    expect(p.property_type).toBeUndefined();
    // A property document still fills them.
    expect(
      mergeExtractedIntoProfile(
        {},
        { property_address: 'Plot 1, Sample Town' },
        'property_document',
      ).next.property_address,
    ).toBe('Plot 1, Sample Town');
  });

  it('writes nothing when the lease never wrote anything', async () => {
    const fake = makeFakeDb({
      application_profiles: [
        { application_id: 'app-1', profile_json: { full_name: 'X Y' } },
      ],
    });
    await makeSyncProfileNode(fake.client)(
      state({ documentType: 'lease_agreement', rawOcrText: RENT_DEED }),
    );
    expect(fake.writes).toEqual([]);
  });
});

describe('slotContentMismatch — a sponsor\'s Canadian passport as proof of status', () => {
  it('is accepted in proof_of_status, still flagged in an unrelated slot', () => {
    const MRZ = 'P<CANTEST<<SARA<<<<<<<<<<<<<<<<<<<<<<<<<<<<<';
    expect(slotContentMismatch('proof_of_status', MRZ)).toBeNull();
    expect(slotContentMismatch('bank_statement', MRZ)).not.toBeNull();
  });
});
