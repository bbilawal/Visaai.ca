import type { PrefilledFormField } from '@visaai/types';
import {
  documentHolds,
  holdOf,
  withoutHeldDocumentValues,
  identityKind,
  loadApprovedDocumentIds,
  releasedDocumentIds,
  scrubHeldIdentity,
} from './held-identity';

/**
 * Review of the first cut (2026-10-30): clearing every document-sourced field
 * whose value matched ANY of a held passport's name/birth values blanked the
 * applicant's own surname, father's name and birthplace whenever the held
 * passport was a brother's or a spouse's. Only the applicant's identity
 * fields are cleared, only on an exact same-kind match, and never when the
 * applicant's own profile or document holds the same value.
 */
const f = (
  key: string,
  value: string,
  source: PrefilledFormField['source'] = 'document',
): PrefilledFormField => ({
  key,
  label: key,
  value,
  source,
});
const byKey = (fields: PrefilledFormField[]) =>
  Object.fromEntries(fields.map((x) => [x.key, x.value]));

describe('identityKind', () => {
  it.each([
    ['family_name', 'family'],
    ['surname', 'family'],
    ['given_name', 'given'],
    ['full_name', 'full'],
    ['date_of_birth', 'dob'],
    ['passport_number', 'number'],
    ['passport_issue_date', 'issue'],
    ['passport_expiry_date', 'expiry'],
  ])('%s is %s', (k, kind) => expect(identityKind(k)).toBe(kind));

  it.each([
    'father_family_name',
    'spouse_family_name',
    'mother_given_name',
    'place_of_birth',
    'country_of_birth',
    'city_of_birth',
    'nationality',
    'place_of_issue',
    'host_date_of_birth',
  ])('%s is not the applicant identity', (k) =>
    expect(identityKind(k)).toBeNull(),
  );
});

describe('scrubHeldIdentity', () => {
  const omar = {
    full_name: 'OMAR KHAN',
    given_name: 'OMAR',
    family_name: 'KHAN',
    date_of_birth: '1988-03-04',
    passport_number: 'OK1111111',
    place_of_birth: 'LAHORE',
    country_of_birth: 'Pakistan',
    father_name: 'TARIQ KHAN',
    place_of_issue: 'LAHORE',
  };
  const ali = {
    full_name: 'ALI KHAN',
    given_name: 'ALI',
    family_name: 'KHAN',
    date_of_birth: '1990-05-06',
    passport_number: 'AK2222222',
    place_of_birth: 'LAHORE',
    country_of_birth: 'Pakistan',
    father_name: 'TARIQ KHAN',
    place_of_issue: 'LAHORE',
  };

  it("keeps all of Ali's fields when his brother Omar's passport is held", () => {
    const fields = [
      f('family_name', 'KHAN'),
      f('given_name', 'ALI'),
      f('date_of_birth', '1990-05-06'),
      f('passport_number', 'AK2222222'),
      f('place_of_birth', 'LAHORE'),
      f('country_of_birth', 'Pakistan'),
      f('father_name', 'TARIQ KHAN'),
      f('place_of_issue', 'LAHORE'),
    ];
    const before = byKey(fields);
    expect(scrubHeldIdentity(fields, [omar], [ali])).toBe(0);
    expect(byKey(fields)).toEqual(before);
  });

  it("a spouse's held passport with a shared surname leaves the applicant's surname (stated in the profile)", () => {
    const fields = [f('family_name', 'Khan'), f('given_name', 'Ali')];
    const spouse = {
      full_name: 'SARA KHAN',
      given_name: 'SARA',
      family_name: 'KHAN',
      place_of_birth: 'LAHORE',
    };
    expect(
      scrubHeldIdentity(
        fields,
        [spouse],
        [{ given_name: 'Ali', family_name: 'Khan' }],
      ),
    ).toBe(0);
    expect(byKey(fields)).toEqual({ family_name: 'Khan', given_name: 'Ali' });
  });

  it("945eb7f1 shape: no own passport, a held stranger's name and DOB are cleared", () => {
    const stranger = {
      full_name: 'QUEBEC ZULU',
      given_name: 'QUEBEC',
      family_name: 'ZULU',
      date_of_birth: '1970-01-01',
      passport_number: 'XQ0000001',
      place_of_birth: 'NOWHERESVILLE',
    };
    const fields = [
      f('family_name', 'ZULU'),
      f('given_name', 'QUEBEC'),
      f('date_of_birth', '1970-01-01'),
      f('passport_number', 'XQ0000001'),
      f('place_of_birth', 'NOWHERESVILLE'),
      f('given_name_typed', 'QUEBEC', 'applicant'),
    ];
    expect(
      scrubHeldIdentity(
        fields,
        [stranger],
        [{ given_name: 'Romeo', family_name: 'Kilo' }],
      ),
    ).toBe(4);
    expect(byKey(fields)).toMatchObject({
      family_name: '',
      given_name: '',
      date_of_birth: '',
      passport_number: '',
      place_of_birth: 'NOWHERESVILLE',
    });
    expect(fields[0].needsReview).toBe(true);
  });

  it('never clears an applicant or consultant entry, and compares same kind only', () => {
    const fields = [
      f('family_name', 'ZULU', 'consultant'),
      f('given_name', 'ZULU'), // a surname value in a given-name field
    ];
    expect(scrubHeldIdentity(fields, [{ family_name: 'ZULU' }], [])).toBe(0);
  });
});

describe('releasedDocumentIds / holdOf — the applicant confirmed a held passport', () => {
  const held = {
    holder_mismatch: { holder: 'X', applicant: 'Y', needs_confirmation: true },
  };
  const other = {
    holder_mismatch: { holder: 'X', applicant: 'Y', clearly_other: true },
  };
  const review = (decision: string, at: string) => ({
    item_kind: 'document',
    item_id: 'd1',
    decision,
    created_at: at,
  });

  it('an applicant confirmation releases the hold like an approval', () => {
    const released = releasedDocumentIds([], new Set(['d1']));
    expect(holdOf(held, 'd1', released)).toBeNull();
    expect(holdOf(held, 'd2', released)).toBe('unattributed');
  });

  it('never releases a document that is clearly someone else', () => {
    expect(holdOf(other, 'd1', releasedDocumentIds([], new Set(['d1'])))).toBe(
      'third_party',
    );
  });

  it("a consultant's re-upload request or rejection keeps it held", () => {
    for (const d of ['needs_reupload', 'rejected']) {
      const released = releasedDocumentIds(
        [review(d, '2026-10-30T02:00:00Z')],
        new Set(['d1']),
      );
      expect(holdOf(held, 'd1', released)).toBe('unattributed');
    }
  });

  it('a consultant approval still releases it, the latest decision winning', () => {
    expect(
      releasedDocumentIds(
        [
          review('needs_reupload', '2026-10-30T01:00:00Z'),
          review('approved', '2026-10-30T02:00:00Z'),
        ],
        new Set(),
      ).has('d1'),
    ).toBe(true);
  });
});

describe('loadApprovedDocumentIds', () => {
  const db = (tables: Record<string, unknown>) =>
    ({
      from: (t: string) => {
        const q = {
          select: () => q,
          eq: () => q,
          then: (res: (v: unknown) => unknown) =>
            Promise.resolve(
              t in tables
                ? { data: tables[t], error: null }
                : { data: null, error: { message: 'relation does not exist' } },
            ).then(res),
        };
        return q;
      },
    }) as never;

  it('includes documents the applicant confirmed', async () => {
    const ids = await loadApprovedDocumentIds(
      db({
        application_item_reviews: [],
        document_holder_confirmations: [{ document_id: 'd1' }],
      }),
      'app-1',
    );
    expect([...ids]).toEqual(['d1']);
  });

  it('an unreadable confirmations table releases nothing extra (fails closed)', async () => {
    const ids = await loadApprovedDocumentIds(
      db({ application_item_reviews: [] }),
      'app-1',
    );
    expect(ids.size).toBe(0);
  });
});

describe('a confirmation the consultant later rejected re-holds the passport', () => {
  const confirmedNote = {
    holder_confirmation: { confirmed_at: '2026-10-30T10:00:00Z' },
  };
  const review = (decision: string) => ({
    item_kind: 'document',
    item_id: 'd1',
    decision,
    created_at: '2026-10-30T12:00:00Z',
  });

  it.each(['rejected', 'needs_reupload'])(
    '%s after the confirmation: revoked, and holdOf holds it even without a hold note',
    (d) => {
      const holds = documentHolds([review(d)], new Set(['d1']));
      expect(holds.released.has('d1')).toBe(false);
      expect(holds.revoked.has('d1')).toBe(true);
      // sync_profile replaced the hold note with holder_confirmation.
      expect(holdOf(confirmedNote, 'd1', holds.released, holds.revoked)).toBe(
        'unattributed',
      );
      // An owner who deleted every note from details_json is held all the same.
      expect(holdOf({}, 'd1', holds.released, holds.revoked)).toBe(
        'unattributed',
      );
    },
  );

  it('a later consultant approval releases it again', () => {
    const holds = documentHolds(
      [
        review('rejected'),
        { ...review('approved'), created_at: '2026-10-30T13:00:00Z' },
      ],
      new Set(['d1']),
    );
    expect(holds.revoked.size).toBe(0);
    expect(
      holdOf(confirmedNote, 'd1', holds.released, holds.revoked),
    ).toBeNull();
  });

  it('clearly someone else stays third_party', () => {
    const holds = documentHolds([review('rejected')], new Set(['d1']));
    expect(
      holdOf(
        {
          holder_mismatch: { holder: 'X', applicant: 'Y', clearly_other: true },
        },
        'd1',
        holds.released,
        holds.revoked,
      ),
    ).toBe('third_party');
  });
});

describe('withoutHeldDocumentValues — the profile a held document wrote', () => {
  it('drops the values a held document wrote and nobody changed since', () => {
    const profile = {
      given_name: 'QUEBEC',
      family_name: 'Changed By Applicant',
      passport_number: 'XQ0000001',
      employer: 'Acme',
      _document_sources: {
        given_name: { document_id: 'd1', value: 'QUEBEC' },
        family_name: { document_id: 'd1', value: 'ZULU' },
        passport_number: { document_id: 'd1', value: 'XQ0000001' },
        employer: { document_id: 'd2', value: 'Acme' },
      },
    };
    const out = withoutHeldDocumentValues(profile, new Set(['d1']));
    expect(out.given_name).toBeUndefined();
    expect(out.passport_number).toBeUndefined();
    expect(out.family_name).toBe('Changed By Applicant');
    expect(out.employer).toBe('Acme');
  });

  it('returns the profile unchanged when nothing is held', () => {
    const p = { a: 1 };
    expect(withoutHeldDocumentValues(p, new Set())).toBe(p);
  });
});
