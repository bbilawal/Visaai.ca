import {
  makeSyncProfileNode,
  mergeExtractedIntoProfile,
  INTENTIONALLY_UNMAPPED,
} from './sync-profile';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import {
  NIKAH_NAMA,
  PUNJAB_BIRTH_CERTS_TWO_CHILDREN,
} from '../../ocr/__fixtures__/civil-records.fixtures';
import { refineIdentityFields } from './classify-document';

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
    expect(upserts[0].profile_json).toEqual({ full_name: 'Ada Lovelace' });
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
