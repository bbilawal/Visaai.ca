/**
 * IRCC tr-rt (visitor visa, super visa, business visitor): what a "Yes" (or a
 * "No") reveals on the form and the interview never asked (audit 2026-10-19,
 * P1 "revealed detail never asked"), and the Yes branches of radios no test
 * wrote (P2). Each follow-up is asked only when its parent answer opens it,
 * only on the tr-rt routes, under the key the portal mapping reads.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import '../src/modules/automation/portal-fills/canada-ircc-business-visitor';
import {
  CA_EE_VISAAI_ID,
  CA_ETA_VISAAI_ID,
  intakeFactGap,
  intakeFactSpecs,
  missingIntakeFacts,
} from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { IRCC_PORTAL_ANSWERS } from './fixtures/ircc-portal-answers';

const trv = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };
const TR_RT_ROUTES = [
  TRV,
  { country: 'CA', visaaiId: 'ca-super-visa' },
  { country: 'CA', visaaiId: 'ca-business-visitors' },
];

const BASE: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
};

const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const mapped = (p: Record<string, unknown>) => buildMappingInputs(trv(), values(p));
const at = (p: Record<string, unknown>, target: string) =>
  mapped(p).find((x) => x.targetField === target)?.mappedValue;
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)?.left ?? [];

/** The interview's answers, all complete, plus `p`. */
const answers = (p: Record<string, unknown>) => ({
  purpose_of_visit: 'family visit',
  employed: false,
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
  passport_type: 'Regular',
  us_permanent_resident: false,
  has_valid_us_visa: false,
  previously_visited_canada: 'No',
  uses_representative: false,
  ...IRCC_PORTAL_ANSWERS,
  ...p,
});
const missing = (p: Record<string, unknown>) =>
  missingIntakeFacts(answers(p), TRV).map((s) => s.key);
const spec = (key: string) => intakeFactSpecs(TRV).find((s) => s.key === key)!;

const NEW_KEYS = [
  'immigration_violations_details',
  'committed_crime_details',
  'ever_arrested_details',
  'ever_charged_details',
  'ever_convicted_details',
  'violent_organization_member_details',
  'ill_treatment_details',
  'syphilis_treated',
  'education_history',
  'other_names',
  'other_citizenships',
  'spouse_address',
  'marriage_end_date',
  'has_children',
  'children',
  'children_addresses',
];

describe('the new follow-ups are tr-rt questions only', () => {
  it.each(TR_RT_ROUTES)('$visaaiId asks every one of them', (route) => {
    const keys = intakeFactSpecs(route).map((s) => s.key);
    for (const k of NEW_KEYS) expect(keys).toContain(k);
  });

  it.each([CA_ETA_VISAAI_ID, CA_EE_VISAAI_ID])('%s asks none of them', (visaaiId) => {
    const keys = intakeFactSpecs({ country: 'CA', visaaiId }).map((s) => s.key);
    // The eTA asks its own `other_citizenships` (a list of country names for
    // its single select); the tr-rt rows question is not that one.
    const ownToEta = visaaiId === CA_ETA_VISAAI_ID ? ['other_citizenships'] : [];
    for (const k of NEW_KEYS.filter((k) => !ownToEta.includes(k)))
      expect(keys).not.toContain(k);
    if (ownToEta.length)
      expect(
        intakeFactSpecs({ country: 'CA', visaaiId }).find((s) => s.key === 'other_citizenships')
          ?.question,
      ).not.toMatch(/since birth/);
  });

  it('the fixture of complete answers stays complete', () => {
    expect(missing({})).toEqual([]);
  });
});

describe('declaration "Yes" details (IRCC textareas, at most 500 characters)', () => {
  const CASES: Array<[string, string]> = [
    ['immigration_violations', '#remainedBeyondValidityDetails_txtArea'],
    ['committed_crime', '#committedCrimeDetails_txtArea'],
    ['ever_arrested', '#arrestedDetails_txtArea'],
    ['ever_charged', '#beenChargedDetails_txtArea'],
    ['ever_convicted', '#convictedDetails_txtArea'],
    ['violent_organization_member', '#isMemberDetails_txtArea'],
    ['ill_treatment', '#illTreatmentDetails_txtArea'],
  ];

  it.each(CASES)('%s: asked only after a Yes', (parent) => {
    expect(missing({ [parent]: true })).toContain(`${parent}_details`);
    expect(missing({ [parent]: false })).not.toContain(`${parent}_details`);
    expect(
      missing({ [parent]: true, [`${parent}_details`]: 'Lahore, 2001-05: minor offence, fined.' }),
    ).not.toContain(`${parent}_details`);
  });

  it.each(CASES)('%s: details over 500 characters are asked again, shorter', (parent) => {
    const p = answers({ [parent]: true, [`${parent}_details`]: 'x'.repeat(501) });
    expect(missingIntakeFacts(p, TRV).map((s) => s.key)).toContain(`${parent}_details`);
    expect(intakeFactGap(p, spec(`${parent}_details`))).toMatch(/500/);
  });

  it.each(CASES)('%s: Yes and the details are written; No writes no details', (parent, box) => {
    const name = box.replace(/^#|Details_txtArea$/g, '');
    const radioName = {
      remainedBeyondValidity: 'remainedBeyondValidity',
      committedCrime: 'hasCommittedCrime',
      arrested: 'hasBeenArrested',
      beenCharged: 'hasBeenCharged',
      convicted: 'hasBeenConvicted',
      isMember: 'isMember',
      illTreatment: 'illTreatment',
    }[name]!;
    const yes = mapped({ [parent]: true, [`${parent}_details`]: 'Toronto, 2019-06: overstayed 3 weeks.' });
    expect(yes.find((x) => x.fieldKey === parent)?.targetField).toBe(
      `#${radioName}_radio-button-01-input`,
    );
    expect(yes.find((x) => x.targetField === box)?.mappedValue).toBe(
      'Toronto, 2019-06: overstayed 3 weeks.',
    );
    const no = mapped({ [parent]: false });
    expect(no.find((x) => x.fieldKey === parent)?.targetField).toBe(
      `#${radioName}_radio-button-02-input`,
    );
    expect(no.some((x) => x.targetField === box)).toBe(false);
  });
});

describe('syphilis: the treatment follow-up', () => {
  it('is asked only after a Yes', () => {
    expect(missing({ syphilis: true })).toContain('syphilis_treated');
    expect(missing({ syphilis: false })).not.toContain('syphilis_treated');
  });

  it('Yes and the treatment answer are written', () => {
    const inputs = mapped({ syphilis: true, syphilis_treated: true });
    expect(inputs.find((x) => x.fieldKey === 'syphilis')?.targetField).toBe(
      '#hasSyphilis_radio-button-01-input',
    );
    expect(inputs.find((x) => x.fieldKey === 'syphilis_treated')?.targetField).toBe(
      '#hasSyphilisTreatment_radio-button-01-input',
    );
  });
});

describe('post-secondary education', () => {
  const SCHOOL = {
    school: 'University of the Punjab',
    street_address: 'Quaid-i-Azam Campus',
    city: 'Lahore',
    country: 'Pakistan',
    from: '1976-09',
    to: '1980-06',
    level: "Bachelor's",
    field_of_study: 'Engineering',
  };

  it("asks IRCC's question: any post-secondary education, not only completed", () => {
    expect(spec('has_post_secondary_education').question).toMatch(/had any post-secondary/i);
    expect(spec('has_post_secondary_education').question).not.toMatch(/completed/i);
  });

  it('asks for the schools only after a Yes, until each is complete', () => {
    expect(missing({ has_post_secondary_education: false })).not.toContain('education_history');
    expect(missing({ has_post_secondary_education: true })).toContain('education_history');
    expect(
      missing({ has_post_secondary_education: true, education_history: [SCHOOL] }),
    ).not.toContain('education_history');
    const p = answers({
      has_post_secondary_education: true,
      education_history: [{ ...SCHOOL, field_of_study: undefined }],
    });
    expect(intakeFactGap(p, spec('education_history'))).toMatch(/field of study/);
  });

  it('a Yes without a complete school is left to the applicant, with the recorded schools in the note', () => {
    const p = {
      has_post_secondary_education: true,
      education_history: [{ ...SCHOOL, street_address: undefined }],
    };
    expect(mapped(p).some((x) => x.fieldKey === 'has_post_secondary_education')).toBe(false);
    const note = left(p, '/activities').find((l) => l.label === 'Education details');
    expect(note?.note).toMatch(/University of the Punjab \(Lahore, Pakistan\) 1976-09 to 1980-06/);
    expect(note?.note).toMatch(/school 1: street address/);
  });

  it('a Yes with a complete school is written, with the school added (live 2026-10-19)', () => {
    const p = { has_post_secondary_education: true, education_history: [SCHOOL] };
    expect(at(p, '#hasPostSecondaryEducation_radio-button-01-input')).toBeDefined();
    expect(left(p, '/activities').some((l) => l.label === 'Education details')).toBe(false);
  });

  it('No is written', () => {
    expect(at({ has_post_secondary_education: false }, '#hasPostSecondaryEducation_radio-button-02-input')).toBeDefined();
  });
});

describe('other names', () => {
  it('asks the names only after a Yes, and their kind', () => {
    expect(missing({ has_other_names: false })).not.toContain('other_names');
    expect(missing({ has_other_names: true })).toContain('other_names');
    const p = answers({
      has_other_names: true,
      other_names: [{ family_name: 'Bibi', given_name: 'Sumera' }],
    });
    expect(missingIntakeFacts(p, TRV).map((s) => s.key)).toContain('other_names');
    expect(intakeFactGap(p, spec('other_names'))).toMatch(/alias, a name before marriage/);
  });

  it('a name recorded as the interview shape becomes a row, and Yes is written', () => {
    const p = {
      has_other_names: true,
      other_names: [{ family_name: 'Bibi', given_name: 'Sumera', kind: 'name before marriage' }],
    };
    expect(missing(p)).not.toContain('other_names');
    const inputs = mapped(p);
    expect(inputs.find((x) => x.fieldKey === 'has_other_names')?.mappedValue).toBe('Yes');
    expect(inputs.find((x) => x.fieldKey === 'ircc_other_name_1_kind')?.targetField).toBe(
      '#nameType_radio-button-07-input',
    );
    expect(inputs.find((x) => x.fieldKey === 'ircc_other_name_1_family_name')?.mappedValue).toBe('Bibi');
  });
});

describe('other citizenships', () => {
  it('asks the other countries only after a Yes', () => {
    expect(missing({ multiple_citizenship: false })).not.toContain('other_citizenships');
    expect(missing({ multiple_citizenship: true })).toContain('other_citizenships');
    const p = answers({
      multiple_citizenship: true,
      other_citizenships: [{ country: 'United Kingdom', from_birth: false }],
    });
    expect(intakeFactGap(p, spec('other_citizenships'))).toMatch(/date it was granted/);
    expect(
      missing({
        multiple_citizenship: true,
        other_citizenships: [{ country: 'United Kingdom', from_birth: false, since: '2010-05-01' }],
      }),
    ).not.toContain('other_citizenships');
  });

  it('the rows stay with the applicant (dialog not recorded live), named in the note', () => {
    const p = {
      multiple_citizenship: true,
      other_citizenships: [{ country: 'United Kingdom', from_birth: false, since: '2010-05-01' }],
    };
    const note = left(p, '/nationality').find((l) => l.label === 'Other citizenships');
    expect(note?.note).toMatch(/United Kingdom \(since 2010-05-01\)/);
  });
});

describe('spouse: address when not living together, end date when the union ended', () => {
  it('asks the address only when the spouse lives elsewhere', () => {
    expect(missing({ spouse_same_address: true })).not.toContain('spouse_address');
    expect(missing({ spouse_same_address: false })).toContain('spouse_address');
    expect(
      missing({ spouse_same_address: false, spouse_address: 'Lahore' }),
    ).toContain('spouse_address');
    expect(
      missing({ spouse_same_address: false, spouse_address: '5 Canal Road, Lahore, Pakistan' }),
    ).not.toContain('spouse_address');
  });

  it('the address fills partnerInfoAddress', () => {
    const p = {
      marital_status: 'Married',
      spouse_same_address: false,
      spouse_address: '5 Canal Road, Lahore, Pakistan',
    };
    expect(at(p, '#commonAddressFamily_radio-button-02-input')).toBeDefined();
    expect(at(p, '#streetAddress_partnerInfoAddress')).toBe('5 Canal Road');
    expect(at(p, '#city_partnerInfoAddress')).toBe('Lahore');
  });

  it.each(['Divorced', 'Separated', 'Widowed', 'Annulled marriage'])(
    '%s: the end date is asked and fills endDatePartner',
    (status) => {
      expect(missing({ marital_status: status })).toContain('marriage_end_date');
      expect(missing({ marital_status: status, marriage_end_date: '2015-04-20' })).not.toContain(
        'marriage_end_date',
      );
      expect(at({ marital_status: status, marriage_end_date: '2015-04-20' }, '#endDatePartnerYear_sltDateYear')).toBe(
        '2015',
      );
    },
  );

  it('married or single: no end date is asked', () => {
    expect(missing({ marital_status: 'Married' })).not.toContain('marriage_end_date');
    expect(missing({ marital_status: 'Single' })).not.toContain('marriage_end_date');
  });
});

describe('children', () => {
  const KID = {
    name: 'Ali Ahmad',
    relationship: 'son',
    birth_year: 1995,
    country_of_birth: 'Pakistan',
    coming_to_canada: false,
  };
  const noKids = { has_children: undefined };

  it('"Do you have children?" is asked outright', () => {
    expect(missing(noKids)).toContain('has_children');
    // "None live with me" is not "no children".
    expect(missing({ ...noKids, children_living_with_you: [] })).toContain('has_children');
    expect(missing({ has_children: false })).not.toContain('has_children');
  });

  it('a Yes asks each child, until name, date of birth and son or daughter are known', () => {
    expect(missing({ has_children: false })).not.toContain('children');
    expect(missing({ has_children: true })).toContain('children');
    const p = answers({ has_children: true, children: [{ name: 'Ali Ahmad' }] });
    expect(intakeFactGap(p, spec('children'))).toMatch(/date of birth.*son or daughter/);
  });

  it("a child living elsewhere: their address is asked, then fills the child's entry", () => {
    const p = {
      has_children: true,
      children: [KID],
      children_living_with_you: [],
      children_accompanying: [],
    };
    expect(missing(p)).toContain('children_addresses');
    expect(missing({ ...p, children_living_with_you: ['Ali Ahmad'] })).not.toContain(
      'children_addresses',
    );
    const withAddress = { ...p, children_addresses: 'Ali Ahmad: 5 Canal Road, Lahore, Pakistan' };
    expect(missing(withAddress)).not.toContain('children_addresses');
    expect(at(withAddress, '#hasChild_radio-button-01-input')).toBeDefined();
    expect(at(withAddress, '#hasSameAddress_radio-button-02-input')).toBeDefined();
    expect(at(withAddress, '#streetAddress_childInfoAddress')).toBe('5 Canal Road');
  });
});

describe('parents: date of death, and the address of a parent living elsewhere', () => {
  const FATHER = {
    name: 'Abdul Rasheed',
    relationship: 'father',
    birth_year: 1930,
    country_of_birth: 'Pakistan',
  };
  const MOTHER = {
    name: 'Amina Bibi',
    relationship: 'mother',
    birth_year: 1935,
    country_of_birth: 'Pakistan',
    occupation: 'Homemaker',
    coming_to_canada: false,
  };

  it('a deceased parent: the date of death is asked, then written', () => {
    const p = { parents: [{ ...FATHER, deceased: true }] };
    expect(missing(p)).toContain('parents');
    expect(intakeFactGap(answers(p), spec('parents'))).toMatch(/Abdul Rasheed: date of death/);
    const done = {
      parents: [{ ...FATHER, deceased: true, date_of_death: '2001-07-15' }],
    };
    expect(missing(done)).not.toContain('parents');
    expect(at(done, '#isDeathParent_chk-input')).toBeDefined();
    expect(at(done, '#dateOfDeathYear_sltDateYear')).toBe('2001');
    expect(at(done, '#dateOfDeathMonth_sltDateMonth')).toBe('07');
    expect(at(done, '#dateOfDeathDay_sltDateDay')).toBe('15');
  });

  it('a death date known only to the year or month is never written with "Unknown" parts (matrix C 46)', () => {
    for (const partial of [
      { year_of_death: 2001 },
      { date_of_death: '2001' },
      { date_of_death: '2001-07' },
    ]) {
      const p = { parents: [{ ...FATHER, deceased: true, ...partial }] };
      // IRCC's date-of-death selects have no "Unknown" option.
      expect(
        mapped(p).filter((x) => /dateOfDeath/.test(x.targetField)),
      ).toEqual([]);
      expect(mapped(p).some((x) => x.mappedValue === 'Unknown' && /Death/.test(x.targetField))).toBe(false);
      const note = left(p, '/family-info-parents')
        .map((l) => l.note)
        .join(' ');
      expect(note).toMatch(/full date of death/);
    }
  });

  it('a parent born in a known year still gets "Unknown" month and day (birth selects have it)', () => {
    const p = {
      parents: [{ ...FATHER, deceased: true, date_of_death: '2001-07-15' }],
    };
    expect(at(p, '#dateOfBirthYear_sltDateYear')).toBe('1930');
    expect(at(p, '#dateOfBirthMonth_sltDateMonth')).toBe('Unknown');
  });

  it('a parent living elsewhere: the address is asked, then fills residentialAddress', () => {
    const p = { parents: [{ ...MOTHER, same_address: false }] };
    expect(intakeFactGap(answers(p), spec('parents'))).toMatch(/Amina Bibi: their home address/);
    const done = {
      parents: [{ ...MOTHER, same_address: false, address: '9 Mall Road, Rawalpindi, Pakistan' }],
    };
    expect(missing(done)).not.toContain('parents');
    expect(at(done, '#addressParent_radio-button-02-input')).toBeDefined();
    expect(at(done, '#streetAddress_residentialAddress')).toBe('9 Mall Road');
    expect(at(done, '#parentComingCanada_radio-button-02-input')).toBeDefined();
  });

  it('a parent at the same address who is coming: Yes to both', () => {
    const done = { parents: [{ ...MOTHER, same_address: true, coming_to_canada: true }] };
    expect(missing(done)).not.toContain('parents');
    expect(at(done, '#addressParent_radio-button-01-input')).toBeDefined();
    expect(at(done, '#parentComingCanada_radio-button-01-input')).toBeDefined();
  });
});

describe('Yes branches no test wrote (audit P2)', () => {
  it.each<[string, Record<string, unknown>, string]>([
    // Yes is never written (live 2026-10-31: it routes to "you don't need
    // to apply"); No still is.
    ['US green card: No', { us_permanent_resident: false }, '#hasGreenCard_radio-button-02-input'],
    [
      'Canadian visa in the past 10 years',
      { held_canadian_visa_10_years: true },
      '#travelledToCanadaInPastTen_radio-button-01-input',
    ],
    ['travelling by air: No', { travel_by_air: false }, '#travellingByAir_radio-button-02-input'],
    ['dialysis', { dialysis: true }, '#hasDialysisTreatment_radio-button-01-input'],
    ['addiction', { addiction: true }, '#hasAddiction_radio-button-01-input'],
    ['mental health', { mental_health_condition: true }, '#mentalHealth_radio-button-01-input'],
    ['syphilis', { syphilis: true }, '#hasSyphilis_radio-button-01-input'],
    ['crime committed: No', { committed_crime: false }, '#hasCommittedCrime_radio-button-02-input'],
    ['arrested: No', { ever_arrested: false }, '#hasBeenArrested_radio-button-02-input'],
  ])('%s is written', (_n, p, target) => {
    expect(at(p, target)).toBeDefined();
  });

  it('a group application is never answered Yes; it is left with a note', () => {
    const p = { ircc_group_application: true };
    expect(at(p, '#hasGroup_radio-button-01-input')).toBeUndefined();
    expect(left(p, '/group-questions').map((l) => l.label)).toContain('Group application');
  });

  it('the super visa and business visitor fills write the same follow-ups', () => {
    for (const id of ['ca-super-visa', 'ca-business-visitors']) {
      const m = resolvePortalFillFor('ircc', id)!;
      const inputs = buildMappingInputs(
        m,
        applyPrefillOverrides(m, { ...BASE, ever_arrested: true, ever_arrested_details: 'Lahore, 2001: released.' }, []),
      );
      expect(inputs.find((x) => x.targetField === '#arrestedDetails_txtArea')?.mappedValue).toBe(
        'Lahore, 2001: released.',
      );
    }
  });
});
