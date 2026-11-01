import { makeSyncProfileNode } from './sync-profile';
import type { DocumentState } from '../document.state';
import { makeFakeDb } from '../../family-gaps/__fixtures__/fake-db';

/**
 * Prod 2026-10-30 (after #299): a held or clearly-foreign passport writes
 * nothing to the profile, but a Forms page generated BEFORE the hold already
 * carried its name / DOB / number as source 'document'. The consultant review
 * and the IRCC fill read that saved form, so the stranger's identity survived.
 * sync_profile now clears exactly those values from the saved form.
 */
describe('syncProfile node — a held passport leaves the saved form', () => {
  const stranger = {
    full_name: 'QUEBEC ZULU',
    given_name: 'QUEBEC',
    family_name: 'ZULU',
    passport_number: 'XQ0000001',
    date_of_birth: '1970-01-01',
    place_of_birth: 'NOWHERESVILLE',
    sex: 'M',
  };

  function setup(
    profileJson: Record<string, unknown>,
    fields: Array<Record<string, unknown>>,
    extracted: Record<string, unknown> = stranger,
    ownPassport?: Record<string, unknown>,
  ) {
    const fake = makeFakeDb({
      application_profiles: [
        { application_id: 'app-1', profile_json: profileJson },
      ],
      documents: [
        { id: 'doc-9', application_id: 'app-1', checklist_item_id: 'item-1' },
        ...(ownPassport ? [{ id: 'doc-own', application_id: 'app-1' }] : []),
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
          details_json: { extracted_fields: extracted },
        },
        ...(ownPassport
          ? [
              {
                id: 'ver-own',
                document_id: 'doc-own',
                verification_type: 'identity',
                result: 'pass',
                details_json: { extracted_fields: ownPassport },
              },
            ]
          : []),
      ],
      application_item_reviews: [],
      generated_documents: [
        {
          id: 'gd-1',
          application_id: 'app-1',
          doc_type: 'prefilled_form_json',
          content_md: JSON.stringify({ visaType: 'x', fields }),
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
    const form = () =>
      JSON.parse(fake.tables.generated_documents[0].content_md as string)
        .fields as Array<{
        key: string;
        value: string;
        source?: string;
        needsReview?: boolean;
      }>;
    const field = (k: string) => form().find((f) => f.key === k);
    return { fake, docState, field, details };
  }

  const savedForm = [
    {
      key: 'family_name',
      label: 'Family name',
      value: 'ZULU',
      source: 'document',
    },
    {
      key: 'given_name',
      label: 'Given name',
      value: 'QUEBEC',
      source: 'document',
    },
    {
      key: 'date_of_birth',
      label: 'DOB',
      value: '1970-01-01',
      source: 'document',
    },
    {
      key: 'passport_number',
      label: 'Passport',
      value: 'XQ0000001',
      source: 'document',
    },
    {
      key: 'place_of_birth',
      label: 'POB',
      value: 'Nowheresville',
      source: 'document',
    },
    // A person typed the same value: theirs to keep.
    {
      key: 'city_of_birth',
      label: 'City',
      value: 'NOWHERESVILLE',
      source: 'applicant',
    },
    // Same value, but from the profile, not the document.
    {
      key: 'mother_family_name',
      label: 'Mother',
      value: 'ZULU',
      source: 'consultant',
    },
    // A document value that is not this passport's.
    {
      key: 'employer_name',
      label: 'Employer',
      value: 'Acme Test Co',
      source: 'document',
    },
  ];

  it.each([
    [
      'held for confirmation',
      { given_name: 'Romeo Sierra', family_name: 'Kilo' },
    ],
    [
      'clearly someone else',
      {
        full_name: 'TESTER, ALPHA BRAVO',
        passport_number: 'ZZ1234567',
        date_of_birth: '1990-02-03',
      },
    ],
  ])(
    'a passport %s: its document-sourced values are cleared, nothing else',
    async (_l, profile) => {
      const { fake, docState, field } = setup(profile, savedForm);

      await makeSyncProfileNode(fake.client)(docState);

      for (const k of [
        'family_name',
        'given_name',
        'date_of_birth',
        'passport_number',
      ]) {
        expect(field(k)).toMatchObject({ value: '', needsReview: true });
      }
      // A place is not the applicant's identity: a brother shares it.
      expect(field('place_of_birth')?.value).toBe('Nowheresville');
      expect(field('city_of_birth')?.value).toBe('NOWHERESVILLE');
      expect(field('mother_family_name')?.value).toBe('ZULU');
      expect(field('employer_name')?.value).toBe('Acme Test Co');
    },
  );

  it("leaves the saved form alone for the applicant's own passport", async () => {
    const { fake, docState } = setup(
      { given_name: 'Quebec', family_name: 'Zulu' },
      savedForm,
    );
    const before = fake.tables.generated_documents[0].content_md;

    await makeSyncProfileNode(fake.client)(docState);

    expect(fake.tables.generated_documents[0].content_md).toBe(before);
  });

  it("review 2026-10-30: a brother's clearly-other passport leaves every one of the applicant's own fields", async () => {
    const ali = {
      full_name: 'ALI KHAN',
      given_name: 'ALI',
      family_name: 'KHAN',
      passport_number: 'AK2222222',
      date_of_birth: '1990-05-06',
      place_of_birth: 'LAHORE',
      father_name: 'TARIQ KHAN',
    };
    const omar = {
      ...ali,
      full_name: 'OMAR KHAN',
      given_name: 'OMAR',
      passport_number: 'OK1111111',
      date_of_birth: '1988-03-04',
    };
    const form = [
      { key: 'family_name', label: 'F', value: 'KHAN', source: 'document' },
      { key: 'given_name', label: 'G', value: 'ALI', source: 'document' },
      {
        key: 'date_of_birth',
        label: 'D',
        value: '1990-05-06',
        source: 'document',
      },
      {
        key: 'place_of_birth',
        label: 'P',
        value: 'LAHORE',
        source: 'document',
      },
      {
        key: 'father_name',
        label: 'Fa',
        value: 'TARIQ KHAN',
        source: 'document',
      },
    ];
    const { fake, docState, details } = setup(
      {
        full_name: 'ALI KHAN',
        passport_number: 'AK2222222',
        date_of_birth: '1990-05-06',
      },
      form,
      omar,
      ali,
    );
    const before = fake.tables.generated_documents[0].content_md;

    await makeSyncProfileNode(fake.client)(docState);

    expect(details().holder_mismatch).toMatchObject({ clearly_other: true });
    expect(fake.tables.generated_documents[0].content_md).toBe(before);
  });
});
