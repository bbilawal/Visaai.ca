/**
 * An applicant who skips the interview fills everything on the Forms page
 * (prod 2026-10-18, Canada visitor visa and super visa). The page had no
 * field for many questions IRCC asks, so the IRCC fill left them for the
 * applicant on the portal. finalizeFields now puts each applicable question
 * on the form (empty when nothing answers it), and what the applicant types
 * there reaches the IRCC mapping.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import type { PrefilledFormField } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import {
  finalizeFields,
  UNANSWERED_NOTE,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';

const TRV = {
  country: 'CA',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
};
const SUPER = { country: 'CA', visaaiId: 'ca-super-visa' };

const mapping = () => resolvePortalFill('ircc')!;

function ctx(
  profile: Record<string, unknown>,
  route: FinalizeContext['route'] = TRV,
): FinalizeContext {
  return {
    applicantName: 'MUZAFFAR AHMAD',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route,
  };
}

const g = (
  key: string,
  value: string,
  group = 'Personal',
): PrefilledFormField => ({
  key,
  label: key,
  value,
  group,
  source: 'profile',
});

/** What the form generator wrote for a skipped interview (no profile answers). */
const GENERATED: PrefilledFormField[] = [
  g('family_name', 'AHMAD'),
  g('given_name', 'MUZAFFAR'),
  g('date_of_birth', '1961-06-15'),
  g('place_of_birth_city', 'Rawalpindi'),
  g('place_of_birth_country', 'Pakistan'),
  g('nationality', 'Pakistan'),
  g('passport_number', 'AK1182091'),
  g('passport_issue_date', '2023-08-07'),
  g('passport_expiry_date', '2033-08-06'),
  g('residential_address', '138 Millat Colony, Rawalpindi, 46000, Pakistan'),
  g('marital_status', 'Married', 'Family'),
  g('spouse_family_name', 'Ahmad', 'Family'),
  g('spouse_given_name', 'Sumera', 'Family'),
  g('spouse_date_of_birth', '1968-10-09', 'Family'),
  g('spouse_country_of_birth', 'Pakistan', 'Family'),
  g('father_family_name', 'Rasheed', 'Family'),
  g('father_given_name', 'Mian Abdul', 'Family'),
  g('father_date_of_birth', '1935', 'Family'),
  g('father_country_of_birth', 'Pakistan', 'Family'),
  g(
    'children_details',
    'Mian Muhammad Sajawal (son, born 1989-10-14, Pakistan)',
    'Family',
  ),
  g('current_occupation', 'Accountant', 'Employment'),
  g('employer_name', 'Rawal Traders', 'Employment'),
  g('purpose_of_trip', 'Visit my son', 'Travel'),
  g('host_name', 'Mian Muhammad Bilawal', 'Host'),
  g('host_relationship', 'Son', 'Host'),
];

const byKey = (fields: PrefilledFormField[], key: string) =>
  fields.find((f) => f.key === key);

describe('finalizeFields: IRCC questions are on the Forms page (TRV / super visa)', () => {
  const out = finalizeFields(GENERATED, ctx({}));

  it.each([
    ['father_occupation', 'Family'],
    ['father_same_address', 'Family'],
    ['father_coming_to_canada', 'Family'],
    ['marriage_date', 'Family'],
    ['spouse_same_address', 'Family'],
    ['spouse_coming_to_canada', 'Family'],
    ['spouse_address', 'Family'],
    ['children_living_with_you', 'Family'],
    ['children_accompanying', 'Family'],
    ['has_other_names', 'Personal details'],
    ['multiple_citizenship', 'Personal details'],
    ['job_duties', 'Employment'],
    ['employer_address', 'Employment'],
    ['employment_start_date', 'Employment'],
    ['us_permanent_resident', 'Travel'],
    ['has_valid_us_visa', 'Travel'],
    ['travel_by_air', 'Travel'],
    ['held_canadian_visa_10_years', 'Travel'],
    ['biometrics_given', 'Travel'],
    ['inviter_status', 'Host'],
  ])('%s is asked, empty, for the applicant to answer', (key, group) => {
    const f = byKey(out, key);
    expect(f).toMatchObject({
      value: '',
      group,
      needsReview: true,
      note: UNANSWERED_NOTE,
    });
    // Nobody answered it: not "from the profile".
    expect(f!.source).toBeUndefined();
    expect(f!.label).toMatch(/\?/);
  });

  it('labels are plain questions', () => {
    expect(byKey(out, 'father_same_address')!.label).toBe(
      'Does your father live with you at your home address? (Yes/No)',
    );
  });

  it('no mother named → no mother questions', () => {
    expect(out.filter((f) => f.key.startsWith('mother_'))).toEqual([]);
  });

  it('never duplicates a generated field, under its key or an alias', () => {
    const own = finalizeFields(
      [
        ...GENERATED,
        g('host_status', 'Canadian citizen', 'Host'),
        g('date_of_marriage', '1988-09-16', 'Family'),
        g('father_occupation', '', 'Family'),
      ],
      ctx({}),
    );
    expect(byKey(own, 'inviter_status')).toBeUndefined();
    expect(byKey(own, 'marriage_date')).toBeUndefined();
    const father = own.filter((f) => f.key === 'father_occupation');
    expect(father).toHaveLength(1);
    // The generator's empty field is flagged for the applicant too.
    expect(father[0]).toMatchObject({
      needsReview: true,
      note: UNANSWERED_NOTE,
    });
    expect(father[0].source).toBeUndefined();
    expect(new Set(own.map((f) => f.key)).size).toBe(own.length);
  });

  it('answers the profile holds are carried, from the profile', () => {
    const carried = finalizeFields(
      GENERATED,
      ctx({
        parents: [
          {
            name: 'Mian Abdul Rasheed',
            relationship: 'father',
            occupation: 'Retired',
            same_address: false,
            coming_to_canada: false,
          },
        ],
        spouse_same_address: true,
        biometrics_given_before: 'yes',
        inviter_status: 'Permanent resident',
        children_living_with_you: ['Mian Muhammad Sajawal'],
      }),
    );
    expect(byKey(carried, 'father_occupation')).toMatchObject({
      value: 'Retired',
      source: 'profile',
    });
    expect(byKey(carried, 'father_same_address')!.value).toBe('No');
    expect(byKey(carried, 'spouse_same_address')!.value).toBe('Yes');
    expect(byKey(carried, 'biometrics_given')!.value).toBe('Yes');
    expect(byKey(carried, 'inviter_status')!.value).toBe('Permanent resident');
    // Living together: no spouse address to ask.
    expect(byKey(carried, 'spouse_address')).toBeUndefined();
    // A list answer the IRCC fill reads as is: not asked again.
    expect(byKey(carried, 'children_living_with_you')).toBeUndefined();
  });

  it('single applicant: no spouse or marriage questions', () => {
    const single = finalizeFields(
      GENERATED.map((f) =>
        f.key === 'marital_status' ? { ...f, value: 'Single' } : f,
      ).filter((f) => !f.key.startsWith('spouse_')),
      ctx({}),
    );
    for (const k of [
      'marriage_date',
      'spouse_same_address',
      'spouse_coming_to_canada',
      'spouse_address',
    ])
      expect(byKey(single, k)).toBeUndefined();
  });

  it('retired applicant: no current-job questions; deceased father: no whereabouts', () => {
    const retired = finalizeFields(
      GENERATED.map((f) =>
        f.key === 'current_occupation' ? { ...f, value: 'Retired' } : f,
      ),
      ctx({ father_deceased: 'Yes' }),
    );
    expect(byKey(retired, 'job_duties')).toBeUndefined();
    expect(byKey(retired, 'employer_address')).toBeUndefined();
    expect(byKey(retired, 'employment_start_date')).toBeUndefined();
    expect(byKey(retired, 'father_occupation')).toBeUndefined();
    expect(byKey(retired, 'father_same_address')).toBeUndefined();
  });

  it('no host and no children: neither is asked', () => {
    const alone = finalizeFields(
      GENERATED.filter((f) => !/^host_|children_details/.test(f.key)),
      ctx({ has_children: 'No' }),
    );
    expect(byKey(alone, 'inviter_status')).toBeUndefined();
    expect(byKey(alone, 'children_living_with_you')).toBeUndefined();
  });

  it('super visa: the host status is always asked', () => {
    const sv = finalizeFields(
      GENERATED.filter((f) => !/^host_/.test(f.key)),
      ctx({}, SUPER),
    );
    expect(byKey(sv, 'inviter_status')).toMatchObject({
      value: '',
      group: 'Host',
    });
    expect(byKey(sv, 'father_occupation')).toBeDefined();
  });

  it('other routes get nothing added', () => {
    for (const route of [
      { country: 'GB', visaaiId: 'gb-standard-visitor' },
      { country: 'CA', visaaiId: 'ca-eta' },
    ]) {
      const other = finalizeFields(GENERATED, ctx({}, route));
      expect(other.filter((f) => f.note === UNANSWERED_NOTE)).toEqual([]);
      expect(byKey(other, 'father_occupation')).toBeUndefined();
    }
  });
});

describe('a Forms-page answer to an added question reaches the IRCC fill', () => {
  /** finalizeFields → the applicant types answers (saved as source applicant). */
  function typed(
    answers: Record<string, string>,
    route: FinalizeContext['route'] = TRV,
  ) {
    const form = finalizeFields(GENERATED, ctx({}, route));
    for (const [k, v] of Object.entries(answers)) {
      const f = byKey(form, k);
      if (!f) throw new Error(`${k} is not on the form`);
      f.value = v;
      f.source = 'applicant';
    }
    return buildMappingInputs(
      mapping(),
      applyPrefillOverrides(mapping(), {}, form),
    );
  }
  const keysOf = (rows: ReturnType<typeof typed>) =>
    new Set(rows.map((m) => m.fieldKey));

  it('the father row is written once his occupation, address and travel are typed', () => {
    expect(keysOf(typed({})).has('ircc_parent_1_row')).toBe(false);
    const rows = typed({
      father_occupation: 'Retired',
      father_same_address: 'Yes',
      father_coming_to_canada: 'no',
    });
    expect(keysOf(rows).has('ircc_parent_1_row')).toBe(true);
    expect(
      rows.find((m) => m.fieldKey === 'ircc_parent_1_occupation')?.mappedValue,
    ).toBe('Retired');
  });

  it('a father who lives elsewhere is written with the address typed for him', () => {
    const rows = typed({
      father_occupation: 'Retired',
      father_same_address: 'No',
      father_coming_to_canada: 'No',
      father_address: '7 Canal Road, Lahore, Punjab, 54000, Pakistan',
    });
    expect(rows.map((m) => m.targetField)).toEqual(
      expect.arrayContaining([
        '#streetAddress_residentialAddress',
        '#city_residentialAddress',
      ]),
    );
  });

  it('the spouse address is written when the spouse lives elsewhere', () => {
    const rows = typed({
      spouse_same_address: 'No',
      spouse_coming_to_canada: 'No',
      spouse_address: '5 Mall Road, Lahore, Punjab, 54000, Pakistan',
    });
    const targets = rows.map((m) => m.targetField);
    expect(targets).toEqual(
      expect.arrayContaining([
        '#streetAddress_partnerInfoAddress',
        '#city_partnerInfoAddress',
      ]),
    );
    expect(keysOf(rows).has('spouse_coming_to_canada')).toBe(true);
  });

  it('visa purpose 688 once the host status "Canadian citizen" is typed', () => {
    const purpose = (rows: ReturnType<typeof typed>) =>
      rows.find((m) => m.fieldKey === 'ircc_visa_purpose')?.targetField;
    expect(purpose(typed({}))).toBeUndefined();
    expect(purpose(typed({ inviter_status: 'Canadian citizen' }))).toBe(
      '#visaPurpose_radio-button-688-input',
    );
  });

  it('typed Yes/No answers, in any case, answer the IRCC questions', () => {
    const rows = typed({
      biometrics_given: 'yes',
      has_other_names: 'No',
      multiple_citizenship: 'no',
      us_permanent_resident: 'No',
      has_valid_us_visa: 'NO',
      travel_by_air: 'Yes',
      held_canadian_visa_10_years: 'No',
      marriage_date: '1988-09-16',
    });
    const value = (k: string) =>
      rows.find((m) => m.fieldKey === k)?.mappedValue;
    expect(value('biometrics_given')).toBe('Yes');
    expect(value('has_other_names')).toBe('No');
    expect(value('multiple_citizenship')).toBe('No');
    expect(value('us_green_card')).toBe('No');
    expect(value('holds_us_visa')).toBe('No');
    expect(value('travelling_by_air')).toBe('Yes');
    expect(value('held_canadian_visa_10_years')).toBe('No');
    expect(keysOf(rows).has('marriage_date')).toBe(true);
  });

  it('the children answers and the current job reach their IRCC rows', () => {
    const rows = typed({
      children_living_with_you: 'Mian Muhammad Sajawal',
      children_accompanying: 'none',
      job_duties: 'Prepare accounts and tax returns',
      employer_address: '12 Bank Road, Rawalpindi, Pakistan',
      employment_start_date: '2015-03',
    });
    const k = keysOf(rows);
    expect(keysOf(typed({})).has('ircc_child_1_row')).toBe(false);
    expect(k.has('ircc_child_1_row')).toBe(true);
    expect(k.has('ircc_child_1_same_address')).toBe(true);
    expect(k.has('ircc_child_1_coming_to_canada')).toBe(true);
    expect(k.has('ircc_work_current_duties')).toBe(true);
    expect(keysOf(typed({})).has('ircc_work_current_row')).toBe(false);
  });

  it('a parent named in the interview list is completed by the Forms-page answers', () => {
    const profile = {
      parents: [
        {
          name: 'Mian Abdul Rasheed',
          relationship: 'father',
          birth_year: 1935,
          country_of_birth: 'Pakistan',
        },
      ],
    };
    const form = finalizeFields(GENERATED, ctx(profile));
    const answer: Record<string, string> = {
      father_occupation: 'Farmer',
      father_same_address: 'Yes',
      father_coming_to_canada: 'No',
    };
    for (const f of form)
      if (answer[f.key] !== undefined) {
        f.value = answer[f.key];
        f.source = 'applicant';
      }
    const rows = buildMappingInputs(
      mapping(),
      applyPrefillOverrides(mapping(), profile, form),
    );
    expect(
      rows.find((m) => m.fieldKey === 'ircc_parent_1_occupation')?.mappedValue,
    ).toBe('Farmer');
  });
});
