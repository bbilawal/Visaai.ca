/**
 * Gaps found on a LIVE fresh super visa draft (2026-10-18, app 61f16bb5,
 * extension 0.1.34), selector ids verified on the portal:
 *  1. /group-questions was not mapped (hasGroup, before /purpose);
 *  2. /bio-data-travel-docs: the visa-in-10-years and by-air radios read
 *     keys the intake does not use;
 *  3. city of birth empty with birthplace_city "Rawalpindi";
 *  4. national ID page skipped: national_identity_card_number;
 *  5. hasOtherNames "Yes" with no name row: IRCC cannot save the page.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-eta';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import { CA_ETA_VISAAI_ID } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  portalPageOrder,
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { finalizeFields } from '../src/modules/prefill/graphs/nodes/finalize-fields';

const trv = () => resolvePortalFill('ircc')!;
const sv = () => resolvePortalFillFor('ircc', 'ca-super-visa')!;
const eta = () => resolvePortalFill('ircc-eta')!;

const PARENT: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  passport_number: 'AB1234567',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  host_name: 'Ali Ahmad',
};

const on = (
  m: ReturnType<typeof trv>,
  p: Record<string, unknown>,
  page: string,
) => buildMappingInputs(m, p).filter((x) => x.page === page);
const targets = (
  m: ReturnType<typeof trv>,
  p: Record<string, unknown>,
  page: string,
) => on(m, p, page).map((x) => x.targetField);
const left = (
  m: ReturnType<typeof trv>,
  p: Record<string, unknown>,
  page: string,
) => portalFillCoverage(m, p).pages.find((x) => x.page === page)?.left ?? [];

describe('1. /group-questions', () => {
  it('comes before /purpose', () => {
    const order = portalPageOrder('/purpose');
    expect(order.indexOf('/group-questions')).toBeLessThan(
      order.indexOf('/purpose'),
    );
  });

  it.each([
    ['TRV', trv],
    ['super visa', sv],
  ])('%s: one applicant answers No', (_n, m) => {
    expect(targets(m(), PARENT, '/group-questions')).toEqual([
      '#hasGroup_radio-button-02-input',
    ]);
  });

  it('a group application is left for the applicant, never answered Yes', () => {
    const p = { ...PARENT, group_application: 'Yes' };
    expect(targets(trv(), p, '/group-questions')).toEqual([]);
    expect(left(trv(), p, '/group-questions').map((l) => l.label)).toContain(
      'Group application',
    );
  });

  it('a Forms or consultant "Yes" under the question\'s own key is never overwritten with No', () => {
    for (const m of [trv(), sv()]) {
      const fromProfile = { ...PARENT, ircc_group_application: 'Yes' };
      expect(targets(m, fromProfile, '/group-questions')).toEqual([]);
      const fromForm = applyPrefillOverrides(m, PARENT, [
        {
          key: 'ircc_group_application',
          label: 'Group application',
          value: 'Yes',
          source: 'consultant',
        },
      ]);
      expect(targets(m, fromForm, '/group-questions')).toEqual([]);
      expect(
        left(m, fromForm, '/group-questions').map((l) => l.label),
      ).toContain('Group application');
    }
  });
});

describe('2. /bio-data-travel-docs radios', () => {
  it.each([
    [
      { canadian_visa_last_10y: 'No' },
      '#travelledToCanadaInPastTen_radio-button-02-input',
    ],
    [
      { held_canadian_visa_last_10_years: true },
      '#travelledToCanadaInPastTen_radio-button-01-input',
    ],
    [{ travel_by_air: 'Yes' }, '#travellingByAir_radio-button-01-input'],
    [{ arriving_by_air: false }, '#travellingByAir_radio-button-02-input'],
    [
      { travel_mode: 'Flight via Dubai' },
      '#travellingByAir_radio-button-01-input',
    ],
    [
      { travel_mode: 'By car from the US' },
      '#travellingByAir_radio-button-02-input',
    ],
  ])('%j → %s', (extra, target) => {
    expect(
      targets(sv(), { ...PARENT, ...extra }, '/bio-data-travel-docs'),
    ).toContain(target);
  });

  it('never guessed: unknown leaves both for the applicant', () => {
    const t = targets(sv(), PARENT, '/bio-data-travel-docs');
    expect(
      t.some((x) => /travelledToCanadaInPastTen|travellingByAir/.test(x)),
    ).toBe(false);
    // "visited Canada" is not "held a visa"
    const visited = targets(
      sv(),
      { ...PARENT, previously_visited_canada: 'Yes' },
      '/bio-data-travel-docs',
    );
    expect(visited.some((x) => /travelledToCanadaInPastTen/.test(x))).toBe(
      false,
    );
    const labels = left(sv(), PARENT, '/bio-data-travel-docs').map(
      (l) => l.label,
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        'Held a Canadian visitor visa in the past 10 years',
        'Travelling to Canada by air',
      ]),
    );
  });
});

describe('3. city of birth', () => {
  it('reads birthplace_city when place_of_birth is empty (live 61f16bb5)', () => {
    const city = on(
      sv(),
      { ...PARENT, birthplace_city: 'Rawalpindi', place_of_birth: '' },
      '/nationality',
    ).find((x) => x.targetField === '#cityBirth_input');
    expect(city?.mappedValue).toBe('Rawalpindi');
  });

  it('reads a one-line birth_place', () => {
    const v = on(
      trv(),
      { ...PARENT, birth_place: 'Lahore, Pakistan' },
      '/nationality',
    );
    expect(
      v.find((x) => x.targetField === '#cityBirth_input')?.mappedValue,
    ).toBe('Lahore');
  });
});

describe('4. national ID', () => {
  const ID = {
    ...PARENT,
    national_identity_card_number: '37405-1234567-1',
    national_identity_card_country: 'Pakistan',
    national_identity_card_issue_date: '2015-06-01',
  };

  it('fills the page from national_identity_card_* keys, dashes stripped', () => {
    const page = on(sv(), ID, '/national-id-doc');
    const by = (t: string) =>
      page.find((x) => x.targetField === t)?.mappedValue;
    expect(by('#hasNationality_radio-button-01-input')).toBe('Yes');
    expect(by('#docNumberNationalities_input')).toBe('3740512345671');
    expect(by('#docNumberConfirmationNationalities_input')).toBe(
      '3740512345671',
    );
    expect(page.some((x) => x.fieldKey === 'national_id_issue_date')).toBe(
      true,
    );
    expect(page.some((x) => x.fieldKey === 'national_id_country')).toBe(true);
  });

  it('without an issue date the rest fills and the date is listed', () => {
    const { national_identity_card_issue_date: _d, ...noDate } = ID;
    const page = on(sv(), noDate, '/national-id-doc');
    expect(
      page.some((x) => x.targetField === '#docNumberNationalities_input'),
    ).toBe(true);
    expect(page.some((x) => x.fieldKey === 'national_id_issue_date')).toBe(
      false,
    );
    expect(
      left(sv(), noDate, '/national-id-doc').map((l) => l.label),
    ).toContain('National identity document issue date');
  });

  it('the Forms page does not add a second ID field beside national_identity_card_number', () => {
    const out = finalizeFields(
      [
        {
          key: 'national_identity_card_number',
          label: 'National identity card number',
          value: '',
          group: 'Identity documents',
          source: 'profile',
        },
      ],
      {
        applicantName: 'MUZAFFAR AHMAD',
        profile: { ...ID },
        documentFields: {
          national_id_number: '37405-1234567-1',
          nationality: 'PAK',
        },
        documentFieldsByType: {
          national_id: {
            national_id_number: '37405-1234567-1',
            nationality: 'PAK',
          },
        },
        otherPartyDocuments: [],
        accountProfile: {},
        route: { country: 'CA', visaaiId: 'ca-super-visa' },
      },
    );
    // The issue date and country are carried as their own fields (interview
    // facts since 2026-10-19); the NUMBER is not carried twice.
    const ids = out.filter((f) => /national_id.*number/.test(f.key));
    expect(ids.map((f) => f.key)).toEqual(['national_identity_card_number']);
    expect(ids[0].value).toBe('37405-1234567-1');
  });
});

describe('5. a Yes that needs a table row', () => {
  it('other names: Yes only with a complete row, else the applicant answers', () => {
    const p = { ...PARENT, has_other_names: 'Yes' };
    expect(targets(sv(), p, '/other-names')).toEqual([]);
    expect(left(sv(), p, '/other-names').map((l) => l.label)).toContain(
      'Other names you have used',
    );
    const withRow = {
      ...p,
      other_names: [{ name: 'Muzaffar Khan', type: 'previous name' }],
    };
    expect(targets(sv(), withRow, '/other-names')[0]).toBe(
      '#hasOtherNames_radio-button-01-input',
    );
    expect(
      targets(sv(), { ...PARENT, has_other_names: 'No' }, '/other-names'),
    ).toEqual(['#hasOtherNames_radio-button-02-input']);
  });

  it('children: Yes with no complete child is left with a note', () => {
    const p = { ...PARENT, has_children: 'Yes' };
    expect(targets(sv(), p, '/family-info-children')).toEqual([]);
    expect(
      left(sv(), p, '/family-info-children').map((l) => l.label),
    ).toContain('Children');
  });

  it('trips: Yes with no complete trip is left', () => {
    const p = { ...PARENT, travelled_last_5_years: 'Yes' };
    expect(targets(sv(), p, '/travel-history')).toEqual([]);
    expect(
      targets(
        sv(),
        { ...PARENT, travelled_last_5_years: 'No' },
        '/travel-history',
      ),
    ).toEqual(['#traveledToOtherCountries_radio-button-02-input']);
  });

  it('trips: only incomplete trips also get the "answer the question" note', () => {
    const p = {
      ...PARENT,
      travel_history: [{ country: 'UAE', from: '2024-01', to: '2024-02' }],
    };
    expect(targets(sv(), p, '/travel-history')).toEqual([]);
    expect(left(sv(), p, '/travel-history').map((l) => l.label)).toEqual(
      expect.arrayContaining(['Trips in the past 5 years', 'Trip 1']),
    );
  });

  it('post-secondary education: only No is written (no education rows)', () => {
    const yes = targets(
      sv(),
      { ...PARENT, has_post_secondary_education: 'Yes' },
      '/activities',
    );
    expect(
      yes.some((t) => /hasPostSecondaryEducation_radio-button-01/.test(t)),
    ).toBe(false);
    const no = targets(
      sv(),
      { ...PARENT, has_post_secondary_education: 'No' },
      '/activities',
    );
    expect(no).toContain('#hasPostSecondaryEducation_radio-button-02-input');
  });
});

describe('isolation', () => {
  it('super visa purpose stays 472', () => {
    expect(
      targets(sv(), { ...PARENT, ircc_visa_purpose: 'Tourism' }, '/purpose'),
    ).toContain('#visaPurpose_radio-button-472-input');
  });

  it('eTA mapping has none of the new tr-rt pages or keys', () => {
    const pages = new Set(eta().map((f) => f.page));
    expect(pages.has('/group-questions')).toBe(false);
    expect(eta().some((f) => f.profileKey === 'ircc_group_application')).toBe(
      false,
    );
    expect(resolvePortalFillFor('ircc-eta', CA_ETA_VISAAI_ID)).toBe(eta());
  });
});
