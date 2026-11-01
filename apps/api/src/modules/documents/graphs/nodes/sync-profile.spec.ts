import {
  makeSyncProfileNode,
  mergeExtractedIntoProfile,
  INTENTIONALLY_UNMAPPED,
  forgetOwnDocumentValues,
} from './sync-profile';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import {
  NIKAH_NAMA,
  PUNJAB_BIRTH_CERTS_TWO_CHILDREN,
} from '../../ocr/__fixtures__/civil-records.fixtures';
import { refineIdentityFields } from './classify-document';
import { makeFakeDb } from '../../family-gaps/__fixtures__/fake-db';
import { syncFamilyGapsForApplication } from '../../family-gaps/family-gaps.sync';

/**
 * Document extraction used to write to `document_verifications` and nowhere
 * else, so the intake chat — which builds its questions from
 * `application_profiles.profile_json` — could not see a single fact from a
 * document the applicant had already uploaded, and kept asking for their name,
 * date of birth, employer and course start date with the answers already in the
 * database.
 *
 * The merge is the part that has to be right. Two rules:
 *   1. it only fills gaps — a user's own answer is never overwritten
 *   2. it copies, it never converts — no currency-bearing field crosses over
 */
describe('mergeExtractedIntoProfile', () => {
  it('fills a profile field the applicant has not answered', () => {
    const { next, result } = mergeExtractedIntoProfile(
      {},
      { full_name: 'Amira Haddad', date_of_birth: '1998-04-02' },
    );
    expect(next).toMatchObject({
      full_name: 'Amira Haddad',
      date_of_birth: '1998-04-02',
    });
    expect(result.added).toEqual(
      expect.arrayContaining(['full_name', 'date_of_birth']),
    );
  });

  it('a job offer fills the work permit questions, never the current job or study keys (live E2E 2026-10-30)', () => {
    const { next } = mergeExtractedIntoProfile(
      { work_start_date: '2027-02-01' },
      {
        offered_employer_name: 'Maple Test Logistics Inc.',
        offered_job_title: 'Logistics Coordinator',
        offered_start_date: '2027-01-11',
        offered_end_date: '2029-01-10',
        offered_wage: 30,
        lmia_number: '1234567',
      },
      'job_offer_letter',
    );
    expect(next).toMatchObject({
      work_employer_name: 'Maple Test Logistics Inc.',
      work_job_title: 'Logistics Coordinator',
      work_end_date: '2029-01-10',
      lmia_number: '1234567',
      // The applicant's answer wins.
      work_start_date: '2027-02-01',
    });
    for (const k of ['employer_name', 'job_title', 'institution_name', 'program_start_date', 'offered_wage'])
      expect(next).not.toHaveProperty(k);
  });

  it('NEVER overwrites what the applicant already told us', () => {
    // The applicant is the authority on their own history; an OCR read of a
    // scan is not. Silently rewriting a stated fact is the failure this
    // product can least afford.
    const { next, result } = mergeExtractedIntoProfile(
      { full_name: 'Amira J. Haddad' },
      { full_name: 'AMIRA HADDAD' },
    );
    expect(next.full_name).toBe('Amira J. Haddad');
    expect(result.added).not.toContain('full_name');
    expect(result.skipped).toContain('full_name');
  });

  it('treats an empty or whitespace answer as unanswered', () => {
    const { next } = mergeExtractedIntoProfile(
      { full_name: '   ', nationality: '' },
      { full_name: 'Amira Haddad', nationality: 'Tunisian' },
    );
    expect(next.full_name).toBe('Amira Haddad');
    expect(next.nationality).toBe('Tunisian');
  });

  it('preserves a falsy-but-real answer like false or 0', () => {
    const { next, result } = mergeExtractedIntoProfile(
      { sex: 0 },
      { sex: 'F' },
    );
    expect(next.sex).toBe(0);
    expect(result.skipped).toContain('sex');
  });

  it('maps employer onto the profile key the intake extractor uses', () => {
    const { next } = mergeExtractedIntoProfile(
      {},
      { employer: 'Meridian Tech' },
    );
    expect(next.employer_name).toBe('Meridian Tech');
  });

  it('carries study facts across so the chat stops re-asking them', () => {
    const { next } = mergeExtractedIntoProfile(
      {},
      {
        institution_name: 'University of Toronto',
        program_name: 'MSc Computer Science',
        program_start_date: '2026-09-08',
      },
    );
    expect(next).toMatchObject({
      institution_name: 'University of Toronto',
      program_name: 'MSc Computer Science',
      program_start_date: '2026-09-08',
    });
  });

  it.each(INTENTIONALLY_UNMAPPED)(
    'never copies %s into the profile',
    (field) => {
      // Currency-bearing or document-scoped. `monthly_income` is in the
      // document's own currency while the profile's field is *_usd, and
      // treating one as the other would put a wrong number in front of a visa
      // officer. These still reach scoring and prefill straight from
      // extracted_fields, where their document context travels with them.
      const { next } = mergeExtractedIntoProfile({}, { [field]: 12345 });
      expect(Object.keys(next)).toHaveLength(0);
    },
  );

  it('carries sex and the national ID number into the profile (#34)', () => {
    const { next } = mergeExtractedIntoProfile(
      {},
      { sex: 'M', national_id_number: '35202-1234567-1' },
    );
    expect(next).toEqual({ sex: 'M', national_id_number: '35202-1234567-1' });
  });

  it('ignores empty, null and blank extracted values', () => {
    const { next, result } = mergeExtractedIntoProfile(
      {},
      {
        full_name: '',
        nationality: undefined,
        job_title: '   ',
      },
    );
    expect(result.added).toEqual([]);
    expect(next).toEqual({});
  });

  it('does not mutate the profile it was given', () => {
    const profile = { full_name: 'Amira' };
    mergeExtractedIntoProfile(profile, { nationality: 'Tunisian' });
    expect(profile).toEqual({ full_name: 'Amira' });
  });

  it('reports nothing added when the document tells us nothing new', () => {
    const { result } = mergeExtractedIntoProfile(
      { full_name: 'Amira' },
      { full_name: 'Amira' },
    );
    expect(result.added).toEqual([]);
  });
});

/**
 * The node around the merge, which had no test at all — and which held the
 * failure the merge rules exist to prevent.
 */
function fakeSupabase(opts: {
  profile?: Record<string, unknown> | null;
  readError?: string;
  upsertError?: string;
}) {
  const upserts: Array<Record<string, unknown>> = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve(
              opts.readError
                ? { data: null, error: { message: opts.readError } }
                : {
                    data:
                      opts.profile === null
                        ? null
                        : { profile_json: opts.profile },
                    error: null,
                  },
            ),
        }),
      }),
      upsert: (row: Record<string, unknown>) => {
        upserts.push(row);
        return Promise.resolve({
          error: opts.upsertError ? { message: opts.upsertError } : null,
        });
      },
    }),
  } as unknown as SupabaseClient;
  return { client, upserts };
}

const state = {
  applicationId: 'app-1',
  documentId: 'doc-1',
  extractedFields: { full_name: 'Ada Lovelace' },
} as unknown as DocumentState;

describe('syncProfile node', () => {
  it('merges into the existing profile and keeps the applicant answers', async () => {
    const { client, upserts } = fakeSupabase({
      profile: { date_of_birth: '1815-12-10', employer_name: 'Analytical Co' },
    });

    await makeSyncProfileNode(client)(state);

    expect(upserts).toHaveLength(1);
    expect(upserts[0].profile_json).toEqual({
      date_of_birth: '1815-12-10',
      employer_name: 'Analytical Co',
      full_name: 'Ada Lovelace',
      // Provenance: a re-read can tell the document's value from an answer.
      _document_sources: {
        full_name: {
          document_id: 'doc-1',
          document_type: '',
          value: 'Ada Lovelace',
        },
      },
    });
  });

  /**
   * The defect. supabase-js RESOLVES a failed read as `{ data: null, error }`,
   * so dropping `error` made a failure indistinguishable from "no profile row
   * yet": the merge started from `{}` and the upsert replaced `profile_json`
   * wholesale, erasing every answer the applicant gave during intake. Worse, it
   * was silent — with an empty profile nothing is `skipped`, so the log read
   * "left 0 already answered", exactly like a normal run.
   */
  it('writes NOTHING when the profile read fails, rather than replacing it', async () => {
    const { client, upserts } = fakeSupabase({ readError: 'connection reset' });

    await expect(makeSyncProfileNode(client)(state)).resolves.toEqual({});

    expect(upserts).toEqual([]);
  });

  it('still creates the row when the application genuinely has no profile', async () => {
    const { client, upserts } = fakeSupabase({ profile: null });

    await makeSyncProfileNode(client)(state);

    expect(upserts).toHaveLength(1);
    expect(upserts[0].profile_json).toMatchObject({
      full_name: 'Ada Lovelace',
    });
  });

  it('never overwrites an answer the applicant already gave', async () => {
    const { client, upserts } = fakeSupabase({
      profile: { full_name: 'Augusta Ada King' },
    });

    await makeSyncProfileNode(client)(state);

    expect(upserts).toEqual([]);
  });

  it('does not fail the document when the upsert itself fails', async () => {
    const { client } = fakeSupabase({
      profile: {},
      upsertError: 'write denied',
    });

    await expect(makeSyncProfileNode(client)(state)).resolves.toEqual({});
  });

  it('does nothing when the document extracted no fields', async () => {
    const { client, upserts } = fakeSupabase({ profile: {} });

    await makeSyncProfileNode(client)({
      ...state,
      extractedFields: {},
    });

    expect(upserts).toEqual([]);
  });
});

/**
 * Dry run 2026-10-15: family documents reached nowhere the IRCC family pages
 * read from, and the identity merge would have filed a CHILD's DOB as the
 * applicant's own.
 */
describe('syncProfile node — family documents', () => {
  function civilState(
    documentType: string,
    rawOcrText: string,
    extracted = {},
  ) {
    return {
      applicationId: 'app-1',
      documentId: 'doc-7',
      documentType,
      rawOcrText,
      extractedFields: refineIdentityFields(documentType, rawOcrText, extracted)
        .fields,
    } as unknown as DocumentState;
  }

  it("writes the children from a birth certificate, not the applicant's DOB", async () => {
    const { client, upserts } = fakeSupabase({
      profile: { full_name: 'Muzaffar Ahmad' },
    });

    await makeSyncProfileNode(client)(
      civilState('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN),
    );

    expect(upserts).toHaveLength(1);
    const profile = upserts[0].profile_json as Record<string, unknown>;
    expect(profile.date_of_birth).toBeUndefined();
    expect(
      (profile.children as Array<{ name: string; date_of_birth: string }>).map(
        (c) => [c.name, c.date_of_birth],
      ),
    ).toEqual([
      ['MIAN MUHAMMAD SAJAWAL', '1989-10-14'],
      ['MIAN MUHAMMAD BILAWAL', '1989-10-14'],
    ]);
  });

  it('flags — and keeps — an applicant-given marriage date after the children were born', async () => {
    const { client, upserts } = fakeSupabase({
      profile: {
        full_name: 'Muzaffar Ahmad',
        marriage_date: '1999-09-16',
        children: [{ name: 'Sajawal', date_of_birth: '1989-10-14' }],
      },
    });

    await makeSyncProfileNode(client)(
      civilState('marriage_certificate', NIKAH_NAMA),
    );

    expect(upserts).toHaveLength(1);
    const profile = upserts[0].profile_json as Record<string, unknown>;
    // No provenance and the lookup found nothing: it is the applicant's answer.
    expect(profile.marriage_date).toBe('1999-09-16');
    expect(profile.document_consistency_flags).toEqual([
      expect.objectContaining({ code: 'marriage_after_child_birth' }),
    ]);
  });
});

/**
 * The checklist's family requests follow the profile (family-gaps.sync.ts),
 * and re-reading a document corrects an earlier document-sourced misread.
 */
describe('syncProfile node — family requests and re-reads', () => {
  const CA_VISITOR = {
    applications: [{ id: 'app-1', visa_type_id: 'vt-trv' }],
    visa_types: [
      { id: 'vt-trv', visaai_id: 'ca-visitor-visa-temporary-resident-visa' },
    ],
  };

  function civil(documentType: string, rawOcrText: string, extracted = {}) {
    return {
      applicationId: 'app-1',
      documentId: 'doc-7',
      documentType,
      rawOcrText,
      extractedFields: refineIdentityFields(documentType, rawOcrText, extracted)
        .fields,
    } as unknown as DocumentState;
  }

  const gapRows = (rows: Array<Record<string, unknown>>) =>
    rows.filter((r) => String(r.added_reason).startsWith('family_gap:'));

  it("closes the children's birth-certificate requests once the certificate supplies their DOB", async () => {
    const profile = {
      full_name: 'Muzaffar Ahmad',
      nationality: 'Pakistani',
      children: [
        { name: 'Mian Muhammad Sajawal' },
        { name: 'Mian Muhammad Bilawal' },
      ],
    };
    const fake = makeFakeDb({
      ...CA_VISITOR,
      application_profiles: [
        { application_id: 'app-1', profile_json: profile },
      ],
      checklist_items: [],
      documents: [],
    });
    // Before the upload: both children are requested.
    await syncFamilyGapsForApplication(fake.client, 'app-1');
    expect(gapRows(fake.tables.checklist_items)).toHaveLength(2);

    await makeSyncProfileNode(fake.client)(
      civil('birth_certificate', PUNJAB_BIRTH_CERTS_TWO_CHILDREN),
    );

    expect(gapRows(fake.tables.checklist_items)).toEqual([]);
  });

  it('a re-read nikah nama replaces the earlier OCR misread recorded only in provenance, and clears the flag', async () => {
    // Prod: "16-9-1999" written by an earlier extraction, before
    // `_document_sources` existed. The re-run replaced its verification row,
    // so the old read survives only as an immutable provenance version.
    const profile = {
      full_name: 'Muzaffar Ahmad',
      nationality: 'Pakistani',
      spouse_name: 'Sumera Ahmad',
      spouse_date_of_birth: '1968-10-09',
      marriage_date: '16-9-1999',
      children: [
        { name: 'Mian Muhammad Sajawal', date_of_birth: '1989-10-14' },
      ],
      document_consistency_flags: [
        {
          code: 'marriage_after_child_birth',
          field: 'marriage_date',
          message: 'The marriage date (1999-09-16) is after a birth.',
        },
      ],
    };
    const fake = makeFakeDb({
      ...CA_VISITOR,
      application_profiles: [
        { application_id: 'app-1', profile_json: profile },
      ],
      field_provenance: [
        {
          application_id: 'app-1',
          field_key: 'marriage_date',
          origin: 'ocr',
          value_snapshot: '16-9-1999',
        },
      ],
      checklist_items: [],
      documents: [],
    });
    await syncFamilyGapsForApplication(fake.client, 'app-1');
    const [flagged] = gapRows(fake.tables.checklist_items);
    expect(flagged.label).toBe('Marriage certificate (nikah nama)');
    expect((flagged.meta as Record<string, unknown>).needs_attention).toBe(
      true,
    );

    await makeSyncProfileNode(fake.client)(
      civil('marriage_certificate', NIKAH_NAMA, { marriage_date: '16-9-1999' }),
    );

    const stored = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(stored.marriage_date).toBe('1988-09-16');
    expect(stored.document_consistency_flags).toBeUndefined();
    expect(gapRows(fake.tables.checklist_items)).toEqual([]);
  });

  it("keeps an applicant's own marriage date when no earlier extraction produced it", async () => {
    const profile = {
      full_name: 'Muzaffar Ahmad',
      marriage_date: '1999-09-16',
    };
    const fake = makeFakeDb({
      ...CA_VISITOR,
      application_profiles: [
        { application_id: 'app-1', profile_json: profile },
      ],
      field_provenance: [],
      checklist_items: [],
      documents: [],
    });
    await makeSyncProfileNode(fake.client)(
      civil('marriage_certificate', NIKAH_NAMA),
    );
    const stored = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(stored.marriage_date).toBe('1999-09-16');
  });
});

describe('mergeExtractedIntoProfile — identity card dates (2026-10-16)', () => {
  it("files an ID card's issue and expiry dates under national_id_*", () => {
    const { next } = mergeExtractedIntoProfile(
      {},
      { issue_date: '2017-04-24', expiry_date: '2027-04-24' },
      'national_id',
    );
    expect(next).toEqual({
      national_id_issue_date: '2017-04-24',
      national_id_expiry_date: '2027-04-24',
    });
  });

  it('leaves other documents’ dates unmapped', () => {
    const { next } = mergeExtractedIntoProfile(
      {},
      { issue_date: '2017-04-24', expiry_date: '2027-04-24' },
      'bank_statement',
    );
    expect(next).toEqual({});
  });
});

/**
 * Audit 2026-10-18: a passport's issue and expiry dates never reached the
 * profile (the case above used to assert exactly that for 'passport'), so
 * IRCC's /travel-doc dates came only from the interview.
 */
describe('mergeExtractedIntoProfile — passport dates', () => {
  it('maps a passport’s issue / expiry to the passport keys', () => {
    const { next, result } = mergeExtractedIntoProfile(
      {},
      { issue_date: '2022-01-10', expiry_date: '2032-01-09' },
      'passport',
    );
    expect(next).toEqual({
      passport_issue_date: '2022-01-10',
      passport_expiry_date: '2032-01-09',
    });
    expect(result.added).toEqual(
      expect.arrayContaining(['passport_issue_date', 'passport_expiry_date']),
    );
    expect(next).not.toHaveProperty('national_id_issue_date');
  });

  it('keeps the applicant’s own answer', () => {
    const { next, result } = mergeExtractedIntoProfile(
      { passport_expiry_date: '2031-12-31' },
      { issue_date: '2022-01-10', expiry_date: '2032-01-09' },
      'passport',
    );
    expect(next.passport_expiry_date).toBe('2031-12-31');
    expect(next.passport_issue_date).toBe('2022-01-10');
    expect(result.skipped).toContain('passport_expiry_date');
  });

  it('does not store an ambiguous print as an answer', () => {
    const { next } = mergeExtractedIntoProfile(
      {},
      { issue_date: '03/04/2022', expiry_date: '2032-01-09' },
      'passport',
    );
    expect(next).toEqual({ passport_expiry_date: '2032-01-09' });
  });
});

describe('forgetOwnDocumentValues (live E2E 2026-10-18)', () => {
  const profile = {
    full_name: 'Loroy Chowk Gujrat Fateh Pur',
    date_of_birth: '1989-11-22',
    email: 'z@example.com',
    _document_sources: {
      full_name: {
        value: 'Loroy Chowk Gujrat Fateh Pur',
        document_id: 'doc-1',
        document_type: 'bank_statement_3mo',
      },
      date_of_birth: {
        value: '2025-11-06',
        document_id: 'doc-1',
        document_type: 'bank_statement_3mo',
      },
    },
  };

  it('drops what this document wrote and nobody changed', () => {
    const out = forgetOwnDocumentValues(profile, 'doc-1');
    expect(out.full_name).toBeNull();
    expect(
      (out._document_sources as Record<string, unknown>).full_name,
    ).toBeUndefined();
  });

  it('keeps a value changed since (provenance no longer matches)', () => {
    const out = forgetOwnDocumentValues(profile, 'doc-1');
    expect(out.date_of_birth).toBe('1989-11-22');
    expect(out.email).toBe('z@example.com');
  });

  it('a degraded re-read (far fewer fields) forgets nothing', () => {
    const many = {
      a: 'x',
      b: 'y',
      c: 'z',
      _document_sources: {
        a: { value: 'x', document_id: 'doc-1' },
        b: { value: 'y', document_id: 'doc-1' },
        c: { value: 'z', document_id: 'doc-1' },
      },
    };
    expect(forgetOwnDocumentValues(many, 'doc-1', { a: 'x' })).toBe(many);
    expect(
      forgetOwnDocumentValues(many, 'doc-1', { a: 'x', b: 'q' }).c,
    ).toBeNull();
  });

  it("leaves another document's values and an unsourced profile alone", () => {
    expect(forgetOwnDocumentValues(profile, 'doc-2')).toBe(profile);
    expect(forgetOwnDocumentValues({ a: 1 }, 'doc-1')).toEqual({ a: 1 });
  });
});

/**
 * Live E2E 2026-10-20: another person's passport in the applicant's own
 * passport slot verified "Identity ✓ Pass" and nothing told the applicant.
 * Invented names throughout.
 */
describe("syncProfile node — somebody else's document in the applicant's slot", () => {
  function setup(
    extracted: Record<string, unknown>,
    profileJson: Record<string, unknown> = {
      full_name: 'TESTER, ALPHA BRAVO',
      passport_number: 'ZZ1234567',
      date_of_birth: '1990-02-03',
    },
  ) {
    const fake = makeFakeDb({
      application_profiles: [
        { application_id: 'app-1', profile_json: profileJson },
      ],
      documents: [{ id: 'doc-9', checklist_item_id: 'item-1' }],
      checklist_items: [
        {
          id: 'item-1',
          application_id: 'app-1',
          document_type: 'passport',
          meta: { owner: 'applicant' },
        },
      ],
      document_verifications: [
        {
          id: 'ver-1',
          document_id: 'doc-9',
          verification_type: 'identity',
          result: 'pass',
          details_json: { extracted_fields: extracted },
        },
      ],
    });
    const docState = {
      applicationId: 'app-1',
      documentId: 'doc-9',
      documentType: 'passport',
      rawOcrText: '',
      extractedFields: extracted,
    } as unknown as DocumentState;
    const details = () =>
      fake.tables.document_verifications[0].details_json as Record<
        string,
        unknown
      >;
    return { fake, docState, details };
  }

  it('notes the mismatch on the identity row and writes no identity from it', async () => {
    const { fake, docState, details } = setup({
      full_name: 'FOXTROT GOLF HOTEL',
      passport_number: 'XY9876543',
      date_of_birth: '1985-07-08',
      sex: 'F',
    });

    await makeSyncProfileNode(fake.client)(docState);

    expect(fake.tables.document_verifications[0].result).toBe('pass');
    expect(details().holder_mismatch).toEqual({
      holder: 'FOXTROT GOLF HOTEL',
      applicant: 'TESTER, ALPHA BRAVO',
      message: expect.stringContaining('If it is not yours, upload your own.'),
      // Stored so the prefill can skip it too (2026-10-30).
      clearly_other: true,
    });
    expect(details().extracted_fields).toBeDefined();
    const stored = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(stored.full_name).toBe('TESTER, ALPHA BRAVO');
    expect(stored.date_of_birth).toBe('1990-02-03');
    expect(stored.passport_number).toBe('ZZ1234567');
    expect(stored.sex).toBeUndefined();
  });

  it("a relative's passport never becomes the applicant (live 2026-10-29 shape)", async () => {
    const { fake, docState, details } = setup(
      {
        full_name: 'MIAN MUHAMMAD UNIFORM',
        given_name: 'MIAN MUHAMMAD',
        family_name: 'UNIFORM',
        passport_number: 'XY9876543',
        date_of_birth: '1989-10-16',
        sex: 'M',
        place_of_birth: 'TESTVILLE',
      },
      {
        // The name the applicant stated in intake; no DOB given yet.
        given_name: 'Romeo Sierra',
        family_name: 'Kilo',
        passport_number: 'ZZ1234567',
        parents: [{ name: 'Muhammad Kilo Tango', relationship: 'father' }],
      },
    );

    await makeSyncProfileNode(fake.client)(docState);

    // Typed number differs, names share nothing, no DOB on the profile:
    // held for confirmation, nothing written.
    expect(details().holder_mismatch).toMatchObject({
      holder: 'MIAN MUHAMMAD UNIFORM',
      needs_confirmation: true,
    });
    const p = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(p.given_name).toBe('Romeo Sierra');
    expect(p.family_name).toBe('Kilo');
    expect(p.passport_number).toBe('ZZ1234567');
    expect(p.date_of_birth).toBeUndefined();
    expect(p.sex).toBeUndefined();
    expect(p.place_of_birth).toBeUndefined();
  });

  it('holds a passport whose name alone differs from the stated name: writes nothing, asks to confirm', async () => {
    const { fake, docState, details } = setup(
      {
        full_name: 'MIKE NOVEMBER OSCAR',
        passport_number: 'XY9876543',
        date_of_birth: '1989-10-16',
        sex: 'M',
      },
      { given_name: 'Romeo Sierra', family_name: 'Kilo' },
    );

    await makeSyncProfileNode(fake.client)(docState);

    expect(details().holder_mismatch).toMatchObject({
      holder: 'MIKE NOVEMBER OSCAR',
      needs_confirmation: true,
      message: expect.stringContaining('Confirm it'),
    });
    const p = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(p.given_name).toBe('Romeo Sierra');
    expect(p.date_of_birth).toBeUndefined();
    expect(p.passport_number).toBeUndefined();
    expect(p.sex).toBeUndefined();
  });

  it("still fills the profile from the applicant's own passport when the stated name differs only by order and a middle name", async () => {
    const { fake, docState, details } = setup(
      {
        full_name: 'KILO ROMEO SIERRA',
        passport_number: 'ZZ1234567',
        date_of_birth: '1989-10-16',
        sex: 'M',
      },
      { given_name: 'Romeo', family_name: 'Kilo' },
    );

    await makeSyncProfileNode(fake.client)(docState);

    expect(details().holder_mismatch).toBeUndefined();
    const p = fake.tables.application_profiles[0].profile_json as Record<
      string,
      unknown
    >;
    expect(p.date_of_birth).toBe('1989-10-16');
    expect(p.sex).toBe('M');
  });

  it("says nothing on the applicant's own passport, name in another order", async () => {
    const { fake, docState, details } = setup({
      full_name: 'Alpha Bravo Tester',
      passport_number: 'XY9876543',
    });

    await makeSyncProfileNode(fake.client)(docState);

    expect(details().holder_mismatch).toBeUndefined();
  });

  const stored = (fake: ReturnType<typeof makeFakeDb>) =>
    fake.tables.application_profiles[0].profile_json as Record<string, unknown>;

  it('only warns — and still fills gaps — when it is not CLEARLY someone else (a shared name part, no DOB on the profile)', async () => {
    const { fake, docState, details } = setup(
      {
        full_name: 'ALI FOXTROT GOLF',
        passport_number: 'XY9876543',
        date_of_birth: '1985-07-08',
        sex: 'F',
      },
      { full_name: 'Ali Bravo Tester', passport_number: 'ZZ1234567' },
    );

    await makeSyncProfileNode(fake.client)(docState);

    expect(details().holder_mismatch).toMatchObject({
      holder: 'ALI FOXTROT GOLF',
    });
    expect(details().holder_mismatch).not.toHaveProperty('clearlyOther');
    expect(stored(fake).sex).toBe('F');
    expect(stored(fake).date_of_birth).toBe('1985-07-08');
  });

  it("says nothing, and fills the profile, when the DOB is the applicant's (a spelling variant)", async () => {
    const { fake, docState, details } = setup({
      full_name: 'Completely Other Reading',
      passport_number: 'XY9876543',
      date_of_birth: '03.02.1990',
      sex: 'M',
    });

    await makeSyncProfileNode(fake.client)(docState);

    expect(details().holder_mismatch).toBeUndefined();
    expect(stored(fake).sex).toBe('M');
  });

  const earlierRead = (dob?: string, full_name = 'TESTER, ALPHA BRAVO') => ({
    full_name,
    passport_number: 'ZZ1234567',
    ...(dob ? { date_of_birth: dob } : {}),
    nationality: 'Testland',
    _document_sources: {
      nationality: {
        document_id: 'doc-9',
        document_type: 'passport',
        value: 'Testland',
      },
    },
  });

  it('retracts what a CLEARLY foreign document wrote on an earlier read', async () => {
    const { fake, docState } = setup(
      {
        full_name: 'FOXTROT GOLF HOTEL',
        passport_number: 'XY9876543',
        date_of_birth: '1985-07-08',
      },
      earlierRead('1990-02-03'),
    );

    await makeSyncProfileNode(fake.client)(docState);

    expect(stored(fake).nationality).toBeNull();
  });

  it('keeps what it wrote earlier when it is not clearly foreign (re-read of an existing user)', async () => {
    const { fake, docState } = setup(
      {
        full_name: 'ALI FOXTROT GOLF',
        passport_number: 'XY9876543',
        nationality: 'Testland',
      },
      earlierRead(undefined, 'Ali Bravo Tester'),
    );

    await makeSyncProfileNode(fake.client)(docState);

    expect(stored(fake).nationality).toBe('Testland');
  });
});

/**
 * Prod data written before the holder check: a stranger's passport filled
 * identity fields; a re-read must heal it. A degraded re-read (fewer than half
 * the fields this document wrote) is the case forgetOwnDocumentValues leaves
 * alone, so only the holder check's own-evidence rule can catch it.
 */
describe('syncProfile node — re-reading a document that wrote the profile itself', () => {
  const src = (value: unknown) => ({
    document_id: 'doc-9',
    document_type: 'passport',
    value,
  });
  // Eight keys this document wrote on an earlier, fuller read.
  const earlier: Record<string, unknown> = {
    passport_number: 'XY9876543',
    sex: 'F',
    nationality: 'Testland',
    place_of_birth: 'Testville',
    passport_issue_date: '2020-01-01',
    passport_expiry_date: '2030-01-01',
    given_name: 'FOXTROT',
    family_name: 'HOTEL',
  };
  function run(
    profileJson: Record<string, unknown>,
    extracted: Record<string, unknown>,
  ) {
    const fake = makeFakeDb({
      application_profiles: [
        { application_id: 'app-1', profile_json: profileJson },
      ],
      documents: [{ id: 'doc-9', checklist_item_id: 'item-1' }],
      checklist_items: [
        {
          id: 'item-1',
          application_id: 'app-1',
          document_type: 'passport',
          meta: { owner: 'applicant' },
        },
      ],
      document_verifications: [
        {
          id: 'ver-1',
          document_id: 'doc-9',
          verification_type: 'identity',
          result: 'pass',
          details_json: {},
        },
      ],
    });
    return makeSyncProfileNode(fake.client)({
      applicationId: 'app-1',
      documentId: 'doc-9',
      documentType: 'passport',
      rawOcrText: '',
      extractedFields: extracted,
    } as unknown as DocumentState).then(() => ({
      profile: fake.tables.application_profiles[0].profile_json as Record<
        string,
        unknown
      >,
      note: (
        fake.tables.document_verifications[0].details_json as Record<
          string,
          unknown
        >
      ).holder_mismatch,
    }));
  }

  it("holds (never retracts) a stranger's passport that filled the profile itself when no independent DOB differs", async () => {
    const { profile, note } = await run(
      {
        full_name: 'TESTER, ALPHA BRAVO',
        national_id_number: '1111111111',
        date_of_birth: '1990-02-03',
        ...earlier,
        _document_sources: Object.fromEntries(
          Object.entries(earlier).map(([k, v]) => [k, src(v)]),
        ),
      },
      {
        full_name: 'FOXTROT GOLF HOTEL',
        passport_number: 'XY9876543',
        national_id_number: '2222222222',
      },
    );

    // No DOB on this read: a differing number with a name sharing nothing
    // is held for confirmation; retraction needs a DOB that differs.
    expect(note).toMatchObject({
      holder: 'FOXTROT GOLF HOTEL',
      needs_confirmation: true,
    });
    expect(profile.passport_number).toBe('XY9876543');
    expect(profile.full_name).toBe('TESTER, ALPHA BRAVO');
  });

  it('retracts on a degraded re-read when number AND DOB differ from the remaining sources', async () => {
    const { profile, note } = await run(
      {
        full_name: 'TESTER, ALPHA BRAVO',
        national_id_number: '1111111111',
        date_of_birth: '1990-02-03',
        ...earlier,
        _document_sources: Object.fromEntries(
          Object.entries(earlier).map(([k, v]) => [k, src(v)]),
        ),
      },
      {
        full_name: 'FOXTROT GOLF HOTEL',
        passport_number: 'XY9876543',
        national_id_number: '2222222222',
        date_of_birth: '1985-07-08',
      },
    );

    expect(note).toMatchObject({ holder: 'FOXTROT GOLF HOTEL' });
    expect(profile.passport_number).toBeNull();
    expect(profile.sex).toBeNull();
    expect(profile.nationality).toBeNull();
    expect(profile.full_name).toBe('TESTER, ALPHA BRAVO');
    expect(profile.date_of_birth).toBe('1990-02-03');
  });

  it("holds, never retracts, a re-read of the applicant's OWN passport when only the stated name differs", async () => {
    const own: Record<string, unknown> = {
      ...earlier,
      passport_number: 'ZZ1234567',
      date_of_birth: '1990-02-03',
    };
    const { profile, note } = await run(
      {
        full_name: 'Kilo Tester',
        ...own,
        _document_sources: Object.fromEntries(
          Object.entries(own).map(([k, v]) => [k, src(v)]),
        ),
      },
      {
        full_name: 'ZULU YANKEE',
        passport_number: 'ZZ1234567',
        date_of_birth: '1990-02-03',
      },
    );

    expect(note).toMatchObject({ needs_confirmation: true });
    expect(profile.passport_number).toBe('ZZ1234567');
    expect(profile.date_of_birth).toBe('1990-02-03');
    expect(profile.sex).toBe('F');
    expect(profile.nationality).toBe('Testland');
  });

  it("never retracts on a re-read of the applicant's OWN passport whose number and DOB came only from itself", async () => {
    const own: Record<string, unknown> = {
      ...earlier,
      passport_number: 'ZZ1234567',
      date_of_birth: '1990-02-03',
    };
    const { profile } = await run(
      {
        // Intake name reads differently from the passport.
        full_name: 'Ali Tester',
        ...own,
        _document_sources: Object.fromEntries(
          Object.entries(own).map(([k, v]) => [k, src(v)]),
        ),
      },
      {
        full_name: 'ALI ZULU YANKEE',
        passport_number: 'ZZ1234567',
        date_of_birth: '1990-02-03',
      },
    );

    expect(profile.passport_number).toBe('ZZ1234567');
    expect(profile.date_of_birth).toBe('1990-02-03');
    expect(profile.sex).toBe('F');
    expect(profile.nationality).toBe('Testland');
  });
});
