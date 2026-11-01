import {
  applyConsistencyFlags,
  CONSISTENCY_FLAGS_KEY,
  DOCUMENT_SOURCES_KEY,
  familyConsistencyFlags,
  mergeFamilyDocument,
  type FamilyMergeInput,
} from './sync-family';
import { refineIdentityFields } from './classify-document';
import {
  CNIC_APPLICANT,
  CNIC_SPOUSE,
  NIKAH_NAMA,
  ONTARIO_BIRTH_CERT,
  PUNJAB_BIRTH_CERT_GRANDCHILD,
  PUNJAB_BIRTH_CERTS_TWO_CHILDREN,
} from '../../ocr/__fixtures__/civil-records.fixtures';

/**
 * Dry run 2026-10-15: a Pakistani father (the applicant) visiting Canada
 * uploaded both sons' NADRA birth certificates in one PDF, his nikah nama and
 * his wife's CNIC. None of the children's dates of birth reached the profile
 * and the marriage date was stored as "16-9-1999".
 */
function input(
  documentType: string,
  rawText: string,
  profile: Record<string, unknown>,
  extracted: Record<string, string | number> = {},
  extra: Partial<FamilyMergeInput> = {},
): FamilyMergeInput {
  // What classify_document hands sync_profile: provider fields refined
  // against the same text.
  const refined = refineIdentityFields(documentType, rawText, extracted).fields;
  return {
    profile,
    documentId: 'doc-1',
    documentType,
    rawText,
    extracted: refined,
    ...extra,
  };
}

const FATHER = { full_name: 'Muzaffar Ahmad', marital_status: 'married' };

describe('birth certificates → children', () => {
  it('adds both sons from one upload, each with DOB, sex, relationship and country', () => {
    const { handled, next } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, FATHER),
    );
    expect(handled).toBe(true);
    expect(next.children).toEqual([
      {
        name: 'MIAN MUHAMMAD SAJAWAL',
        date_of_birth: '1989-10-14',
        sex: 'Male',
        relationship: 'son',
        country_of_birth: 'Pakistan',
        place_of_birth: 'RAWALPINDI',
      },
      {
        name: 'MIAN MUHAMMAD BILAWAL',
        date_of_birth: '1989-10-14',
        sex: 'Male',
        relationship: 'son',
        country_of_birth: 'Pakistan',
        place_of_birth: 'RAWALPINDI',
      },
    ]);
  });

  it("NEVER fills the applicant's own DOB or parents from a child's certificate", () => {
    const { next } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, FATHER, {
        full_name: 'MIAN MUHAMMAD SAJAWAL',
        date_of_birth: '1989-10-14',
      }),
    );
    expect(next.date_of_birth).toBeUndefined();
    expect(next.father_name).toBeUndefined();
    expect(next.mother_name).toBeUndefined();
  });

  it('merges by name into the children intake already has, never overwriting an answer', () => {
    const { next } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, {
        ...FATHER,
        children: [
          // The applicant typed a different DOB: his answer stands.
          { name: 'Sajawal', occupation: 'Engineer', dob: '1989-10-15' },
        ],
      }),
    );
    expect(next.children).toEqual([
      {
        name: 'Sajawal',
        occupation: 'Engineer',
        dob: '1989-10-15',
        sex: 'Male',
        relationship: 'son',
        country_of_birth: 'Pakistan',
        place_of_birth: 'RAWALPINDI',
      },
      expect.objectContaining({
        name: 'MIAN MUHAMMAD BILAWAL',
        date_of_birth: '1989-10-14',
      }),
    ]);
  });

  it('treats the mother as the applicant just the same', () => {
    const { next } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, {
        full_name: 'Sumera Ahmad',
      }),
    );
    expect((next.children as unknown[]).length).toBe(2);
  });

  it("matches a parent by CNIC when the profile's name is written differently", () => {
    const { next } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, {
        full_name: 'M. Muzaffar',
        national_id_number: '37405-5309209-7',
      }),
    );
    expect((next.children as unknown[]).length).toBe(2);
  });

  it("does not add a grandchild — the parents are the applicant's son and daughter-in-law", () => {
    const { handled, next, added } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERT_GRANDCHILD, {
        ...FATHER,
        spouse_name: 'Sumera Ahmad',
      }),
    );
    expect(handled).toBe(true);
    expect(next.children).toBeUndefined();
    expect(added).toEqual([]);
  });

  it('adds nothing when the parents cannot be checked against anyone', () => {
    const { next } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, {}),
    );
    expect(next.children).toBeUndefined();
    expect(next.date_of_birth).toBeUndefined();
  });

  it('enriches a child intake named from a certificate that prints no parents', () => {
    const named = mergeFamilyDocument(
      input('birth_certificate', ONTARIO_BIRTH_CERT, {
        ...FATHER,
        children: [{ name: 'Farhana Choudhry', relationship: 'daughter' }],
      }),
    );
    expect(named.next.children).toEqual([
      expect.objectContaining({
        name: 'Farhana Choudhry',
        date_of_birth: '1995-09-02',
        country_of_birth: 'Canada',
        given_name: 'FARHANA ARSHED',
        family_name: 'CHOUDHRY',
      }),
    ]);

    // …but never invents a child from it.
    const unnamed = mergeFamilyDocument(
      input('birth_certificate', ONTARIO_BIRTH_CERT, FATHER),
    );
    expect(unnamed.next.children).toBeUndefined();
  });

  it("fills the applicant's own fields from the applicant's own certificate", () => {
    const { next } = mergeFamilyDocument(
      input('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, {
        full_name: 'Mian Muhammad Sajawal',
      }),
    );
    expect(next).toMatchObject({
      date_of_birth: '1989-10-14',
      father_name: 'MUZAFFAR AHMAD',
      mother_name: 'SUMERA AHMAD',
      country_of_birth: 'Pakistan',
    });
    // His twin is his BROTHER, not his child.
    expect(next.children).toBeUndefined();
  });

  it('recognises a birth certificate in a broad slot by its text', () => {
    const { handled, next } = mergeFamilyDocument(
      input('proof_of_relationship', PUNJAB_BIRTH_CERTS_TWO_CHILDREN, FATHER),
    );
    expect(handled).toBe(true);
    expect((next.children as unknown[]).length).toBe(2);
  });
});

describe('marriage certificate → marriage date and spouse', () => {
  it('stores the labelled English date and the bride as the spouse', () => {
    const { next, added } = mergeFamilyDocument(
      input('marriage_certificate', NIKAH_NAMA, FATHER, {
        marriage_date: '16-9-1999',
      }),
    );
    expect(next.marriage_date).toBe('1988-09-16');
    expect(next.spouse_name).toBe('Sumera Bano');
    expect(added).toEqual(
      expect.arrayContaining(['marriage_date', 'spouse_name']),
    );
    expect(
      (next[DOCUMENT_SOURCES_KEY] as Record<string, unknown>).marriage_date,
    ).toEqual({
      document_id: 'doc-1',
      document_type: 'marriage_certificate',
      value: '1988-09-16',
    });
  });

  it('does not fill full_name or date_of_birth from a marriage certificate', () => {
    const { next } = mergeFamilyDocument(
      input(
        'marriage_certificate',
        NIKAH_NAMA,
        {},
        {
          full_name: 'Muzaffar Ahmad',
          date_of_birth: '1963-01-01',
        },
      ),
    );
    expect(next.date_of_birth).toBeUndefined();
  });

  it('corrects a marriage date an earlier document read wrote', () => {
    const { next, notes } = mergeFamilyDocument(
      input('marriage_certificate', NIKAH_NAMA, {
        ...FATHER,
        marriage_date: '16-9-1999',
        [DOCUMENT_SOURCES_KEY]: {
          marriage_date: {
            document_id: 'doc-0',
            document_type: 'marriage_certificate',
            value: '16-9-1999',
          },
        },
      }),
    );
    expect(next.marriage_date).toBe('1988-09-16');
    expect(notes.join(' ')).toMatch(/16-9-1999/);
  });

  it('corrects a legacy document value that predates provenance', () => {
    const { next } = mergeFamilyDocument(
      input(
        'marriage_certificate',
        NIKAH_NAMA,
        { ...FATHER, marriage_date: '16-9-1999' },
        {},
        { priorDocumentMarriageDates: ['16-9-1999'] },
      ),
    );
    expect(next.marriage_date).toBe('1988-09-16');
  });

  it('NEVER overwrites a marriage date the applicant gave', () => {
    const { next, skipped } = mergeFamilyDocument(
      input('marriage_certificate', NIKAH_NAMA, {
        ...FATHER,
        marriage_date: '1988-09-17',
        // A document wrote something else earlier; the applicant then
        // answered — the stored value is no longer the document's.
        [DOCUMENT_SOURCES_KEY]: {
          marriage_date: {
            document_id: 'doc-0',
            document_type: 'marriage_certificate',
            value: '16-9-1999',
          },
        },
      }),
    );
    expect(next.marriage_date).toBe('1988-09-17');
    expect(skipped).toContain('marriage_date');
  });

  it("ignores a son's marriage certificate", () => {
    const sons = NIKAH_NAMA.replace(
      'Muzaffar Ahmad S/O Mian Abdul Rashid',
      'Mian Muhammad Bilawal S/O Muzaffar Ahmad',
    ).replace('Sumera Bano D/O Mohammad Ali', 'Farhana Choudhry D/O Arshed');
    const { handled, next } = mergeFamilyDocument(
      input('marriage_certificate', sons, FATHER),
    );
    expect(handled).toBe(true);
    expect(next.marriage_date).toBeUndefined();
    expect(next.spouse_name).toBeUndefined();
  });

  it('recognises the applicant as the bride under her maiden name via the spouse', () => {
    const { next } = mergeFamilyDocument(
      input('marriage_certificate', NIKAH_NAMA, {
        full_name: 'Sumera Ahmad',
        spouse_name: 'Muzaffar Ahmad',
      }),
    );
    expect(next.marriage_date).toBe('1988-09-16');
  });
});

describe("spouse's identity card → spouse_date_of_birth", () => {
  const spouseCard = {
    full_name: 'Sumera Ahmad',
    date_of_birth: '09.10.1968',
    national_id_number: '37405-0486358-2',
  };

  it("files the wife's DOB as the spouse's, never as the applicant's", () => {
    const { handled, next } = mergeFamilyDocument(
      input('national_id', CNIC_SPOUSE, FATHER, spouseCard),
    );
    expect(handled).toBe(true);
    expect(next).toMatchObject({
      spouse_date_of_birth: '1968-10-09',
      spouse_name: 'Sumera Ahmad',
      spouse_national_id_number: '37405-0486358-2',
    });
    expect(next.date_of_birth).toBeUndefined();
    expect(next.national_id_number).toBeUndefined();
  });

  it('recognises the spouse by spouse_name too', () => {
    const { next } = mergeFamilyDocument(
      input(
        'national_id',
        CNIC_SPOUSE.replace('Husband Name\nMuzaffar Ahmad\n', ''),
        { ...FATHER, spouse_name: 'Sumera Ahmad' },
        spouseCard,
      ),
    );
    expect(next.spouse_date_of_birth).toBe('1968-10-09');
  });

  it("leaves the applicant's own card to the identity merge", () => {
    const { handled } = mergeFamilyDocument(
      input('national_id', CNIC_APPLICANT, FATHER, {
        full_name: 'Muzaffar Ahmad',
        date_of_birth: '15.06.1961',
      }),
    );
    expect(handled).toBe(false);
  });
});

describe('consistency flags', () => {
  const children = [
    { name: 'MIAN MUHAMMAD SAJAWAL', date_of_birth: '1989-10-14' },
  ];

  it('flags a marriage date after a child was born — prod\'s "16-9-1999"', () => {
    const flags = familyConsistencyFlags({
      marriage_date: '16-9-1999',
      children,
    });
    expect(flags).toEqual([
      expect.objectContaining({
        code: 'marriage_after_child_birth',
        field: 'marriage_date',
      }),
    ]);
    expect(flags[0].message).toMatch(/1999-09-16.*1989-10-14/);
  });

  it('raises nothing for the date the certificate actually prints', () => {
    expect(
      familyConsistencyFlags({ marriage_date: '1988-09-16', children }),
    ).toEqual([]);
  });

  it('flags without changing the marriage date, and clears once resolved', () => {
    const profile: Record<string, unknown> = {
      marriage_date: '1999-09-16',
      children,
    };
    expect(applyConsistencyFlags(profile)).toBe(true);
    expect(profile.marriage_date).toBe('1999-09-16');
    expect(profile[CONSISTENCY_FLAGS_KEY]).toHaveLength(1);
    expect(applyConsistencyFlags(profile)).toBe(false);

    profile.marriage_date = '1988-09-16';
    expect(applyConsistencyFlags(profile)).toBe(true);
    expect(profile[CONSISTENCY_FLAGS_KEY]).toBeUndefined();
  });
});
