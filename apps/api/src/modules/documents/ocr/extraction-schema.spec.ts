import {
  extractionFieldsFor,
  extractionPromptFor,
  resolveExtractionType,
} from './extraction-schema';

describe('resolveExtractionType', () => {
  it('resolves exact canonical types', () => {
    expect(resolveExtractionType('admission_letter')).toBe('admission_letter');
    expect(resolveExtractionType('birth_certificate')).toBe(
      'birth_certificate',
    );
    expect(resolveExtractionType('property_document')).toBe(
      'property_document',
    );
  });

  it('resolves discovery-generated suffixes and sponsor prefixes', () => {
    expect(resolveExtractionType('bank_statement_3mo')).toBe('bank_statement');
    expect(resolveExtractionType('sponsor_employment_letter')).toBe(
      'employment_letter',
    );
    expect(resolveExtractionType('passport_biographic_page')).toBe('passport');
    expect(resolveExtractionType('sponsor_bank_statement_6mo')).toBe(
      'bank_statement',
    );
  });

  it('is case- and whitespace-insensitive', () => {
    expect(resolveExtractionType('  Passport  ')).toBe('passport');
  });

  it('maps the aliases the rest of the codebase uses for the same document', () => {
    // The checklist, the portal upload map and the filename fallback do not
    // share one vocabulary — an unmapped alias would lose the whole schema.
    expect(resolveExtractionType('property_deed')).toBe('property_document');
    expect(resolveExtractionType('title_deed')).toBe('property_document');
    expect(resolveExtractionType('police_certificate')).toBe(
      'police_clearance',
    );
    expect(resolveExtractionType('offer_letter')).toBe('admission_letter');
    expect(resolveExtractionType('sponsor_property_deed')).toBe(
      'property_document',
    );
  });

  it('reads a job offer or LMIA as a job offer, never as a school admission letter (live E2E 2026-10-30)', () => {
    for (const t of [
      'job_offer_letter',
      'job_offer',
      'signed_job_offer',
      'lmia',
      'lmia_and_employment_contract',
      'employment_contract_lmia_exempt',
      'lmia_or_offer_of_employment_number',
    ])
      expect(resolveExtractionType(t)).toBe('job_offer');
    // A school's offer letter is still an admission letter.
    expect(resolveExtractionType('offer_letter')).toBe('admission_letter');
    const keys = extractionFieldsFor('job_offer_letter').map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(['offered_employer_name', 'lmia_number', 'offered_start_date']));
    for (const k of ['institution_name', 'program_start_date', 'tuition_amount', 'employer', 'job_title'])
      expect(keys).not.toContain(k);
  });

  it('gives national ID cards their own schema, not the passport one (#34)', () => {
    for (const t of ['national_id', 'cnic', 'id_card', 'nicop']) {
      expect(resolveExtractionType(t)).toBe('national_id');
    }
    const keys = extractionFieldsFor('national_id').map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['national_id_number', 'sex', 'expiry_date']),
    );
    expect(keys).not.toContain('passport_number');
  });

  it('files every insurance slot name under medical_insurance, never medical_exam (#33)', () => {
    for (const t of [
      'medical_insurance',
      'health_insurance',
      'travel_insurance',
      'travel_health_insurance',
      'travel_medical_insurance',
    ]) {
      expect(resolveExtractionType(t)).toBe('medical_insurance');
    }
    expect(resolveExtractionType('medical_exam')).toBe('medical_exam');
    expect(resolveExtractionType('medical')).toBe('medical_exam');
  });

  it('returns null for unknown / missing types rather than guessing', () => {
    expect(resolveExtractionType('document')).toBeNull();
    expect(resolveExtractionType('some_unmapped_thing')).toBeNull();
    expect(resolveExtractionType(undefined)).toBeNull();
    expect(resolveExtractionType('')).toBeNull();
  });
});

describe('extractionFieldsFor', () => {
  it('always includes the common identity fields', () => {
    const keys = extractionFieldsFor('bank_statement').map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining(['full_name', 'date_of_birth']),
    );
  });

  it('adds the type-specific fields the applicant would otherwise re-type', () => {
    const admission = extractionFieldsFor('admission_letter').map((f) => f.key);
    expect(admission).toEqual(
      expect.arrayContaining([
        'institution_name',
        'program_name',
        'program_start_date',
        'tuition_amount',
      ]),
    );

    const birth = extractionFieldsFor('birth_certificate').map((f) => f.key);
    expect(birth).toEqual(
      expect.arrayContaining(['father_name', 'mother_name', 'place_of_birth']),
    );

    const property = extractionFieldsFor('property_document').map((f) => f.key);
    expect(property).toEqual(
      expect.arrayContaining([
        'property_address',
        'property_value',
        'ownership_type',
      ]),
    );
  });

  it('falls back to common fields only for an unknown type', () => {
    // Prompting a police certificate for admission-letter keys is how a model
    // is invited to invent values — an unknown type must stay generic.
    expect(extractionFieldsFor('document').map((f) => f.key)).toEqual([
      'full_name',
      'date_of_birth',
    ]);
  });

  it('never emits a duplicate key when common and specific overlap', () => {
    for (const type of [
      'passport',
      'bank_statement',
      'admission_letter',
      'birth_certificate',
      'employment_letter',
    ]) {
      const keys = extractionFieldsFor(type).map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});

describe('civil records (dry run 2026-10-15)', () => {
  it('asks a marriage certificate for both parties and the labelled date', () => {
    const keys = extractionFieldsFor('marriage_certificate').map((f) => f.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        'marriage_date',
        'bridegroom_name',
        'bride_name',
      ]),
    );
    const date = extractionFieldsFor('marriage_certificate').find(
      (f) => f.key === 'marriage_date',
    )!;
    expect(date.hint).toMatch(/solemnized/);
  });

  it('resolves the nikah nama and NADRA names onto the civil schemas', () => {
    expect(resolveExtractionType('nikah_nama')).toBe('marriage_certificate');
    expect(resolveExtractionType('birth_registration_certificate')).toBe(
      'birth_certificate',
    );
    expect(resolveExtractionType('children_birth_certificate')).toBe(
      'birth_certificate',
    );
  });

  it('never asks a birth certificate to infer a country of birth', () => {
    expect(
      extractionFieldsFor('birth_certificate').map((f) => f.key),
    ).not.toContain('country_of_birth');
  });
});

describe('extractionPromptFor', () => {
  it('names the resolved type and lists its keys with their shape', () => {
    const prompt = extractionPromptFor('admission_letter');
    expect(prompt).toContain('"admission_letter"');
    expect(prompt).toContain('institution_name');
    expect(prompt).toContain(
      'program_start_date: program start date (YYYY-MM-DD)',
    );
    expect(prompt).toContain('plain number');
  });

  it('says so plainly when the type is unknown', () => {
    expect(extractionPromptFor('document')).toContain(
      'Document type is unknown',
    );
  });
});
