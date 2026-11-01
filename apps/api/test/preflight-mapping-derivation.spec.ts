import {
  applyPrefillOverrides,
  buildInstructionsFromMapping,
  buildMappingInputs,
} from '../src/modules/automation/fill-instructions';
import type { PortalFillMapping } from '../src/strategies/portal-integration/portal-fill.registry';

const MAPPING: PortalFillMapping = [
  {
    profileKey: 'given_name',
    selector: '#given-name',
    action: 'fill',
    label: 'Given name',
    category: 'passport',
  },
  {
    profileKey: 'date_of_birth',
    selector: '#dob',
    action: 'fill',
    label: 'Date of birth',
    category: 'passport',
  },
  {
    profileKey: 'duration_of_stay_days',
    selector: '#duration',
    action: 'fill',
    label: 'Duration',
    category: 'dates',
  },
  {
    profileKey: 'employer_name',
    selector: '#employer',
    action: 'fill',
    label: 'Employer',
    category: 'employment',
    requires: 'employed',
  },
];

const PROFILE = {
  full_name: 'Ada Lovelace',
  date_of_birth: '1815-12-10',
  duration_of_stay_days: 14,
  employer_name: 'Analytical Engines Ltd',
  employed: true,
};

describe('preflight mapping derivation', () => {
  it('emits fieldKey/targetField/mappedValue/category per writable field', () => {
    expect(buildMappingInputs(MAPPING, PROFILE)).toEqual([
      {
        fieldKey: 'given_name',
        targetField: '#given-name',
        mappedValue: 'Ada',
        category: 'passport',
      },
      {
        fieldKey: 'date_of_birth',
        targetField: '#dob',
        mappedValue: '1815-12-10',
        category: 'passport',
      },
      {
        fieldKey: 'duration_of_stay_days',
        targetField: '#duration',
        mappedValue: '14',
        category: 'dates',
      },
      {
        fieldKey: 'employer_name',
        targetField: '#employer',
        mappedValue: 'Analytical Engines Ltd',
        category: 'employment',
      },
    ]);
  });

  /**
   * The load-bearing property. The consultant locks a hash over these mappings;
   * the write plan writes targetField=mappedValue. If the two builders ever
   * diverged, a field could be written that no category sign-off covered.
   */
  it('resolves exactly the same fields, selectors and values as the fill builder', () => {
    const inputs = buildMappingInputs(MAPPING, PROFILE);
    const steps = buildInstructionsFromMapping(MAPPING, PROFILE);

    expect(inputs.map((i) => i.targetField)).toEqual(
      steps.map((s) => s.selector),
    );
    expect(inputs.map((i) => i.mappedValue)).toEqual(steps.map((s) => s.value));
  });

  it('applies the same `requires` gate as the fill builder', () => {
    const unemployed = { ...PROFILE, employed: false };
    const inputs = buildMappingInputs(MAPPING, unemployed);
    const steps = buildInstructionsFromMapping(MAPPING, unemployed);

    expect(inputs.some((i) => i.fieldKey === 'employer_name')).toBe(false);
    expect(inputs).toHaveLength(steps.length);
  });

  it('skips absent and empty values rather than writing blanks', () => {
    const sparse = { full_name: 'Ada Lovelace', duration_of_stay_days: '' };
    const inputs = buildMappingInputs(MAPPING, sparse);
    expect(inputs.map((i) => i.fieldKey)).toEqual(['given_name']);
  });

  it('is deterministic — the same inputs derive the same array every time', () => {
    expect(buildMappingInputs(MAPPING, PROFILE)).toEqual(
      buildMappingInputs(MAPPING, PROFILE),
    );
  });

  it('every field carries a category, so no field can be written unreviewed', () => {
    for (const input of buildMappingInputs(MAPPING, PROFILE)) {
      expect(input.category).toBeTruthy();
    }
  });
});

/**
 * The saved application form (prefilled_form_json) is the applicant's REVIEWED
 * copy of their data. Prod app 71ad0c29: the applicant corrected
 * duration_of_stay_days 56 -> 62 on the Forms page, yet the consultant's lock
 * screen still showed 56 because mappings were derived from the intake profile.
 */
describe('preflight mapping derivation — saved form wins', () => {
  const form = [
    { key: 'duration_of_stay_days', label: 'Duration', value: '62' },
    { key: 'date_of_birth', label: 'DOB', value: '1815-12-11' },
    { key: 'unrelated_field', label: 'X', value: 'ignored' },
  ];

  it('takes a mapped field value from the saved form over the profile', () => {
    const merged = applyPrefillOverrides(MAPPING, PROFILE, form);
    const inputs = buildMappingInputs(MAPPING, merged);
    const byKey = Object.fromEntries(
      inputs.map((i) => [i.fieldKey, i.mappedValue]),
    );
    expect(byKey.duration_of_stay_days).toBe('62');
    expect(byKey.date_of_birth).toBe('1815-12-11');
  });

  it('falls back to the profile for mapped fields the form lacks', () => {
    const merged = applyPrefillOverrides(MAPPING, PROFILE, form);
    const inputs = buildMappingInputs(MAPPING, merged);
    expect(
      inputs.find((i) => i.fieldKey === 'employer_name')?.mappedValue,
    ).toBe('Analytical Engines Ltd');
    expect(inputs.find((i) => i.fieldKey === 'given_name')?.mappedValue).toBe(
      'Ada',
    );
  });

  it('only overlays mapped keys — form fields cannot widen what gets written', () => {
    const merged = applyPrefillOverrides(MAPPING, PROFILE, form);
    expect(merged).not.toHaveProperty('unrelated_field');
    expect(buildMappingInputs(MAPPING, merged)).toHaveLength(4);
  });

  it('an applicant who blanked a field in the form drops it (no stale profile value)', () => {
    const merged = applyPrefillOverrides(MAPPING, PROFILE, [
      { key: 'duration_of_stay_days', label: 'Duration', value: '' },
    ]);
    expect(
      buildMappingInputs(MAPPING, merged).some(
        (i) => i.fieldKey === 'duration_of_stay_days',
      ),
    ).toBe(false);
  });

  it('does not let a form value flip a `requires` gate that is not itself mapped', () => {
    // The form stores yes/no answers as text: "No" is a truthy string.
    const merged = applyPrefillOverrides(
      MAPPING,
      { ...PROFILE, employed: false },
      [{ key: 'employed', label: 'Employed', value: 'No' }],
    );
    expect(
      buildMappingInputs(MAPPING, merged).some(
        (i) => i.fieldKey === 'employer_name',
      ),
    ).toBe(false);
  });

  it('is a no-op without a saved form', () => {
    expect(applyPrefillOverrides(MAPPING, PROFILE, null)).toEqual(PROFILE);
  });

  it('the fill builder and mapping builder still agree on the merged profile', () => {
    const merged = applyPrefillOverrides(MAPPING, PROFILE, form);
    expect(
      buildMappingInputs(MAPPING, merged).map((i) => i.mappedValue),
    ).toEqual(
      buildInstructionsFromMapping(MAPPING, merged).map((s) => s.value),
    );
  });
});

describe('duration of stay comes from the dates (#20)', () => {
  it('a stale stored count is replaced by the count the dates give', () => {
    const inputs = buildMappingInputs(MAPPING, {
      ...PROFILE,
      duration_of_stay_days: 56,
      planned_entry_date: '2027-03-01',
      planned_departure_date: '2027-04-30',
    });
    expect(
      inputs.find((m) => m.fieldKey === 'duration_of_stay_days')?.mappedValue,
    ).toBe('61');
  });

  it('without both dates the stated count stands', () => {
    const inputs = buildMappingInputs(MAPPING, PROFILE);
    expect(
      inputs.find((m) => m.fieldKey === 'duration_of_stay_days')?.mappedValue,
    ).toBe('14');
  });

  it('a short purpose saved on the form is still composed with the dates', () => {
    const purposeMapping: PortalFillMapping = [
      {
        profileKey: 'purpose_of_visit',
        selector: '#purpose',
        action: 'fill',
        label: 'Purpose',
        category: 'travel_history',
      },
    ];
    const values = applyPrefillOverrides(
      purposeMapping,
      {
        planned_entry_date: '2027-03-01',
        planned_departure_date: '2027-03-10',
        purpose_of_visit: 'x',
      },
      [{ key: 'purpose_of_visit', label: 'Purpose', value: 'Tourism' }],
    );
    expect(buildMappingInputs(purposeMapping, values)[0].mappedValue).toBe(
      'Tourism from March 1, 2027 to March 10, 2027 (10 days). I will return home on March 10, 2027.',
    );
    // A blanked form value stays blank — the person who blanked it meant it.
    const blank = applyPrefillOverrides(
      purposeMapping,
      {
        planned_entry_date: '2027-03-01',
        planned_departure_date: '2027-03-10',
        purpose_of_visit: 'x',
      },
      [{ key: 'purpose_of_visit', label: 'Purpose', value: '' }],
    );
    expect(buildMappingInputs(purposeMapping, blank)).toEqual([]);
  });
});
