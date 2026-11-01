import { collectDocumentFields } from './load-context';

/**
 * Pins the prefill autofill contract: everything a user uploads must reach the
 * form-field generator.
 *
 * The regression these guard against: the node used to walk the TOP-LEVEL keys
 * of `details_json` (`extracted_fields`, `raw_ocr_length`, `error`) and skip any
 * key already seen. The extraction arrived nested under one key, that key was
 * then taken, and every document after the first was thrown away — so a user
 * who uploaded a passport, a bank statement, an admission letter and a birth
 * certificate got fields from the passport only and re-typed the rest.
 */

function identityRow(
  documentType: string,
  extracted: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    verification_type: 'identity',
    details_json: {
      extracted_fields: extracted,
      raw_ocr_length: 4096,
      error: null,
      ...extra,
    },
    documents: { document_type: documentType },
  };
}

describe('collectDocumentFields', () => {
  it('unwraps extracted_fields instead of exposing the wrapper key', () => {
    const { documentFields } = collectDocumentFields([
      identityRow('passport', { passport_number: 'X1234567' }),
    ]);

    expect(documentFields).toHaveProperty('passport_number', 'X1234567');
    expect(documentFields).not.toHaveProperty('extracted_fields');
  });

  it('merges EVERY document, not just the first (the autofill regression)', () => {
    const { documentFields } = collectDocumentFields([
      identityRow('passport', {
        full_name: 'Amira Haddad',
        passport_number: 'X1234567',
      }),
      identityRow('bank_statement', {
        account_holder_name: 'Amira Haddad',
        account_balance: 18450,
        currency: 'CAD',
        bank_name: 'Banque Nationale',
      }),
      identityRow('admission_letter', {
        institution_name: 'University of Toronto',
        program_start_date: '2026-09-08',
        tuition_amount: 42000,
      }),
      identityRow('birth_certificate', {
        father_name: 'Karim Haddad',
        mother_name: 'Leila Haddad',
        place_of_birth: 'Tunis, Tunisia',
      }),
      identityRow('property_document', {
        property_address: '14 Rue de Carthage, Tunis',
        property_value: 320000,
      }),
    ]);

    expect(documentFields).toMatchObject({
      passport_number: 'X1234567',
      account_balance: 18450,
      bank_name: 'Banque Nationale',
      institution_name: 'University of Toronto',
      program_start_date: '2026-09-08',
      tuition_amount: 42000,
      father_name: 'Karim Haddad',
      mother_name: 'Leila Haddad',
      property_address: '14 Rue de Carthage, Tunis',
      property_value: 320000,
    });
  });

  it('groups the same values by the document they came from', () => {
    const { documentFieldsByType } = collectDocumentFields([
      identityRow('passport', {
        full_name: 'Amira Haddad',
        passport_number: 'X1234567',
      }),
      identityRow('bank_statement', {
        account_holder_name: 'Amira Haddad',
        account_balance: 18450,
      }),
    ]);

    expect(documentFieldsByType).toEqual({
      passport: { full_name: 'Amira Haddad', passport_number: 'X1234567' },
      bank_statement: {
        account_holder_name: 'Amira Haddad',
        account_balance: 18450,
      },
    });
  });

  it('drops verification metadata that no government form asks for', () => {
    const { documentFields } = collectDocumentFields([
      identityRow('passport', { passport_number: 'X1234567' }),
    ]);

    expect(documentFields).not.toHaveProperty('raw_ocr_length');
    expect(documentFields).not.toHaveProperty('error');
  });

  it('ignores duplicate/expiry rows — they describe the upload, not the applicant', () => {
    const { documentFields } = collectDocumentFields([
      {
        verification_type: 'duplicate',
        details_json: {
          dup_status: 'likely_dup',
          duplicate_of: 'doc-1',
          basis: 'same identity/passport already uploaded',
        },
        documents: { document_type: 'passport' },
      },
      identityRow('passport', { passport_number: 'X1234567' }),
    ]);

    expect(documentFields).toEqual({ passport_number: 'X1234567' });
  });

  it('keeps the first value for a shared key and preserves the conflict', () => {
    const { documentFields } = collectDocumentFields([
      identityRow('passport', {
        full_name: 'Amira Haddad',
        nationality: 'TUN',
      }),
      identityRow('birth_certificate', { nationality: 'FRA' }),
    ]);

    expect(documentFields.nationality).toBe('TUN');
    expect(documentFields.birth_certificate_nationality).toBe('FRA');
  });

  it('skips empty values so a blank never overwrites a real one downstream', () => {
    const { documentFields } = collectDocumentFields([
      identityRow('passport', {
        passport_number: '',
        nationality: null,
        full_name: 'Amira Haddad',
      }),
    ]);

    expect(documentFields).toEqual({ full_name: 'Amira Haddad' });
  });

  it('tolerates a failed extraction (empty fields object) without throwing', () => {
    const { documentFields, documentFieldsByType } = collectDocumentFields([
      {
        verification_type: 'identity',
        details_json: { extracted_fields: {}, error: 'OCR failed' },
        documents: { document_type: 'passport' },
      },
      identityRow('birth_certificate', { place_of_birth: 'Tunis' }),
    ]);

    expect(documentFields).toEqual({ place_of_birth: 'Tunis' });
    expect(documentFieldsByType.passport).toEqual({});
  });

  it('tolerates malformed rows', () => {
    expect(() =>
      collectDocumentFields([
        { details_json: null, documents: null },
        { details_json: 'nonsense', documents: { document_type: 'passport' } },
        {
          details_json: { extracted_fields: ['not', 'an', 'object'] },
          documents: { document_type: 'passport' },
        },
      ]),
    ).not.toThrow();
  });
});

/**
 * Subject attribution — prod 2026-10-14: a retired applicant's form took the
 * HR signatory's title, the other son's salary and the son's start date from
 * SPONSOR documents. Only the applicant's own documents may reach the flat map.
 */
describe('collectDocumentFields — subject attribution', () => {
  const rows = [
    identityRow('passport_copy', {
      full_name: 'KARIM HADDAD',
      passport_number: 'AB1234567',
    }),
    identityRow('invitation_letter', { host_status: 'a Canadian citizen' }),
    identityRow('employment_letter', {
      job_title: 'HR Data Quality Coordinator',
      monthly_income: 88123,
      employment_start_date: 'December 2, 2024.',
    }),
    identityRow('proof_of_funds', {
      account_holder_name: 'HADDAD, OMAR',
      account_balance: 88123,
    }),
    identityRow('document', {
      full_name: 'Leila Karim Haddad',
      date_of_birth: '15.06.1961',
    }),
    identityRow('document', { full_name: 'Youssef Ben Salah' }),
  ];

  it('keeps sponsor and host values out of the applicant map', () => {
    const { documentFields } = collectDocumentFields(rows);
    expect(documentFields.passport_number).toBe('AB1234567');
    expect(documentFields).not.toHaveProperty('job_title');
    expect(documentFields).not.toHaveProperty('monthly_income');
    expect(documentFields).not.toHaveProperty('employment_start_date');
    expect(documentFields).not.toHaveProperty('account_balance');
    expect(documentFields).not.toHaveProperty('host_status');
    expect(Object.values(documentFields)).not.toContain('Youssef Ben Salah');
  });

  it('hands them over as other-party documents with their subject', () => {
    const { otherPartyDocuments } = collectDocumentFields(rows);
    expect(otherPartyDocuments.map((d) => [d.documentType, d.subject])).toEqual(
      [
        ['invitation_letter', 'host'],
        ['employment_letter', 'unattributed'],
        ['proof_of_funds', 'third_party'],
        ['document', 'third_party'],
      ],
    );
    expect(otherPartyDocuments[2].holderName).toBe('HADDAD, OMAR');
  });

  it('anchors on the passport name, falling back to the given applicant name', () => {
    expect(collectDocumentFields(rows).applicantName).toBe('KARIM HADDAD');
    const noPassport = collectDocumentFields(
      [
        identityRow('bank_statement', {
          account_holder_name: 'Karim Haddad',
          account_balance: 5,
        }),
      ],
      'Karim Haddad',
    );
    expect(noPassport.documentFields.account_balance).toBe(5);
  });
});

/**
 * Prod 2026-10-30 (after #299): sync_profile holds a passport whose holder does
 * not match the applicant (holder_mismatch.needs_confirmation) or marks it as
 * clearly someone else's (clearly_other), and writes nothing from it. The
 * prefill still read every verification row, took the FIRST passport's holder
 * as the applicant, and put that person's name, DOB and number on the form.
 */
describe('collectDocumentFields — held / foreign passports', () => {
  const held = (
    id: string,
    extracted: Record<string, unknown>,
    flag: object,
  ) => ({
    ...identityRow('passport', extracted, {
      holder_mismatch: { holder: 'X', applicant: 'Y', message: 'm', ...flag },
    }),
    document_id: id,
  });
  const strangerPassport = {
    full_name: 'QUEBEC ZULU',
    passport_number: 'XQ0000001',
    date_of_birth: '1970-01-01',
    place_of_birth: 'NOWHERESVILLE',
  };
  const ownPassport = {
    full_name: 'VICTOR WHISKEY',
    passport_number: 'VW7654321',
    date_of_birth: '1992-05-06',
  };

  it.each([
    ['held for confirmation', { needs_confirmation: true }],
    ['clearly someone else', { clearly_other: true }],
  ])(
    'a passport %s never anchors the applicant or fills their fields',
    (_l, flag) => {
      const out = collectDocumentFields(
        [
          held('doc-held', strangerPassport, flag),
          { ...identityRow('passport', ownPassport), document_id: 'doc-own' },
        ],
        'Victor Whiskey',
      );
      expect(out.applicantName).toBe('VICTOR WHISKEY');
      expect(out.documentFields.passport_number).toBe('VW7654321');
      expect(out.documentFields.date_of_birth).toBe('1992-05-06');
      const values = JSON.stringify([
        out.documentFields,
        out.documentFieldsByType,
      ]);
      expect(values).not.toContain('QUEBEC ZULU');
      expect(values).not.toContain('XQ0000001');
      expect(values).not.toContain('1970-01-01');
      expect(values).not.toContain('NOWHERESVILLE');
      expect(out.otherPartyDocuments.map((d) => d.holderName)).toEqual([
        'QUEBEC ZULU',
      ]);
    },
  );

  it('falls back to the stated name when the only passport is held', () => {
    const out = collectDocumentFields(
      [held('doc-held', strangerPassport, { needs_confirmation: true })],
      'Victor Whiskey',
    );
    expect(out.applicantName).toBe('Victor Whiskey');
    expect(out.documentFields).toEqual({});
  });

  it('a held passport the consultant approved counts again', () => {
    const out = collectDocumentFields(
      [held('doc-held', ownPassport, { needs_confirmation: true })],
      'Vic Whiskey',
      new Set(['doc-held']),
    );
    expect(out.applicantName).toBe('VICTOR WHISKEY');
    expect(out.documentFields.passport_number).toBe('VW7654321');
  });

  it('an applicant-confirmed passport the consultant then rejected is held again, and reported as held', () => {
    const confirmedRow = {
      ...identityRow('passport', strangerPassport, {
        holder_confirmation: { confirmed_at: '2026-10-30T10:00:00Z' },
      }),
      document_id: 'doc-conf',
    };
    const released = collectDocumentFields([confirmedRow], 'Romeo Kilo');
    expect(released.documentFields.passport_number).toBe('XQ0000001');
    expect(released.heldDocumentIds).toEqual([]);

    const out = collectDocumentFields(
      [confirmedRow],
      'Romeo Kilo',
      new Set(),
      new Set(['doc-conf']),
    );
    expect(out.documentFields).toEqual({});
    expect(out.applicantName).toBe('Romeo Kilo');
    expect(out.heldDocumentIds).toEqual(['doc-conf']);
  });

  it('approval does not rescue a clearly-foreign passport', () => {
    const out = collectDocumentFields(
      [held('doc-held', strangerPassport, { clearly_other: true })],
      'Victor Whiskey',
      new Set(['doc-held']),
    );
    expect(out.documentFields).toEqual({});
  });

  it('a plain name-spelling warning (no hold) still fills', () => {
    const out = collectDocumentFields(
      [held('doc-own', ownPassport, {})],
      'Victor Whiskey',
    );
    expect(out.documentFields.passport_number).toBe('VW7654321');
  });
});

/**
 * Account-detail enrichment.
 *
 * All four pipeline modules that read `users` selected `preferred_language`
 * and nothing else, and `user_profiles` — phone and the full postal address —
 * was read by no pipeline module at all. So an applicant typed their name,
 * nationality, phone and address into onboarding and Settings, and the
 * prefilled government form still came back with Contact and Address blank,
 * a section generate-fields is explicitly told to fill.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACCOUNT_FIELD_MAP } from './load-context';

describe('ACCOUNT_FIELD_MAP', () => {
  it('maps account columns onto snake_case form keys', () => {
    const map = Object.fromEntries(ACCOUNT_FIELD_MAP);
    expect(map.first_name).toBe('given_name');
    expect(map.last_name).toBe('family_name');
    expect(map.country).toBe('country_of_residence');
    expect(map.postal_code).toBe('postal_code');
  });

  it('every mapped column is actually SELECTed', () => {
    // The select string is a literal (supabase-js infers the row type from it),
    // so the two can drift. A column added to the map but not to the select
    // would silently never arrive, and the field would stay blank on the form
    // with nothing to show for it.
    const source = readFileSync(join(__dirname, 'load-context.ts'), 'utf8');
    const select = /\.select\(\s*'([^']*first_name[^']*)'/.exec(source)?.[1];
    expect(select).toBeDefined();
    const selected = new Set(select!.split(',').map((c) => c.trim()));
    for (const [column] of ACCOUNT_FIELD_MAP) {
      expect(selected.has(column)).toBe(true);
    }
  });

  it('does not carry email into form-field territory by accident', () => {
    // email is loaded for context but is not a mapped address/identity column.
    expect(ACCOUNT_FIELD_MAP.map(([c]) => c)).not.toContain('email');
  });
});

/**
 * Prod 2026-10-14: registry-era applications have no framework_id, so the
 * payload stored countryCode/visaType/purpose as "" and the prefill header
 * rendered "— · — · —".
 */
import { resolveHeader } from './load-context';

function fakeVisaTypes(row: Record<string, unknown> | null) {
  const calls: string[] = [];
  const chain = {
    select: () => chain,
    eq: (_c: string, v: string) => {
      calls.push(v);
      return chain;
    },
    maybeSingle: async () => ({ data: row, error: null }),
  };
  return {
    calls,
    client: { from: () => chain } as unknown as Parameters<
      typeof resolveHeader
    >[0],
  };
}

describe('resolveHeader', () => {
  it('falls back to destination_country + the registry visa type', async () => {
    const { client, calls } = fakeVisaTypes({
      official_name: 'Visitor visa (temporary resident visa)',
      category: 'visitor',
    });
    const h = await resolveHeader(
      client,
      { destination_country: 'CA', visa_type_id: 'vt-1' },
      null,
    );
    expect(h).toEqual({
      countryCode: 'CA',
      visaType: 'Visitor visa (temporary resident visa)',
      purpose: 'visitor',
      visaaiId: null,
    });
    expect(calls).toEqual(['vt-1']);
  });

  it('prefers the legacy framework when present', async () => {
    const { client, calls } = fakeVisaTypes(null);
    const h = await resolveHeader(
      client,
      { destination_country: 'CA', visa_type_id: null },
      { country_code: 'CA', visa_type: 'TRV', purpose: 'tourism' },
    );
    expect(h).toEqual({
      countryCode: 'CA',
      visaType: 'TRV',
      purpose: 'tourism',
      visaaiId: null,
    });
    expect(calls).toEqual([]);
  });
});

describe('resolveHeader — registry route id', () => {
  it("returns the registry visaai_id so prefill can apply the route's form questions", async () => {
    const { client } = fakeVisaTypes({
      official_name: 'Visitor visa',
      category: 'visitor',
      visaai_id: 'ca-visitor-visa-temporary-resident-visa',
    });
    const h = await resolveHeader(
      client,
      { destination_country: 'CA', visa_type_id: 'vt-1' },
      null,
    );
    expect(h.visaaiId).toBe('ca-visitor-visa-temporary-resident-visa');
  });
});
