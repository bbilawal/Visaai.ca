/**
 * tr-rt coverage audit (2026-10-31, matrix A 66-67, C 15 and 18-21):
 *  - an applicant living outside their own country (a Pakistani worker in
 *    Dubai) is asked their status there (plus the end date a visitor /
 *    worker / student status needs, the details "Other" needs). Only a
 *    Citizen / PR residence row is written — the other statuses reveal
 *    controls seen only in the bundle (GATED pending live verification), so
 *    the row is left for the applicant with the collected values;
 *  - divorced / separated / annulled reveal the same former-spouse block as
 *    widowed (live 2026-10-31; the 2026-10-15 "end date only" note was wrong);
 *  - widowed applicants are asked the late spouse's details.
 * Names are invented.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import '../src/modules/automation/portal-fills/canada-ircc-business-visitor';
import type { PrefilledFormField } from '@visaai/types';
import { missingIntakeFacts } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';
import { IRCC_PORTAL_ANSWERS } from './fixtures/ircc-portal-answers';

const trv = () => resolvePortalFill('ircc')!;
const TR_RT_ROUTES = [
  { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' },
  { country: 'CA', visaaiId: 'ca-super-visa' },
  { country: 'CA', visaaiId: 'ca-business-visitors' },
];
const TRV = TR_RT_ROUTES[0];

const BASE: Record<string, unknown> = {
  given_name: 'Tariq',
  family_name: 'Qureshi',
  date_of_birth: '1980-02-11',
  nationality: 'PAK',
  passport_number: 'ZX7654321',
  purpose_of_visit: 'tourism',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-03-30',
};

const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), values(p));
const at = (p: Record<string, unknown>, target: string) =>
  mapped(p).find((x) => x.targetField === target)?.mappedValue;
/** A family-page target (#lastName_input is also the applicant's own name box). */
const fam = (p: Record<string, unknown>, target: string) =>
  mapped(p).find((x) => x.page === '/family-info' && x.targetField === target)
    ?.mappedValue;
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)
    ?.left ?? [];

const answers = (p: Record<string, unknown>) => ({
  purpose_of_visit: 'tourism',
  employed: false,
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-03-30',
  passport_type: 'Regular',
  us_permanent_resident: false,
  has_valid_us_visa: false,
  previously_visited_canada: 'No',
  uses_representative: false,
  nationality: 'Pakistan',
  ...IRCC_PORTAL_ANSWERS,
  ...p,
});
const missing = (p: Record<string, unknown>, route = TRV) =>
  missingIntakeFacts(answers(p), route).map((s) => s.key);

const DUBAI = {
  residential_address: 'Villa 14, Street 22, Al Barsha, Dubai, United Arab Emirates',
  residence_since: '2016-05-01',
};

describe('residence status: asked only outside the citizenship country', () => {
  it('a Pakistani living in Pakistan is not asked', () => {
    expect(missing({})).not.toContain('residence_status');
    expect(missing({})).not.toContain('residence_status_valid_until');
  });

  it.each(TR_RT_ROUTES)('a Pakistani in Dubai is asked (%o)', (route) => {
    expect(missing(DUBAI, route)).toContain('residence_status');
  });

  it('a citizen of the residence country by a second citizenship is not asked', () => {
    expect(
      missing({
        ...DUBAI,
        multiple_citizenship: true,
        other_citizenships: [{ country: 'United Arab Emirates', from_birth: false, since: '2015-01-01' }],
      }),
    ).not.toContain('residence_status');
  });

  it('worker / student / visitor: the end date is asked; citizen or PR is not', () => {
    expect(missing({ ...DUBAI, residence_status: 'Worker' })).toContain(
      'residence_status_valid_until',
    );
    expect(missing({ ...DUBAI, residence_status: 'Student' })).toContain(
      'residence_status_valid_until',
    );
    expect(
      missing({ ...DUBAI, residence_status: 'Worker', residence_status_valid_until: '2028-04-30' }),
    ).not.toContain('residence_status_valid_until');
    expect(missing({ ...DUBAI, residence_status: 'Permanent resident' })).not.toContain(
      'residence_status_valid_until',
    );
  });

  it('"Other" asks for details', () => {
    expect(missing({ ...DUBAI, residence_status: 'Other' })).toContain(
      'residence_status_details',
    );
    expect(missing({ ...DUBAI, residence_status: 'Worker' })).not.toContain(
      'residence_status_details',
    );
  });
});

describe('residence row: every status written (live 2026-10-31)', () => {
  const worker = {
    ...DUBAI,
    residence_status: 'Worker',
    residence_status_valid_until: '2028-04-30',
  };
  const note = (p: Record<string, unknown>) =>
    left(p, '/contact-info').find((l) => l.label === 'Countries of residence')
      ?.note;

  it('a worker in the UAE: ongoing row with From and the To date', () => {
    expect(at(worker, '#otherCountriesResidences_add_button')).toBeDefined();
    expect(at(worker, '#statusResidence_select')).toBe('Worker');
    expect(at(worker, '#datesFromResidenceYear_sltDateYear')).toBe('2016');
    expect(at(worker, '#ongoing_chk-input')).toBeDefined();
    expect(at(worker, '#datesToResidenceYear_sltDateYear')).toBe('2028');
    expect(at(worker, '#datesToResidenceMonth_sltDateMonth')).toBeDefined();
    expect(at(worker, '#datesToResidenceDay_sltDateDay')).toBeDefined();
    expect(at(worker, '#statusResidenceDetail_input')).toBeUndefined();
    expect(note(worker)).toBeUndefined();
  });

  it('a worker without the end date: no row; the note names what is missing', () => {
    const p = { ...DUBAI, residence_status: 'Student' };
    expect(at(p, '#otherCountriesResidences_add_button')).toBeUndefined();
    expect(note(p)).toMatch(
      /status Student, since 2016-05-01, valid until \(the date your status ends\)/,
    );
  });

  it('"Other": the details box, in Roman script, with its To date', () => {
    const p = {
      ...DUBAI,
      residence_status: 'Other',
      residence_status_details: 'Dependant visa — sponsored by spouse',
      residence_status_valid_until: '2028-02-29',
    };
    expect(at(p, '#statusResidence_select')).toBe('Other');
    expect(at(p, '#statusResidenceDetail_input')).toBe('Dependant visa - sponsored by spouse');
    expect(at(p, '#datesToResidenceYear_sltDateYear')).toBe('2028');
    expect(note(p)).toBeUndefined();
    expect(
      at({ ...DUBAI, residence_status: 'golden visa holder', residence_status_valid_until: '2030-01-01' }, '#statusResidenceDetail_input'),
    ).toBe('golden visa holder');
  });

  it('"Other" without details, or details over 100 characters: no row, a note', () => {
    expect(at({ ...DUBAI, residence_status: 'Other' }, '#otherCountriesResidences_add_button')).toBeUndefined();
    const long = { ...DUBAI, residence_status: 'Other', residence_status_details: 'x'.repeat(101) };
    expect(at(long, '#otherCountriesResidences_add_button')).toBeUndefined();
    expect(note(long)).toMatch(/at most 100 characters/);
  });

  it.each([
    ['Protected person', 'Protected Person'],
    ['refugee claimant', 'Refugee Claimant'],
    ['Foreign national', 'Foreign National'],
  ])('"%s" → %s, ongoing, with its To date (live: To stays visible)', (said, option) => {
    const p = { ...DUBAI, residence_status: said, residence_status_valid_until: '2029-01-01' };
    expect(at(p, '#statusResidence_select')).toBe(option);
    expect(at(p, '#ongoing_chk-input')).toBeDefined();
    expect(at(p, '#datesToResidenceYear_sltDateYear')).toBe('2029');
    expect(at({ ...DUBAI, residence_status: said }, '#otherCountriesResidences_add_button')).toBeUndefined();
  });

  it.each([
    ['work visa', 'Worker'],
    ['student', 'Student'],
    ['visitor', 'Visitor'],
  ])('"%s" → %s with its To date', (said, option) => {
    const p = { ...DUBAI, residence_status: said, residence_status_valid_until: '2027-12-31' };
    expect(at(p, '#statusResidence_select')).toBe(option);
    expect(at(p, '#datesToResidenceYear_sltDateYear')).toBe('2027');
  });

  it('a PR abroad and a citizen at home are written as before', () => {
    const pr = { ...DUBAI, residence_status: 'Permanent resident' };
    expect(at(pr, '#otherCountriesResidences_add_button')).toBeDefined();
    expect(at(pr, '#statusResidence_select')).toBe('Permanent resident');
    expect(at(pr, '#datesFromResidenceYear_sltDateYear')).toBe('2016');
    expect(at(pr, '#ongoing_chk-input')).toBeDefined();
    expect(at(pr, '#countryOfResidence_save_button')).toBeDefined();
    expect(note(pr)).toBeUndefined();
    const home = { residence_since: 'since birth', residential_address: '7 Jail Road, Lahore, Pakistan' };
    expect(at(home, '#statusResidence_select')).toBe('Citizen');
  });
});

describe.each(['Divorced', 'Separated', 'Annulled marriage'])(
  '%s: the former spouse block (live 2026-10-31)',
  (status) => {
    it('intake asks the former marriage date and the former spouse details', () => {
      const m = missing({
        marital_status: status,
        marriage_end_date: '2019-08-01',
        marriage_date: undefined,
        spouse_name: undefined,
        spouse_date_of_birth: undefined,
        spouse_country_of_birth: undefined,
      });
      expect(m).toEqual(
        expect.arrayContaining([
          'previous_marriage_date',
          'previous_spouse_name',
          'previous_spouse_date_of_birth',
          'previous_spouse_country_of_birth',
        ]),
      );
      expect(m).not.toContain('spouse_occupation');
      expect(missing({ marital_status: status })).toContain('marriage_end_date');
    });

    it('the block and the end date are written; nothing of a living spouse', () => {
      const p = {
        marital_status: status,
        marriage_end_date: '2019-08-01',
        previous_marriage_date: '2010-03-14',
        previous_spouse_name: 'Rubina Haider',
        previous_spouse_date_of_birth: '1984-12-02',
        previous_spouse_country_of_birth: 'Pakistan',
      };
      expect(at(p, '#endDatePartnerYear_sltDateYear')).toBe('2019');
      expect(at(p, '#endDatePartnerDay_sltDateDay')).toBe('1');
      expect(at(p, '#dateOfDatingYear_sltDateYear')).toBe('2010');
      expect(fam(p, '#lastName_input')).toBe('Haider');
      expect(fam(p, '#firstName_input')).toBe('Rubina');
      expect(at(p, '#dateOfBirthPartnerYear_sltDateYear')).toBe('1984');
      expect(at(p, '#countryOfBirthPartner_select')).toBeDefined();
      for (const t of [
        '#partnerOccupation_select',
        '#commonAddressFamily_radio-button-01-input',
        '#commonAddressFamily_radio-button-02-input',
      ])
        expect(fam(p, t)).toBeUndefined();
    });
  },
);

describe('Widowed: the late spouse', () => {
  const widow = {
    marital_status: 'Widowed',
    marriage_end_date: '2021-01-09',
    marriage_date: '1985-11-20',
    spouse_name: undefined,
    spouse_date_of_birth: undefined,
    spouse_country_of_birth: undefined,
  };

  it('intake asks the late spouse name, DOB and country of birth', () => {
    expect(missing(widow)).toEqual(
      expect.arrayContaining([
        'previous_spouse_name',
        'previous_spouse_date_of_birth',
        'previous_spouse_country_of_birth',
      ]),
    );
    // The marriage date is already answered.
    expect(missing(widow)).not.toContain('previous_marriage_date');
  });

  it('no marriage date yet: it is asked', () => {
    expect(missing({ ...widow, marriage_date: undefined })).toContain('previous_marriage_date');
  });

  it('an existing spouse_* answer satisfies them', () => {
    const m = missing({
      ...widow,
      spouse_name: 'Shahida Bano',
      spouse_date_of_birth: '1960-04-04',
      spouse_country_of_birth: 'Pakistan',
    });
    expect(m).not.toContain('previous_spouse_name');
    expect(m).not.toContain('previous_spouse_date_of_birth');
    expect(m).not.toContain('previous_spouse_country_of_birth');
  });

  it('the answers fill the spouse block', () => {
    const p = {
      marital_status: 'Widowed',
      marriage_end_date: '2021-01-09',
      marriage_date: '1985-11-20',
      previous_spouse_name: 'Shahida Bano',
      previous_spouse_date_of_birth: '1960-04-04',
      previous_spouse_country_of_birth: 'Pakistan',
    };
    expect(fam(p, '#lastName_input')).toBe('Bano');
    expect(fam(p, '#firstName_input')).toBe('Shahida');
    expect(at(p, '#dateOfBirthPartnerYear_sltDateYear')).toBe('1960');
    expect(at(p, '#countryOfBirthPartner_select')).toBeDefined();
    expect(at(p, '#dateOfDatingYear_sltDateYear')).toBe('1985');
  });
});

describe('Married / single: unchanged', () => {
  it('no previous-partner questions', () => {
    for (const marital_status of ['Married', 'Single']) {
      const m = missing({ marital_status });
      expect(m).not.toContain('previous_spouse_name');
      expect(m).not.toContain('previous_marriage_date');
    }
  });

  it('a married applicant\'s previous_spouse_* never reaches the current spouse block', () => {
    const p = {
      marital_status: 'Married',
      spouse_name: 'Nadia Karim',
      previous_spouse_name: 'Rubina Haider',
    };
    expect(fam(p, '#lastName_input')).toBe('Karim');
  });
});

describe('Forms page (step 13): former or late spouse questions', () => {
  const ctx = (profile: Record<string, unknown>): FinalizeContext => ({
    applicantName: 'TARIQ QURESHI',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: TRV,
  });
  const gen = (marital: string): PrefilledFormField[] => [
    { key: 'family_name', label: 'family_name', value: 'QURESHI', group: 'Personal', source: 'profile' },
    { key: 'marital_status', label: 'marital_status', value: marital, group: 'Family', source: 'profile' },
  ];
  const keys = (marital: string, profile: Record<string, unknown> = {}) =>
    finalizeFields(gen(marital), ctx(profile)).map((f) => f.key);

  it.each(['Divorced', 'Separated', 'Annulled'])('%s: the former spouse details are asked', (m) => {
    expect(keys(m)).toEqual(
      expect.arrayContaining([
        'previous_marriage_date',
        'previous_spouse_name',
        'previous_spouse_date_of_birth',
        'previous_spouse_country_of_birth',
      ]),
    );
  });

  it('Widowed: the late spouse details (marriage date under marriage_date)', () => {
    const k = keys('Widowed');
    expect(k).toEqual(
      expect.arrayContaining([
        'marriage_date',
        'previous_spouse_name',
        'previous_spouse_date_of_birth',
        'previous_spouse_country_of_birth',
      ]),
    );
    expect(k).not.toContain('previous_marriage_date');
  });

  it('Married / Single: none', () => {
    for (const m of ['Married', 'Single']) {
      expect(keys(m)).not.toContain('previous_spouse_name');
      expect(keys(m)).not.toContain('previous_marriage_date');
    }
  });

  it('a Forms-page answer reaches the IRCC mapping', () => {
    const out = finalizeFields(gen('Widowed'), ctx({}));
    const set = (k: string, v: string) => {
      out.find((f) => f.key === k)!.value = v;
    };
    set('marriage_date', '1985-11-20');
    set('previous_spouse_name', 'Shahida Bano');
    set('previous_spouse_date_of_birth', '1960-04-04');
    set('previous_spouse_country_of_birth', 'Pakistan');
    const profile = Object.fromEntries(out.map((f) => [f.key, f.value]));
    expect(fam(profile, '#lastName_input')).toBe('Bano');
    expect(at(profile, '#dateOfDatingYear_sltDateYear')).toBe('1985');
    expect(at(profile, '#dateOfBirthPartnerYear_sltDateYear')).toBe('1960');
  });
});
