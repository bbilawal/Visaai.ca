import { makeSyncProfileNode } from './sync-profile';
import type { DocumentState } from '../document.state';
import { makeFakeDb } from '../../family-gaps/__fixtures__/fake-db';

/**
 * 2026-10-30: a passport whose name shares nothing with the name the
 * applicant gave is held (needs_confirmation) until confirmed. The applicant
 * can now confirm it themselves ("This is my passport",
 * document_holder_confirmations). Once confirmed, a re-sync fills the
 * profile's identity from it like the applicant's own passport, and the name
 * they gave stays as one of their other names.
 */
describe('syncProfile node — a held passport the applicant confirmed', () => {
  const passport = {
    full_name: 'QUEBEC ZULU',
    given_name: 'QUEBEC',
    family_name: 'ZULU',
    passport_number: 'XQ0000001',
    date_of_birth: '1970-01-01',
    sex: 'M',
  };

  function setup(
    profileJson: Record<string, unknown>,
    opts: { confirmed?: boolean } = {},
  ) {
    const fake = makeFakeDb({
      application_profiles: [
        { application_id: 'app-1', profile_json: profileJson },
      ],
      documents: [
        { id: 'doc-9', application_id: 'app-1', checklist_item_id: 'item-1' },
      ],
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
          details_json: { extracted_fields: passport },
        },
      ],
      application_item_reviews: [],
      document_holder_confirmations: opts.confirmed
        ? [
            {
              id: 'c-1',
              document_id: 'doc-9',
              application_id: 'app-1',
              confirmed_by: 'user-1',
              holder_name: 'QUEBEC ZULU',
              stated_name: 'Romeo Sierra Kilo',
              created_at: '2026-10-30T10:00:00Z',
            },
          ]
        : [],
    });
    const docState = {
      applicationId: 'app-1',
      documentId: 'doc-9',
      documentType: 'passport',
      rawOcrText: '',
      extractedFields: passport,
    } as unknown as DocumentState;
    const profile = () =>
      fake.tables.application_profiles[0].profile_json as Record<
        string,
        unknown
      >;
    const details = () =>
      fake.tables.document_verifications[0].details_json as Record<
        string,
        unknown
      >;
    return { fake, docState, profile, details };
  }

  const stated = { given_name: 'Romeo Sierra', family_name: 'Kilo' };

  it('unconfirmed: held, nothing written (unchanged behaviour)', async () => {
    const { fake, docState, profile, details } = setup({ ...stated });
    await makeSyncProfileNode(fake.client)(docState);
    expect(profile().passport_number).toBeUndefined();
    expect(profile().given_name).toBe('Romeo Sierra');
    expect(details().holder_mismatch).toMatchObject({
      needs_confirmation: true,
    });
  });

  it("confirmed: the passport fills the applicant's identity; the stated name becomes an other name", async () => {
    const { fake, docState, profile, details } = setup(
      { ...stated },
      { confirmed: true },
    );
    await makeSyncProfileNode(fake.client)(docState);

    expect(profile()).toMatchObject({
      given_name: 'QUEBEC',
      family_name: 'ZULU',
      passport_number: 'XQ0000001',
      date_of_birth: '1970-01-01',
    });
    expect(profile().other_names).toEqual([
      expect.objectContaining({
        given_name: 'Romeo Sierra',
        family_name: 'Kilo',
      }),
    ]);
    // No hold any more; the confirmation is on the row for the vault and the
    // consultant to see.
    expect(details().holder_mismatch).toBeUndefined();
    expect(details().holder_confirmation).toMatchObject({
      confirmed_at: '2026-10-30T10:00:00Z',
      holder: 'QUEBEC ZULU',
      stated_name: 'Romeo Sierra Kilo',
    });
  });

  it('confirmed again (a re-read): the other name is not added twice', async () => {
    const { fake, docState, profile } = setup(
      { ...stated },
      { confirmed: true },
    );
    await makeSyncProfileNode(fake.client)(docState);
    await makeSyncProfileNode(fake.client)(docState);
    expect(profile().other_names).toHaveLength(1);
  });

  it('confirmed, with a stated name that is the same person: no other name', async () => {
    const { fake, docState, profile } = setup(
      {
        given_name: 'Quebec',
        family_name: 'Zulu',
        passport_number: 'AB1234567',
      },
      { confirmed: true },
    );
    await makeSyncProfileNode(fake.client)(docState);
    expect(profile().other_names).toBeUndefined();
  });

  it('a confirmation never releases a passport that is clearly someone else', async () => {
    const { fake, docState, profile, details } = setup(
      {
        full_name: 'TESTER, ALPHA BRAVO',
        passport_number: 'ZZ1234567',
        date_of_birth: '1990-02-03',
      },
      { confirmed: true },
    );
    await makeSyncProfileNode(fake.client)(docState);
    expect(profile().passport_number).toBe('ZZ1234567');
    expect(profile().date_of_birth).toBe('1990-02-03');
    expect(details().holder_mismatch).toMatchObject({ clearly_other: true });
    expect(details().holder_confirmation).toBeUndefined();
  });
});
