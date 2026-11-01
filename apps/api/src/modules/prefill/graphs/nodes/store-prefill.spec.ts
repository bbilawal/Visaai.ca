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
    const maybeSingle = jest
      .fn()
      .mockResolvedValue({
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
});
