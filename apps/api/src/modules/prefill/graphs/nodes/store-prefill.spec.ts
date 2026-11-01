import { makeStorePrefillNode } from './store-prefill';

const state: any = {
  applicationId: 'app-1',
  context: { visaType: 'visitor', countryCode: 'CA', purpose: 'tourism' },
  fields: [{ key: 'family_name', label: 'Family name', value: 'Ada' }],
};

describe('storePrefill', () => {
  it('uses the database uniqueness invariant as the concurrency-safe write path', async () => {
    const single = jest
      .fn()
      .mockResolvedValue({ data: { id: 'doc-1' }, error: null });
    const select = jest.fn().mockReturnValue({ single });
    const upsert = jest.fn().mockReturnValue({ select });
    const noForm: any = {
      eq: () => noForm,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const supabase = {
      from: jest.fn().mockReturnValue({ upsert, select: () => noForm }),
    } as any;

    const result = await makeStorePrefillNode(supabase)(state);

    expect(supabase.from).toHaveBeenCalledWith('generated_documents');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        application_id: 'app-1',
        doc_type: 'prefilled_form_json',
        approved_by_user: false,
      }),
      { onConflict: 'application_id,doc_type' },
    );
    expect(result.generatedDocumentId).toBe('doc-1');
  });

  it('does not hide an upsert failure', async () => {
    const single = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'unique failure' } });
    const supabase = {
      from: jest.fn().mockReturnValue({
        upsert: jest
          .fn()
          .mockReturnValue({ select: jest.fn().mockReturnValue({ single }) }),
        select: () => {
          const c: any = {
            eq: () => c,
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return c;
        },
      }),
    } as any;

    await expect(makeStorePrefillNode(supabase)(state)).rejects.toThrow(
      'Failed to store prefilled form: unique failure',
    );
  });

  /**
   * Review finding: Regenerate upserted a fresh draft over the whole form, so a
   * consultant's correction (what auto-fill writes) was silently replaced by
   * the model's guess. Consultant-sourced values survive a regeneration.
   */
  it('keeps consultant corrections across a regeneration', async () => {
    const existing = {
      fields: [
        {
          key: 'family_name',
          label: 'Family name',
          value: 'AHMAD',
          source: 'consultant',
        },
        {
          key: 'nationality',
          label: 'Nationality',
          value: 'Pakistan',
          source: 'consultant',
        },
        {
          key: 'occupation',
          label: 'Occupation',
          value: 'old',
          source: 'profile',
        },
      ],
    };
    const single = jest
      .fn()
      .mockResolvedValue({ data: { id: 'doc-1' }, error: null });
    const upsert = jest
      .fn()
      .mockReturnValue({ select: jest.fn().mockReturnValue({ single }) });
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { content_md: JSON.stringify(existing) },
      error: null,
    });
    const readChain: any = { eq: () => readChain, maybeSingle };
    const supabase = {
      from: jest.fn().mockReturnValue({ upsert, select: () => readChain }),
    } as any;

    const result = await makeStorePrefillNode(supabase)({
      ...state,
      fields: [
        {
          key: 'family_name',
          label: 'Family name',
          value: 'Ada',
          source: 'document',
        },
        {
          key: 'occupation',
          label: 'Occupation',
          value: 'new',
          source: 'profile',
        },
      ],
    });

    const byKey = Object.fromEntries(
      result.payload!.fields.map((f: any) => [f.key, f]),
    );
    expect(byKey.family_name).toMatchObject({
      value: 'AHMAD',
      source: 'consultant',
    });
    expect(byKey.nationality).toMatchObject({
      value: 'Pakistan',
      source: 'consultant',
    });
    expect(byKey.occupation).toMatchObject({ value: 'new' });
  });

  it("keeps the applicant's own typed answers across a regeneration (dry run 2026-10-18)", async () => {
    const existing = {
      fields: [
        {
          key: 'father_occupation',
          label: 'Father occupation',
          value: 'Retired',
          source: 'applicant',
        },
        {
          key: 'city_of_birth',
          label: 'City of birth',
          value: '',
          source: 'applicant',
        },
        {
          key: 'occupation',
          label: 'Occupation',
          value: 'old',
          source: 'profile',
        },
      ],
    };
    const single = jest
      .fn()
      .mockResolvedValue({ data: { id: 'doc-1' }, error: null });
    const upsert = jest
      .fn()
      .mockReturnValue({ select: jest.fn().mockReturnValue({ single }) });
    const maybeSingle = jest.fn().mockResolvedValue({
      data: { content_md: JSON.stringify(existing) },
      error: null,
    });
    const readChain: any = { eq: () => readChain, maybeSingle };
    const supabase = {
      from: jest.fn().mockReturnValue({ upsert, select: () => readChain }),
    } as any;
    const result = await makeStorePrefillNode(supabase)({
      ...state,
      fields: [
        {
          key: 'father_occupation',
          label: 'Father occupation',
          value: '',
          source: 'inferred',
        },
        {
          key: 'city_of_birth',
          label: 'City of birth',
          value: 'Rawalpindi',
          source: 'document',
        },
        {
          key: 'occupation',
          label: 'Occupation',
          value: 'new',
          source: 'profile',
        },
      ],
    });
    const byKey = Object.fromEntries(
      result.payload!.fields.map((f: any) => [f.key, f]),
    );
    expect(byKey.father_occupation).toMatchObject({
      value: 'Retired',
      source: 'applicant',
    });
    // An answer the applicant cleared is not kept over a new value.
    expect(byKey.city_of_birth).toMatchObject({ value: 'Rawalpindi' });
    expect(byKey.occupation).toMatchObject({ value: 'new' });
  });
});

describe('mergePersonFields (regeneration starts from what people entered)', () => {
  const { mergePersonFields } = jest.requireActual(
    './store-prefill',
  ) as typeof import('./store-prefill');
  it('a kept answer replaces an empty field of the same label the generator renamed', () => {
    const out = mergePersonFields(
      [
        {
          key: 'funds_available',
          label: 'Funds available for stay in Canada',
          value: '',
          source: 'inferred',
        },
      ],
      [
        {
          key: 'funds_available_for_stay',
          label: 'Funds available for stay in Canada',
          value: '30000',
          source: 'applicant',
        },
      ],
    );
    expect(out).toEqual([
      {
        key: 'funds_available_for_stay',
        label: 'Funds available for stay in Canada',
        value: '30000',
        source: 'applicant',
      },
    ]);
  });
  it('a filled draft field of the same label is not replaced; the kept one is appended', () => {
    const out = mergePersonFields(
      [{ key: 'a', label: 'X', value: 'draft', source: 'document' }],
      [{ key: 'b', label: 'X', value: 'typed', source: 'applicant' }],
    );
    expect(out.map((f) => f.key)).toEqual(['a', 'b']);
  });
});

/**
 * Race (review 2026-10-30): a Regenerate that read the verifications before
 * sync_profile held a passport could store the stranger's identity again.
 * The store re-applies the hold right before it writes.
 */
import { makeFakeDb } from '../../../documents/family-gaps/__fixtures__/fake-db';

describe('storePrefill — a passport held after the generator read it', () => {
  function client(reviews: Array<Record<string, unknown>> = []) {
    const fake = makeFakeDb({
      documents: [
        { id: 'doc-held', application_id: 'app-1' },
        { id: 'doc-own', application_id: 'app-1' },
      ],
      document_verifications: [
        {
          document_id: 'doc-held',
          verification_type: 'identity',
          details_json: {
            extracted_fields: {
              family_name: 'ZULU',
              given_name: 'QUEBEC',
              date_of_birth: '1970-01-01',
            },
            holder_mismatch: { needs_confirmation: true },
          },
        },
        {
          document_id: 'doc-own',
          verification_type: 'identity',
          details_json: { extracted_fields: { other_field: 'x' } },
        },
      ],
      application_item_reviews: reviews,
      application_profiles: [
        {
          application_id: 'app-1',
          profile_json: { given_name: 'Romeo', family_name: 'Kilo' },
        },
      ],
    });
    const upsert = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({ data: { id: 'gd-1' }, error: null }),
      }),
    });
    const noForm: any = {
      eq: () => noForm,
      maybeSingle: async () => ({ data: null, error: null }),
    };
    const supabase = {
      from: (t: string) =>
        t === 'generated_documents'
          ? { upsert, select: () => noForm }
          : fake.client.from(t),
    } as any;
    return { supabase, upsert };
  }
  const st = {
    ...state,
    fields: [
      { key: 'family_name', label: 'F', value: 'ZULU', source: 'document' },
      {
        key: 'date_of_birth',
        label: 'D',
        value: '1970-01-01',
        source: 'document',
      },
      { key: 'employer_name', label: 'E', value: 'Acme', source: 'document' },
    ],
  };
  const stored = (upsert: jest.Mock) =>
    JSON.parse(upsert.mock.calls[0][0].content_md).fields as Array<{
      key: string;
      value: string;
    }>;

  it("clears the held passport's identity before writing", async () => {
    const { supabase, upsert } = client();
    await makeStorePrefillNode(supabase)(st);
    expect(
      Object.fromEntries(stored(upsert).map((f) => [f.key, f.value])),
    ).toEqual({
      family_name: '',
      date_of_birth: '',
      employer_name: 'Acme',
    });
  });

  it('keeps it once the consultant approved the held passport', async () => {
    const { supabase, upsert } = client([
      {
        application_id: 'app-1',
        item_kind: 'document',
        item_id: 'doc-held',
        decision: 'approved',
        created_at: '2026-10-30T00:00:00Z',
      },
    ]);
    await makeStorePrefillNode(supabase)(st);
    expect(stored(upsert)[0].value).toBe('ZULU');
  });
});
