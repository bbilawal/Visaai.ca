/**
 * Follow-up questions recorded on the live IRCC portal by flipping every radio
 * and checkbox of a new draft (2026-10-18): what each answer reveals, and
 * that the assistant fills it from VisaAI's answers — or leaves it listed.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { irccOccupationFor } from '../src/modules/automation/portal-fills/ircc-occupations';

const mapping = () => resolvePortalFill('ircc')!;
const inputs = (p: Record<string, unknown>) => buildMappingInputs(mapping(), p);
const targets = (p: Record<string, unknown>, page: string) =>
  inputs(p)
    .filter((m) => m.page === page)
    .map((m) => m.targetField);
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(mapping(), p).pages.find((x) => x.page === page)?.left ??
  [];

const BASE = {
  given_name: 'Amit',
  family_name: 'Sharma',
  date_of_birth: '1970-01-02',
  nationality: 'India',
  passport_number: 'Z1234567',
  current_country_of_residence: 'India',
};

describe('/purpose: the visa purpose', () => {
  const purposeOf = (p: Record<string, unknown>) =>
    inputs({ ...BASE, ...p }).find((m) => m.fieldKey === 'ircc_visa_purpose')
      ?.targetField;
  it.each([
    [{ purpose_of_visit: 'Tourism and sightseeing' }, '470'],
    [{ purpose_of_visit: 'Attend a business conference in Toronto' }, '473'],
    [{ purpose_of_visit: 'Scheduled medical treatment at Sick Kids' }, '474'],
    [
      {
        purpose_of_visit: 'Visit my daughter',
        host_relationship: 'daughter',
        host_status: 'Permanent resident',
      },
      '688',
    ],
    [
      {
        purpose_of_visit: 'Visit my son',
        host_relationship: 'son',
        host_status: 'International student',
      },
      '687',
    ],
    [
      {
        purpose_of_visit: 'Visit my wife',
        host_relationship: 'wife',
        host_status: 'Canadian citizen',
      },
      '686',
    ],
    [
      { purpose_of_visit: 'Visit my cousin', host_relationship: 'cousin' },
      '471',
    ],
  ])('%j → %s', (p, code) => {
    expect(purposeOf(p)).toBe(`#visaPurpose_radio-button-${code}-input`);
  });
  it('a family visit without the host status is left for the applicant', () => {
    expect(
      purposeOf({ purpose_of_visit: 'Visit my son', host_relationship: 'son' }),
    ).toBeUndefined();
  });
  it('"I want to apply for" is always the visitor visa, first on the page', () => {
    expect(targets(BASE, '/purpose')[0]).toBe(
      '#applyingFor_radio-button-464-input',
    );
  });
});

describe('/family-info-children', () => {
  it('"No children" ticks IRCC\'s acknowledgement, which the page requires', () => {
    expect(
      targets({ ...BASE, has_children: false }, '/family-info-children'),
    ).toEqual([
      '#hasChild_radio-button-02-input',
      '#declaringChildren_chk-input',
    ]);
  });
  it('a child living elsewhere is written with their address (Canada: manual entry)', () => {
    const t = targets(
      {
        ...BASE,
        children: [
          {
            name: 'Ravi Sharma',
            relationship: 'son',
            date_of_birth: '1995-03-04',
            country_of_birth: 'India',
            same_address: false,
            coming_to_canada: false,
            address: '12 King Street, Toronto, ON M5H 1A1, Canada',
          },
        ],
      },
      '/family-info-children',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        '#country_childInfoAddress',
        '#manualEntryaddress_childInfoAddress-input',
        '#streetNum_childInfoAddress',
        '#street_childInfoAddress',
        '#city_childInfoAddress',
        '#province_childInfoAddress',
        '#postalcode_childInfoAddress',
      ]),
    );
  });
  it('a child abroad with an address uses the single street line', () => {
    const t = targets(
      {
        ...BASE,
        children: [
          {
            name: 'Priya Sharma',
            relationship: 'daughter',
            date_of_birth: '1998-03-04',
            country_of_birth: 'India',
            same_address: false,
            coming_to_canada: false,
            address: {
              street: '5 Marine Drive',
              city: 'Mumbai',
              country: 'India',
            },
          },
        ],
      },
      '/family-info-children',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        '#streetAddress_childInfoAddress',
        '#city_childInfoAddress',
      ]),
    );
    expect(t).not.toContain('#manualEntryaddress_childInfoAddress-input');
  });
  it('without an address the child is listed, not half-written', () => {
    const p = {
      ...BASE,
      children: [
        {
          name: 'Ravi Sharma',
          relationship: 'son',
          date_of_birth: '1995-03-04',
          country_of_birth: 'India',
          same_address: false,
          coming_to_canada: false,
        },
      ],
    };
    expect(
      targets(p, '/family-info-children').some((t) =>
        /childInfoAddress/.test(t),
      ),
    ).toBe(false);
    expect(
      left(p, '/family-info-children')
        .map((l) => l.note)
        .join(' '),
    ).toMatch(/their address/);
    // No complete child row: "Yes" would leave an unsaveable page (live
    // 2026-10-18), so the question is the applicant's too.
    expect(targets(p, '/family-info-children')).toEqual([]);
  });
});

describe('/family-info: spouse and past unions', () => {
  it('a common-law partner gets the spouse questions', () => {
    const t = targets(
      {
        ...BASE,
        marital_status: 'Common-law',
        spouse_name: 'Neha Verma',
        spouse_date_of_birth: '1972-05-06',
        spouse_country_of_birth: 'India',
        spouse_same_address: true,
        spouse_coming_to_canada: false,
      },
      '/family-info',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        '#lastName_input',
        '#commonAddressFamily_radio-button-01-input',
        '#partnerComingCanada_radio-button-02-input',
      ]),
    );
  });
  it('a spouse at another address is written with it', () => {
    const t = targets(
      {
        ...BASE,
        marital_status: 'Married',
        spouse_name: 'Neha Sharma',
        spouse_same_address: false,
        spouse_address: '5 Marine Drive, Mumbai, Maharashtra, 400020, India',
      },
      '/family-info',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        '#country_partnerInfoAddress',
        '#streetAddress_partnerInfoAddress',
        '#city_partnerInfoAddress',
      ]),
    );
  });
  it('divorced: the date the marriage ended', () => {
    const t = targets(
      { ...BASE, marital_status: 'Divorced', divorce_date: '2015-07-08' },
      '/family-info',
    );
    expect(t).toEqual([
      '#currentMaritalStatus_radio-button-04-input',
      '#endDatePartnerYear_sltDateYear',
      '#endDatePartnerMonth_sltDateMonth',
      '#endDatePartnerDay_sltDateDay',
    ]);
  });
});

describe('/language', () => {
  it('"both" English and French asks which is easiest', () => {
    const t = targets(
      {
        ...BASE,
        official_language_ability: 'both',
        preferred_contact_language: 'French',
      },
      '/language',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        '#knowLanguage_radio-button-04-input',
        '#easeLanguage_radio-button-02-input',
        '#preferredLanguage_radio-button-02-input',
      ]),
    );
  });
});

describe('declarations: a "Yes" reveals a details box', () => {
  it("written only from the applicant's own details", () => {
    const t = targets(
      {
        ...BASE,
        ever_arrested: true,
        ever_arrested_details:
          'Arrested in 1999 at a protest, released without charge.',
      },
      '/crime-activity',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        '#hasBeenArrested_radio-button-01-input',
        '#arrestedDetails_txtArea',
      ]),
    );
  });
  it('a "Yes" without details is listed as needing the applicant\'s answer', () => {
    const l = left({ ...BASE, ever_arrested: true }, '/crime-activity');
    expect(l.map((x) => x.label)).toContain('Arrest — details');
  });
});

describe('/activities: the current job', () => {
  const JOB = {
    ...BASE,
    occupation: 'Software Engineer',
    employer_name: 'Infosys',
    job_duties: 'Design and build banking software',
    employment_start_date: '2015-03',
    employer_address:
      '44 Electronics City, Bengaluru, Karnataka, 560100, India',
  };
  it("is written as a work-history row with IRCC's occupation and job title", () => {
    const out = inputs(JOB).filter((m) =>
      m.fieldKey.startsWith('ircc_work_current_'),
    );
    const v = (k: string) => out.find((m) => m.fieldKey === k)?.mappedValue;
    expect(v('ircc_work_current_activity')).toBe(
      'Natural and applied sciences and related occupations',
    );
    expect(v('ircc_work_current_title')).toBe(
      'Computer and information systems professionals',
    );
    expect(v('ircc_work_current_employer')).toBe('Infosys');
    expect(v('ircc_work_current_address_city')).toBe('Bengaluru');
  });
  it("without duties or the employer's street, it is listed with what is missing", () => {
    const { job_duties: _d, employer_address: _a, ...rest } = JOB;
    expect(
      inputs(rest).some((m) => m.fieldKey.startsWith('ircc_work_current_')),
    ).toBe(false);
    const note =
      left(rest, '/activities').find((l) => l.label === 'Current job')?.note ??
      '';
    expect(note).toMatch(/your duties/);
    expect(note).toMatch(/full address/);
  });
  it('a job title the rules cannot place is never guessed', () => {
    expect(irccOccupationFor('Chief Happiness Officer')).toBeUndefined();
    expect(irccOccupationFor('School teacher')?.title).toBe(
      'Secondary and elementary school teachers and educational counsellors',
    );
  });
});

describe('/travel-history: trips of the last five years', () => {
  const TRIP = {
    country: 'United Arab Emirates',
    from: '2023-01-10',
    to: '2023-02-05',
    city: 'Dubai',
    purpose: 'Tourism',
  };
  it('a complete trip is written as a row and answers Yes', () => {
    const t = targets({ ...BASE, travel_history: [TRIP] }, '/travel-history');
    expect(t).toEqual(
      expect.arrayContaining([
        '#traveledToOtherCountries_radio-button-01-input',
        '#fromtravelHistoryYear_sltDateYear',
        '#totravelHistoryMonth_sltDateMonth',
        '#travelHistoryCountry_select',
        '#travelHistoryLocation_input',
        '#travelHistoryPurposeOfTravel_input',
      ]),
    );
  });
  it('a trip without a purpose is listed, not half-written', () => {
    const { purpose: _p, ...noPurpose } = TRIP;
    const p = { ...BASE, travel_history: [noPurpose] };
    // No complete trip row: "Yes" is not written either (live 2026-10-18).
    expect(targets(p, '/travel-history')).toEqual([]);
    expect(
      left(p, '/travel-history')
        .map((l) => l.note)
        .join(' '),
    ).toMatch(/purpose/);
  });
});

describe('/other-names', () => {
  it('a name before marriage is written with its kind', () => {
    const t = targets(
      { ...BASE, other_names: [{ name: 'Amita Verma', type: 'maiden name' }] },
      '/other-names',
    );
    expect(t).toEqual([
      '#hasOtherNames_radio-button-01-input',
      'main button[id*="add"]',
      '#nameType_radio-button-07-input',
      '#lastName_input',
      '#firstName_input',
      '::dialog-save',
    ]);
  });
  it('the kind of name is never guessed', () => {
    const p = { ...BASE, other_names: ['Amit Kumar'] };
    // No complete row: "Yes" would leave the page unsaveable (live 2026-10-18).
    expect(targets(p, '/other-names')).toEqual([]);
    expect(
      left(p, '/other-names')
        .map((l) => l.note)
        .join(' '),
    ).toMatch(/alias, a name before marriage or a previous name/);
  });
});

describe('/contact-info: a mailing address that is not home', () => {
  it('writes the home address IRCC then asks for', () => {
    const t = targets(
      {
        ...BASE,
        residential_address: '12 MG Road, Pune, Maharashtra, 411001, India',
        mailing_address: 'PO Box 55, Mumbai, Maharashtra, 400001, India',
      },
      '/contact-info',
    );
    expect(t).toEqual(
      expect.arrayContaining([
        '#hasDiffAddressContactInfo_radio-button-02-input',
        '#country_otherResidentialAddressContactInfo',
        '#streetAddress_otherResidentialAddressContactInfo',
        '#city_otherResidentialAddressContactInfo',
      ]),
    );
  });
});
