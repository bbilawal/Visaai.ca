import type { PrefilledFormField } from '@visaai/types';
import { finalizeFields, type FinalizeContext } from './finalize-fields';
import { mergePersonFields, personFieldsOf } from './store-prefill';

/**
 * Prod 2026-10-29 (Canada visitor visa): the interview recorded nine trips in
 * `travel_history` and the spouse's full name, yet the Forms page showed two
 * trips (the form generator transcribed only the last two) and empty spouse
 * family / given name fields. Names and places here are invented.
 */
const TRV = {
  country: 'CA',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
};

function f(
  key: string,
  value: string,
  source: PrefilledFormField['source'] = 'profile',
  group = 'Travel',
): PrefilledFormField {
  return { key, label: key, value, source, group };
}

function ctx(profile: Record<string, unknown>): FinalizeContext {
  return {
    applicantName: 'TARIQ NADEEM',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: TRV,
  };
}

const trip = (
  country: string,
  from: string,
  to: string,
  city: string,
  purpose = 'tourism',
) => ({ country, from, to, city, purpose });

const NINE = [
  trip('Thailand', '2022-03', '2022-03', 'Phuket'),
  trip('Turkey', '2022-06', '2022-06', 'Ankara'),
  trip('United Arab Emirates', '2022-11', '2022-11', 'Abu Dhabi'),
  trip('Malaysia', '2023-02', '2023-02', 'Penang'),
  trip('Singapore', '2023-02', '2023-03', 'unknown'),
  trip('Indonesia', '2023-03', '2023-03', 'Lombok'),
  trip('United Arab Emirates', '2024-04', '2024-04', 'Sharjah'),
  trip('Thailand', '2025-10', '2025-11', 'Chiang Mai'),
  trip('Saudi Arabia', '2026-01', '2026-01', 'Madinah', 'Umrah pilgrimage'),
];

const rowKeys = (fields: PrefilledFormField[]) =>
  [
    ...new Set(
      fields
        .map((x) => /^travel_history_(\d+)_/.exec(x.key)?.[1])
        .filter(Boolean),
    ),
  ].map(Number);

describe('finalizeFields — every recorded trip is on the Forms page', () => {
  it('lists all nine trips although the generator wrote only the last two', () => {
    const generated = [
      f('travelled_last_5_years', 'Yes'),
      f('travel_history_1_country', 'Thailand'),
      f('travel_history_1_city', 'Chiang Mai'),
      f('travel_history_1_from', '2025-10'),
      f('travel_history_1_to', '2025-11'),
      f('travel_history_1_purpose', 'Tourism'),
      f('travel_history_2_country', 'Saudi Arabia'),
      f('travel_history_2_city', 'Madinah'),
      f('travel_history_2_from', '2026-01'),
      f('travel_history_2_to', '2026-01'),
      f('travel_history_2_purpose', 'Umrah pilgrimage'),
    ];
    const out = finalizeFields(
      generated,
      ctx({ travelled_last_5_years: true, travel_history: NINE }),
    );
    expect(rowKeys(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const v = (k: string) => out.find((x) => x.key === k)?.value;
    expect(v('travel_history_1_country')).toBe('Thailand');
    expect(v('travel_history_1_from')).toBe('2022-03');
    expect(v('travel_history_2_city')).toBe('Ankara');
    expect(v('travel_history_5_country')).toBe('Singapore');
    expect(v('travel_history_5_to')).toBe('2023-03');
    // "unknown" is not a place: left for the applicant, not written.
    expect(v('travel_history_5_city')).toBe('');
    expect(v('travel_history_9_country')).toBe('Saudi Arabia');
    expect(v('travel_history_9_purpose')).toBe('Umrah pilgrimage');
    // One row per trip: no stale generator row left behind.
    expect(out.filter((x) => x.key === 'travel_history_1_country')).toHaveLength(1);
    expect(out.find((x) => x.key === 'travelled_last_5_years')?.value).toBe('Yes');
  });

  it('leaves an empty trip part plain: IRCC fill does not read these rows', () => {
    const out = finalizeFields([], ctx({ travel_history: NINE }));
    const city = out.find((x) => x.key === 'travel_history_5_city');
    expect(city?.value).toBe('');
    expect(city?.needsReview).toBeUndefined();
    expect(city?.note).toBeUndefined();
  });
});

/** Regenerate as the graph runs it: generate-fields, then store-prefill. */
function regenerate(
  draft: PrefilledFormField[],
  storedForm: PrefilledFormField[],
  profile: Record<string, unknown>,
) {
  const raw = JSON.stringify({ fields: storedForm });
  const person = personFieldsOf(raw);
  const finalized = finalizeFields(mergePersonFields(draft, person), ctx(profile));
  return mergePersonFields(finalized, personFieldsOf(raw));
}

const row = (n: number, t: ReturnType<typeof trip>, src: PrefilledFormField['source'] = 'profile') => [
  f(`travel_history_${n}_country`, t.country, src),
  f(`travel_history_${n}_city`, t.city, src),
  f(`travel_history_${n}_from`, t.from, src),
  f(`travel_history_${n}_to`, t.to, src),
  f(`travel_history_${n}_purpose`, t.purpose, src),
];

describe('Regenerate — a person’s trip edit stays on its own trip', () => {
  it('an edit to old row 1 (trip 8) lands on trip 8, not on trip 1', () => {
    const stored = [...row(1, NINE[7]), ...row(2, NINE[8])];
    stored[1] = f('travel_history_1_city', 'Pattaya', 'applicant');
    const draft = [...row(1, NINE[7]), ...row(2, NINE[8])];
    const out = regenerate(draft, stored, { travel_history: NINE });
    const v = (k: string) => out.filter((x) => x.key === k);
    expect(v('travel_history_1_city')[0].value).toBe('Phuket');
    expect(v('travel_history_1_country')[0].value).toBe('Thailand');
    expect(v('travel_history_8_city')).toHaveLength(1);
    expect(v('travel_history_8_city')[0].value).toBe('Pattaya');
    expect(v('travel_history_8_city')[0].source).toBe('applicant');
    expect(rowKeys(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('an edit to a trip no longer recorded is kept in its own row, inside the travel rows', () => {
    const gone = trip('Japan', '2021-12', '2021-12', 'Osaka');
    const stored = [...row(1, NINE[0]), ...row(10, gone)];
    stored[6] = f('travel_history_10_city', 'Kyoto', 'applicant');
    const out = regenerate([], stored, { travel_history: NINE });
    expect(rowKeys(out)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const tenCity = out.filter((x) => x.key === 'travel_history_10_city');
    expect(tenCity).toHaveLength(1);
    expect(tenCity[0].value).toBe('Kyoto');
    expect(out.find((x) => x.key === 'travel_history_10_country')?.value).toBe('Japan');
    // No other trip took the edit.
    expect(out.filter((x) => x.value === 'Kyoto')).toHaveLength(1);
    // Row 10 sits with the trip rows, in their group.
    const idx = out.findIndex((x) => x.key === 'travel_history_10_city');
    expect(out[idx].group).toBe('Travel');
    const lastNine = out.findIndex((x) => x.key === 'travel_history_9_purpose');
    const tripIdx = out
      .map((x, i) => (/^travel_history_\d+_/.test(x.key) ? i : -1))
      .filter((i) => i >= 0);
    expect(tripIdx).toEqual(
      Array.from({ length: tripIdx.length }, (_, i) => tripIdx[0] + i),
    );
    expect(idx).toBeGreaterThan(lastNine);
  });
});

describe('finalizeFields — spouse names from the recorded full name', () => {
  it('splits spouse_name into the empty family and given name fields', () => {
    const generated = [
      f('marital_status', 'Married', 'profile', 'Family'),
      f('spouse_family_name', '', 'profile', 'Family'),
      f('spouse_given_name', '', 'profile', 'Family'),
      f('spouse_date_of_birth', '1994-02-03', 'profile', 'Family'),
    ];
    const out = finalizeFields(
      generated,
      ctx({ marital_status: 'Married', spouse_name: 'Saima Rehan Malik' }),
    );
    expect(out.find((x) => x.key === 'spouse_family_name')?.value).toBe('Malik');
    expect(out.find((x) => x.key === 'spouse_given_name')?.value).toBe(
      'Saima Rehan',
    );
  });

  it('prefers parts the applicant gave over a split of the full name', () => {
    const out = finalizeFields(
      [f('spouse_family_name', ''), f('spouse_given_name', '')],
      ctx({
        marital_status: 'Married',
        spouse_name: 'Saima Rehan Malik',
        spouse_family_name: 'Rehan Malik',
        spouse_given_name: 'Saima',
      }),
    );
    expect(out.find((x) => x.key === 'spouse_family_name')?.value).toBe(
      'Rehan Malik',
    );
    expect(out.find((x) => x.key === 'spouse_given_name')?.value).toBe('Saima');
  });
});
