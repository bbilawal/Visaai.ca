import {
  birthDateIsLabelled,
  classifyDocumentText,
  identityFieldsFromText,
  nameFromIdCardText,
  refineIdentityFields,
  relativeFromIdCardText,
  slotContentMismatch,
} from './classify-document';
import {
  CNIC_SPOUSE,
  NIKAH_NAMA,
  NIKAH_NAMA_AZURE_READ,
  ONTARIO_BIRTH_CERT,
  PUNJAB_BIRTH_CERT_SAJAWAL,
  PUNJAB_BIRTH_CERTS_TWO_CHILDREN,
} from '../../ocr/__fixtures__/civil-records.fixtures';

// Shapes of the real prod uploads on app 71ad0c29 (dry run 2026-10-14).
const IRCC_REFUSAL = `Immigration, Refugees and Citizenship Canada
Immigration, Réfugiés et Citoyenneté Canada
June 30, 2025
Muzaffar Ahmad
Application number: V123456789
IMM 5621
Thank you for your interest in visiting Canada. After a careful review of your
application and supporting documentation, I have determined that your
application does not meet the requirements. Your application is refused.`;

const CNIC = `PAKISTAN
National Identity Card
ISLAMIC REPUBLIC OF PAKISTAN
Name
Muzaffar Ahmad
Father Name
Mian Abdul Rasheed EINUY
Gender
M
Country of Stay
Pakistan
Identity Number
35202-1234567-1
Date of Birth
15.06.1961
Date of Issue
10.01.2018
Date of Expiry
10.01.2028`;

const CNIC_FEMALE = CNIC.replace('Father Name', 'Husband Name')
  .replace('Muzaffar Ahmad', 'Sumera Bibi')
  .replace('Mian Abdul Rasheed EINUY', 'Muzaffar Ahmad');

const PASSPORT_MRZ = `PASSPORT
P<PAKAHMAD<<MUZAFFAR<<<<<<<<<<<<<<<<<<<<<<<<<
AB12345670PAK6106155M3001019<<<<<<<<<<<<<<02`;

const INSURANCE = `Visitors to Canada Emergency Medical Insurance
Policy Number: VTC-998877
Insured: Muzaffar Ahmad
Coverage period: 2025-07-01 to 2026-06-30
Sum insured: $100,000 CAD. Premium paid.`;

const BANK = `Meezan Bank Limited
Account Statement
Account Title: Mian Muhammad Bilawal
Opening Balance 120,000.00
Closing Balance 340,500.00
CNIC: 35202-7654321-3`;

const EMPLOYMENT = `To whom it may concern
This is to certify that Mr. Bilawal Muzaffar is employed with our company as
Senior Engineer since 2019. His annual salary is PKR 4,800,000.`;

describe('classifyDocumentText', () => {
  it.each([
    ['an IRCC refusal letter', IRCC_REFUSAL, 'refusal_letter'],
    ['a Pakistani CNIC', CNIC, 'national_id'],
    ['a female CNIC', CNIC_FEMALE, 'national_id'],
    ['a passport by its MRZ', PASSPORT_MRZ, 'passport'],
    ['an insurance policy', INSURANCE, 'medical_insurance'],
    ['a bank statement (which prints a CNIC)', BANK, 'bank_statement'],
    ['an employment letter', EMPLOYMENT, 'employment_letter'],
  ])('classifies %s', (_label, text, expected) => {
    expect(classifyDocumentText(text)).toBe(expected);
  });

  it('classifies IRCC correspondence that is not a refusal as supporting', () => {
    expect(
      classifyDocumentText(
        'Immigration, Refugees and Citizenship Canada\nPassport request letter',
      ),
    ).toBe('ircc_correspondence');
  });

  it('returns null when nothing is recognisable', () => {
    expect(classifyDocumentText('IMG 2043')).toBeNull();
    expect(classifyDocumentText('')).toBeNull();
  });
});

describe('birthDateIsLabelled', () => {
  it('accepts a DOB printed beside a birth label', () => {
    expect(birthDateIsLabelled(CNIC, '15.06.1961')).toBe(true);
    expect(birthDateIsLabelled(CNIC, '1961-06-15')).toBe(true);
    expect(birthDateIsLabelled('DOB: 15 Jun 1961', '1961-06-15')).toBe(true);
    expect(birthDateIsLabelled('Born on June 15, 1961', '1961-06-15')).toBe(
      true,
    );
  });

  it('rejects a letter date with no birth label (the IRCC refusal)', () => {
    expect(birthDateIsLabelled(IRCC_REFUSAL, '2025-06-30')).toBe(false);
  });

  it('rejects a date that is labelled as something else', () => {
    expect(birthDateIsLabelled(CNIC, '2018-01-10')).toBe(false);
  });
});

describe('nameFromIdCardText', () => {
  it('takes the holder name, not the father name', () => {
    expect(nameFromIdCardText(CNIC)).toEqual({ name: 'Muzaffar Ahmad' });
  });

  it('takes the holder name, not the husband name', () => {
    expect(nameFromIdCardText(CNIC_FEMALE)).toEqual({ name: 'Sumera Bibi' });
  });

  it('reads "Name: X" on one line', () => {
    expect(
      nameFromIdCardText("Name: Muzaffar Ahmad\nFather's Name: Abdul Rasheed"),
    ).toEqual({ name: 'Muzaffar Ahmad' });
  });

  it('reads the part before S/O', () => {
    expect(nameFromIdCardText('Muzaffar Ahmad S/O Mian Abdul Rasheed')).toEqual(
      { name: 'Muzaffar Ahmad' },
    );
  });

  it('is ambiguous when only a relative label is readable', () => {
    expect(nameFromIdCardText('Father Name\nMian Abdul Rasheed')).toEqual({
      ambiguous: true,
    });
  });

  it('has nothing to say without relative labels', () => {
    expect(nameFromIdCardText('Name\nMuzaffar Ahmad')).toEqual({});
  });
});

describe('refineIdentityFields', () => {
  it('drops a letter date read as a DOB from a supporting document', () => {
    const r = refineIdentityFields('refusal_letter', IRCC_REFUSAL, {
      full_name: 'Muzaffar Ahmad',
      date_of_birth: '2025-06-30',
    });
    expect(r.fields.date_of_birth).toBeUndefined();
    expect(r.fields.full_name).toBe('Muzaffar Ahmad');
    expect(r.adjustments.date_of_birth).toMatch(/birth label/);
  });

  it('drops an unlabelled DOB from an unclassified document', () => {
    const r = refineIdentityFields('document', 'Some text 30.06.2025', {
      date_of_birth: '2025-06-30',
    });
    expect(r.fields.date_of_birth).toBeUndefined();
  });

  it('keeps the DOB of an identity document as extracted', () => {
    const r = refineIdentityFields('passport', PASSPORT_MRZ, {
      date_of_birth: '1961-06-15',
    });
    expect(r.fields.date_of_birth).toBe('1961-06-15');
  });

  it('replaces a relative name with the holder name on an ID card', () => {
    const r = refineIdentityFields('national_id', CNIC, {
      full_name: 'Mian Abdul Rasheed EINUY',
      date_of_birth: '15.06.1961',
    });
    expect(r.fields.full_name).toBe('Muzaffar Ahmad');
    expect(r.fields.date_of_birth).toBe('15.06.1961');
    expect(r.adjustments.full_name).toMatch(/holder/);
  });

  it('drops the name when the card is ambiguous about whose it is', () => {
    const r = refineIdentityFields(
      'national_id',
      'National Identity Card\nFather Name\nMian Abdul Rasheed',
      { full_name: 'Mian Abdul Rasheed' },
    );
    expect(r.fields.full_name).toBeUndefined();
    expect(r.adjustments.full_name).toMatch(/ambiguous/);
  });

  it("drops an unknown holder's date of birth, keeps the number, marks the card", () => {
    const r = refineIdentityFields(
      'national_id',
      'National Identity Card\nFather Name\nMian Abdul Rasheed',
      {
        full_name: 'Mian Abdul Rasheed',
        date_of_birth: '2025-11-06',
        national_id_number: '34201-9465270-5',
      },
    );
    expect(r.fields.date_of_birth).toBeUndefined();
    expect(r.fields.national_id_number).toBe('34201-9465270-5');
    expect((r.fields as Record<string, unknown>).holder_unknown).toBe(true);
    expect(r.adjustments.date_of_birth).toMatch(/holder of this card is unknown/);
  });

  it('leaves fields untouched when nothing applies', () => {
    const fields = { full_name: 'Bilawal Muzaffar', account_balance: 5 };
    const r = refineIdentityFields('bank_statement', BANK, fields);
    expect(r.fields).toEqual(fields);
    expect(r.adjustments).toEqual({});
  });
});

// ─── #33: insurance policy vs medical exam ──────────────────────────────────

const MEDICAL_EXAM = `Immigration Medical Examination (IME)
Panel Physician: Dr. A. Khan, Shifa International Hospital
UMI: 12345678
Date of examination: 2025-05-02
Chest X-ray: normal`;

const INSURANCE_CERTIFICATE = `CERTIFICATE OF INSURANCE
Travel Health / Medical Coverage
Insured person: Muzaffar Ahmad
Certificate No: TIC-55443
Medical expenses covered up to USD 50,000`;

describe('classifyDocumentText — insurance vs medical exam (#33)', () => {
  it('files an immigration medical exam report as medical_exam', () => {
    expect(classifyDocumentText(MEDICAL_EXAM)).toBe('medical_exam');
  });

  it('files a medical insurance POLICY as insurance, never as an exam', () => {
    expect(classifyDocumentText(INSURANCE)).toBe('medical_insurance');
  });

  it('files an insurance CERTIFICATE that talks about medical cover as insurance', () => {
    expect(classifyDocumentText(INSURANCE_CERTIFICATE)).toBe(
      'medical_insurance',
    );
  });

  it('keeps insurance ahead of exam when a policy mentions a medical examination', () => {
    expect(
      classifyDocumentText(
        `${INSURANCE}\nPre-existing conditions require a medical examination.`,
      ),
    ).toBe('medical_insurance');
  });
});

// ─── #15: per-slot content check ─────────────────────────────────────────────

const PASSPORT_BIO = `ISLAMIC REPUBLIC OF PAKISTAN
PASSPORT
Surname AHMAD
Given Names MUZAFFAR
${PASSPORT_MRZ.split('\n').slice(1).join('\n')}`;

const PASSPORT_WITH_STAMPS = `${PASSPORT_BIO}
VISA
UNITED ARAB EMIRATES ENTRY 12 MAR 2019
V<AREAHMAD<<MUZAFFAR<<<<<<<<<<<<<<<<<<<<<<<<
DEPARTURE 20 MAR 2019`;

describe('slotContentMismatch', () => {
  it('flags a passport bio page uploaded as evidence of previous travel', () => {
    const m = slotContentMismatch('previous_travel_evidence', PASSPORT_BIO);
    expect(m).toMatchObject({
      expected: 'previous_travel_evidence',
      detected: 'passport',
    });
    expect(m?.message).toMatch(/passport/i);
    expect(m?.message).toMatch(/previous travel evidence/i);
  });

  it('flags a CNIC in a bank-statement slot and an insurance policy in a medical-exam slot', () => {
    expect(slotContentMismatch('bank_statement_3mo', CNIC)?.detected).toBe(
      'national_id',
    );
    expect(slotContentMismatch('medical_exam', INSURANCE)?.detected).toBe(
      'medical_insurance',
    );
  });

  it('flags a CNIC dropped into the passport slot', () => {
    expect(slotContentMismatch('passport', CNIC)?.detected).toBe('national_id');
  });

  it.each([
    ['passport', PASSPORT_BIO],
    ['passport_biographic_page', PASSPORT_BIO],
    ['sponsor_passport', PASSPORT_BIO],
    ['national_id', CNIC],
    ['cnic', CNIC],
    ['medical_insurance', INSURANCE],
    ['travel_health_insurance', INSURANCE_CERTIFICATE],
    ['medical_exam', MEDICAL_EXAM],
    ['bank_statement_3mo', BANK],
    ['sponsor_bank_statement', BANK],
    ['proof_of_funds', BANK],
    ['employment_letter', EMPLOYMENT],
    ['proof_of_relationship', CNIC],
    ['sponsor_documents', PASSPORT_BIO],
  ])('accepts the right document in the %s slot', (slot, text) => {
    expect(slotContentMismatch(slot, text)).toBeNull();
  });

  it("accepts either identity document in a relative's ID slot (spouse_national_id)", () => {
    // The family-gap request reads "National ID card or passport — <spouse>".
    expect(slotContentMismatch('spouse_national_id', CNIC)).toBeNull();
    expect(slotContentMismatch('spouse_national_id', PASSPORT_BIO)).toBeNull();
    expect(slotContentMismatch('sponsor_passport', CNIC)).toBeNull();
    // The applicant's own slots stay strict.
    expect(slotContentMismatch('national_id', PASSPORT_BIO)?.detected).toBe(
      'passport',
    );
    expect(slotContentMismatch('spouse_national_id', BANK)?.detected).toBe(
      'bank_statement',
    );
  });

  it('accepts a full passport scan with visa stamps as travel evidence', () => {
    expect(
      slotContentMismatch('previous_travel_evidence', PASSPORT_WITH_STAMPS),
    ).toBeNull();
  });

  it('never flags when the content is unrecognisable or the slot is generic', () => {
    expect(slotContentMismatch('previous_travel_evidence', 'scan')).toBeNull();
    expect(slotContentMismatch('document', PASSPORT_BIO)).toBeNull();
    expect(slotContentMismatch(undefined, PASSPORT_BIO)).toBeNull();
  });

  it('does not flag supporting evidence in a broad slot it may belong to', () => {
    expect(slotContentMismatch('proof_of_ties', EMPLOYMENT)).toBeNull();
    expect(slotContentMismatch('proof_of_ties', BANK)).toBeNull();
  });
});

// ─── #34: sex + national ID number ───────────────────────────────────────────

describe('identityFieldsFromText (#34)', () => {
  it('reads sex from the passport MRZ', () => {
    expect(identityFieldsFromText('passport', PASSPORT_MRZ)).toMatchObject({
      sex: 'M',
    });
  });

  it('keeps the MRZ lines so prefill can derive passport type', () => {
    const f = identityFieldsFromText('passport', PASSPORT_MRZ);
    expect(f.mrz?.split('\n')).toHaveLength(2);
  });

  it('reads the CNIC number and gender from a national ID card', () => {
    expect(identityFieldsFromText('national_id', CNIC)).toEqual({
      national_id_number: '35202-1234567-1',
      sex: 'M',
      issue_date: '2018-01-10',
      expiry_date: '2028-01-10',
    });
  });

  it('normalises a CNIC printed with spaces or no separators', () => {
    expect(
      identityFieldsFromText('cnic', 'Identity Number 3520212345671')
        .national_id_number,
    ).toBe('35202-1234567-1');
    expect(
      identityFieldsFromText('national_id', 'Identity Number 35202 1234567 1')
        .national_id_number,
    ).toBe('35202-1234567-1');
  });

  it('reads a female holder', () => {
    expect(
      identityFieldsFromText(
        'national_id',
        CNIC.replace('Gender\nM', 'Gender\nF'),
      ).sex,
    ).toBe('F');
  });

  it('never reads a CNIC out of a non-identity document (a bank statement prints one)', () => {
    expect(identityFieldsFromText('bank_statement', BANK)).toEqual({});
  });

  it('returns nothing for an unspecified MRZ sex', () => {
    expect(
      identityFieldsFromText('passport', PASSPORT_MRZ.replace('5M300', '5<300'))
        .sex,
    ).toBeUndefined();
  });
});

describe('refineIdentityFields — identity numbers (#34)', () => {
  it('moves an ID card number out of passport_number into national_id_number', () => {
    const r = refineIdentityFields<Record<string, unknown>>(
      'national_id',
      CNIC,
      {
        full_name: 'Muzaffar Ahmad',
        passport_number: '35202-1234567-1',
      },
    );
    expect(r.fields.passport_number).toBeUndefined();
    expect(r.fields.national_id_number).toBe('35202-1234567-1');
    expect(r.fields.sex).toBe('M');
  });

  it('gap-fills sex from the MRZ on a passport without overwriting the provider', () => {
    expect(
      refineIdentityFields<Record<string, unknown>>('passport', PASSPORT_MRZ, {
        full_name: 'X',
      }).fields.sex,
    ).toBe('M');
    expect(
      refineIdentityFields<Record<string, unknown>>('passport', PASSPORT_MRZ, {
        sex: 'F',
      }).fields.sex,
    ).toBe('F');
  });
});

describe('civil records — birth and marriage certificates (dry run 2026-10-15)', () => {
  it('classifies a NADRA birth certificate as one, not as a CNIC', () => {
    // It prints CNIC numbers next to "Father's Name" — the national-ID rule
    // alone would have taken it for an identity card.
    expect(classifyDocumentText(PUNJAB_BIRTH_CERT_SAJAWAL)).toBe(
      'birth_certificate',
    );
    expect(classifyDocumentText(ONTARIO_BIRTH_CERT)).toBe('birth_certificate');
  });

  it('classifies a nikah nama as a marriage certificate, not a CNIC', () => {
    expect(classifyDocumentText(NIKAH_NAMA)).toBe('marriage_certificate');
  });

  it('still classifies a real CNIC as a national ID', () => {
    expect(classifyDocumentText(CNIC_SPOUSE)).toBe('national_id');
  });

  it('fills a birth certificate from its text and normalises the DOB', () => {
    const { fields, adjustments } = refineIdentityFields(
      'birth_certificate',
      PUNJAB_BIRTH_CERTS_TWO_CHILDREN,
      // What a layout model returned: the raw printed date, unconverted.
      { full_name: 'MIAN MUHAMMAD SAJAWAL', date_of_birth: '14-October-1989' },
    );
    expect(fields).toMatchObject({
      full_name: 'MIAN MUHAMMAD SAJAWAL',
      date_of_birth: '1989-10-14',
      sex: 'Male',
      place_of_birth: 'RAWALPINDI',
      country_of_birth: 'Pakistan',
      father_name: 'MUZAFFAR AHMAD',
      mother_name: 'SUMERA AHMAD',
      birth_records_count: 2,
    });
    expect(adjustments.date_of_birth).toMatch(/normalised/);
    // Parents' CNICs are matched against the profile, never stored as this
    // document's ID number — prefill would file the father's CNIC as the
    // holder's national ID.
    expect(JSON.stringify(fields)).not.toMatch(/37405-5309209-7/);
  });

  it("replaces a model's marriage date with the labelled English line, and says so", () => {
    const { fields, adjustments } = refineIdentityFields(
      'marriage_certificate',
      NIKAH_NAMA,
      { marriage_date: '16-9-1999', spouse_name: 'Sumera Bano' },
    );
    expect(fields.marriage_date).toBe('1988-09-16');
    expect(adjustments.marriage_date).toMatch(/16-9-1999/);
    expect(fields).toMatchObject({
      bridegroom_name: 'Muzaffar Ahmad',
      bride_name: 'Sumera Bano',
    });
  });

  it("drops a model's marriage date that appears nowhere on the certificate", () => {
    // Prod 2026-10-16: the model returned 1999-09-16; the OCR text has no 1999.
    const { fields, adjustments } = refineIdentityFields(
      'marriage_certificate',
      'Nikah Nama\nThe date when the marriage was celebrated\nSd ....',
      { marriage_date: '1999-09-16' },
    );
    expect(fields.marriage_date).toBeUndefined();
    expect(adjustments.marriage_date).toMatch(/not on the certificate/);
  });

  it("replaces a model's garbled party name with the one read from the certificate", () => {
    // Prod 2026-10-16: the model returned "uzaffar Ahmad S/O M"; sync-family
    // then could not match the applicant and ignored the whole certificate.
    const { fields, adjustments } = refineIdentityFields(
      'marriage_certificate',
      NIKAH_NAMA_AZURE_READ,
      { bridegroom_name: 'uzaffar Ahmad S/O M', bride_name: 'Sumera Bano' },
    );
    expect(fields.bridegroom_name).toBe('Muzaffar Ahmad');
    expect(adjustments.bridegroom_name).toMatch(/uzaffar Ahmad S\/O M/);
    expect(fields.bride_name).toBe('Sumera Bano');
  });

  it('keeps the date of birth printed on a birth certificate', () => {
    const { fields } = refineIdentityFields(
      'birth_certificate',
      ONTARIO_BIRTH_CERT,
      { date_of_birth: '1995-09-02' },
    );
    expect(fields.date_of_birth).toBe('1995-09-02');
  });
});

describe('relativeFromIdCardText', () => {
  it("reads the husband named on a wife's CNIC", () => {
    expect(relativeFromIdCardText(CNIC_SPOUSE)).toEqual({
      relation: 'husband',
      name: 'Muzaffar Ahmad',
    });
  });

  it('reads the father named on a CNIC', () => {
    expect(relativeFromIdCardText(CNIC)).toMatchObject({ relation: 'father' });
  });

  it('returns nothing for a card without a relative', () => {
    expect(relativeFromIdCardText('Name\nJane Doe')).toEqual({});
  });
});

describe('refineIdentityFields — attribution (live E2E 2026-10-18)', () => {
  it("a bank statement's full name is its account holder, not an address line", () => {
    const { fields, adjustments } = refineIdentityFields(
      'bank_statement_3mo',
      'UBL Account Statement',
      {
        full_name: 'Loroy Chowk Gujrat Fateh Pur',
        account_holder_name: 'Chaudhary Zeeshan Ali',
      },
    );
    expect(fields.full_name).toBe('Chaudhary Zeeshan Ali');
    expect(adjustments.full_name).toMatch(/account holder/);
  });

  it('leaves an absent full name absent', () => {
    const { fields } = refineIdentityFields(
      'bank_statement_3mo',
      '',
      { account_holder_name: 'Chaudhary Zeeshan Ali' } as Record<string, unknown>,
    );
    expect(fields.full_name).toBeUndefined();
  });
});

describe('refineIdentityFields — nameless ID card (live E2E 2026-10-18)', () => {
  it('marks a card with no holder name at all', () => {
    const r = refineIdentityFields('national_id', 'CNIC copy', {
      national_id_number: '34101-9795712-1',
      date_of_birth: '2025-11-06',
    } as Record<string, unknown>);
    expect(r.fields.holder_unknown).toBe(true);
    expect(r.fields.date_of_birth).toBeUndefined();
    expect(r.fields.national_id_number).toBe('34101-9795712-1');
  });

  it('leaves a named card alone', () => {
    const r = refineIdentityFields('national_id', 'CNIC', {
      full_name: 'Chaudhary Zeeshan Ali',
      national_id_number: '34101-9231766-1',
    } as Record<string, unknown>);
    expect(r.fields.holder_unknown).toBeUndefined();
  });
});


describe('police certificates (Express Entry E2E, prod 2026-10-19)', () => {
  // The layout of a Punjab Police character certificate: the holder's CNIC
  // beside "Father's name" — the national-ID card's own signature.
  const PUNJAB_PCC = `Police Character Certificate - Punjab Police
Name AHMED RAZA
Father's name MUHAMMAD RAZA
CNIC 35202-1234567-1
Passport AB1234567
Issued 20 September 2026
It is certified that no criminal record was found against the above-named person.`;

  it('classifies it as a police certificate, not a national identity card', () => {
    expect(classifyDocumentText(PUNJAB_PCC)).toBe('police_clearance');
    expect(
      classifyDocumentText('Certificate of good conduct issued by the police'),
    ).toBe('police_clearance');
  });

  it('fits the police certificate slot', () => {
    expect(slotContentMismatch('police_certificates', PUNJAB_PCC)).toBeNull();
    expect(slotContentMismatch('police_clearance', PUNJAB_PCC)).toBeNull();
  });

  it('is still flagged in a narrow slot it does not belong to', () => {
    expect(slotContentMismatch('passport', PUNJAB_PCC)?.detected).toBe(
      'police_clearance',
    );
  });

  it('a CNIC in the police certificate slot is still flagged', () => {
    expect(slotContentMismatch('police_certificates', CNIC)?.detected).toBe(
      'national_id',
    );
  });
});

describe('classifyDocumentText — Canadian status documents', () => {
  it('reads a PR card, a COPR and a citizenship certificate as status proof, not IRCC mail', () => {
    expect(classifyDocumentText('GOVERNMENT OF CANADA PERMANENT RESIDENT CARD CARTE DE RÉSIDENT PERMANENT TEST, SARA')).toBe('canadian_status_document');
    expect(classifyDocumentText('Immigration, Refugees and Citizenship Canada Confirmation of Permanent Residence IMM 5292 TEST SARA')).toBe('canadian_status_document');
    expect(classifyDocumentText('Citizenship Certificate / Certificat de citoyenneté TEST SARA')).toBe('canadian_status_document');
  });

  it('a refusal letter or a checklist quoting a PR card is not status proof', () => {
    expect(
      classifyDocumentText('Immigration, Refugees and Citizenship Canada. Your application is refused: the sponsor did not provide a copy of their permanent resident card / carte de résident permanent.'),
    ).toBe('refusal_letter');
    expect(classifyDocumentText('IMM 5533 Document checklist. Copy of the sponsor\'s permanent resident card (both sides). Citizenship certificate.')).not.toBe('canadian_status_document');
    expect(slotContentMismatch('prior_refusal_letter', 'IRCC: your application is refused. Copy of the permanent resident card / carte de résident permanent missing.')).toBeNull();
  });

  it('a sponsor\'s PR card fits their own ID slot', () => {
    expect(slotContentMismatch('sponsor_national_id', 'PERMANENT RESIDENT CARD CARTE DE RÉSIDENT PERMANENT TEST SARA')).toBeNull();
  });

  it('a PR card in a passport slot is flagged; in the sponsor status slot it fits', () => {
    const card = 'PERMANENT RESIDENT CARD CARTE DE RÉSIDENT PERMANENT TEST SARA';
    expect(slotContentMismatch('passport', card)).not.toBeNull();
    expect(slotContentMismatch('proof_of_status', card)).toBeNull();
  });
});
