/**
 * tr-rt coverage audit wave 2a (2026-10-31, matrix A 4, 13, 14, 25, 68, 83).
 * The extension halts the whole fill on the first missing selector, so only
 * ids recorded live are written; everything else is collected in intake and
 * left for the applicant with the exact values:
 *  - earlier countries of residence (A 68): asked (yes/no, then the list);
 *    the past-row controls (`datesToResidence*` on a row that is not
 *    ongoing) were never seen live, so the rows are a note;
 *  - a tourist with no host (A 83): the accommodation is asked; the
 *    invitation page is not written, and the note names the place to stay;
 *  - visit purposes (A 13, 14): the visaPurpose codes recorded live on
 *    2026-10-18 are written; transit (A 4) has unrecorded follow-ups, so the
 *    purpose page is left with a note;
 *  - a travel document that is not a passport (A 25): 249 Passport is not
 *    written; the note gives the document's values.
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
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
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
const [TRV, SUPER, BUSINESS] = TR_RT_ROUTES;

const BASE: Record<string, unknown> = {
  given_name: 'Farah',
  family_name: 'Siddiqui',
  date_of_birth: '1984-07-19',
  nationality: 'PAK',
  passport_number: 'QW1234567',
  purpose_of_visit: 'tourism',
  planned_entry_date: '2027-04-02',
  planned_departure_date: '2027-04-20',
  residence_since: 'since birth',
  residential_address: '9 Canal Road, Faisalabad, Pakistan',
};

const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), values(p));
const targets = (p: Record<string, unknown>, page?: string) =>
  mapped(p)
    .filter((x) => !page || x.page === page)
    .map((x) => x.targetField);
const coverage = (p: Record<string, unknown>) =>
  portalFillCoverage(trv(), values(p));
const left = (p: Record<string, unknown>, page: string) =>
  coverage(p).pages.find((x) => x.page === page)?.left ?? [];
const noteOf = (p: Record<string, unknown>, page: string, label: string) =>
  left(p, page).find((l) => l.label === label)?.note;

const answers = (p: Record<string, unknown>) => ({
  purpose_of_visit: 'tourism',
  employed: false,
  planned_entry_date: '2027-04-02',
  planned_departure_date: '2027-04-20',
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

function ctx(
  profile: Record<string, unknown>,
  route: FinalizeContext['route'] = TRV,
): FinalizeContext {
  return {
    applicantName: 'FARAH SIDDIQUI',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route,
  };
}
const GENERATED: PrefilledFormField[] = [
  { key: 'family_name', label: 'family_name', value: 'SIDDIQUI', group: 'Personal', source: 'profile' },
  { key: 'purpose_of_trip', label: 'purpose_of_trip', value: 'Tourism', group: 'Travel', source: 'profile' },
];
const formKeys = (p: Record<string, unknown>, route = TRV) =>
  finalizeFields(GENERATED, ctx(p, route)).map((f) => f.key);

// ── 1. earlier countries of residence (A 68) ────────────────────────────────
describe('earlier countries of residence: asked, left as a note', () => {
  const EARLIER = {
    lived_elsewhere_last_5_years: true,
    previous_countries_of_residence: [
      { country: 'United Arab Emirates', status: 'Worker', from: '2019-03-01', to: '2022-06-30' },
      { country: 'Qatar', from: '2022-07-01', to: '2023-01-15' },
    ],
  };

  it.each(TR_RT_ROUTES)('the yes/no is asked first, the list only after Yes (%o)', (route) => {
    const none = { lived_elsewhere_last_5_years: undefined };
    expect(missing(none, route)).toContain('lived_elsewhere_last_5_years');
    expect(missing(none, route)).not.toContain('previous_countries_of_residence');
    expect(missing({ lived_elsewhere_last_5_years: true }, route)).toContain(
      'previous_countries_of_residence',
    );
    expect(missing({ lived_elsewhere_last_5_years: false }, route)).not.toContain(
      'previous_countries_of_residence',
    );
    const complete = {
      lived_elsewhere_last_5_years: true,
      previous_countries_of_residence: [EARLIER.previous_countries_of_residence[0]],
    };
    expect(missing(complete, route)).not.toContain('previous_countries_of_residence');
    // The Qatar row has no status: asked again.
    expect(missing(EARLIER, route)).toContain('previous_countries_of_residence');
  });

  it('a row missing its status or dates is asked again', () => {
    const half = {
      lived_elsewhere_last_5_years: true,
      previous_countries_of_residence: [{ country: 'Oman' }],
    };
    expect(missing(half)).toContain('previous_countries_of_residence');
  });

  // Live 2026-10-31: a past row (ongoing unticked, From and To) saves.
  it('a complete earlier row is written as a past row; an incomplete one is not', () => {
    const t = targets(EARLIER, '/contact-info');
    // The current residence (citizen, since birth) and the UAE row.
    expect(t.filter((s) => s === '#otherCountriesResidences_add_button')).toHaveLength(2);
    const m = mapped(EARLIER).filter((x) => x.page === '/contact-info');
    const uae = m.filter((x) => x.fieldKey.startsWith('ircc_earlier_residence_1_'));
    expect(uae.find((x) => x.targetField === '#statusResidence_select')?.mappedValue).toBe('Worker');
    expect(uae.find((x) => x.targetField === '#datesFromResidenceYear_sltDateYear')?.mappedValue).toBe('2019');
    expect(uae.find((x) => x.targetField === '#datesToResidenceYear_sltDateYear')?.mappedValue).toBe('2022');
    expect(uae.some((x) => x.targetField === '#ongoing_chk-input')).toBe(false);
    expect(m.some((x) => x.fieldKey.startsWith('ircc_earlier_residence_2_'))).toBe(false);
  });

  it('the note lists only the earlier countries not written', () => {
    const note = noteOf(EARLIER, '/contact-info', 'Earlier countries of residence');
    expect(note).not.toContain('United Arab Emirates');
    expect(note).toContain('Qatar, status (your status there), from 2022-07-01 to 2023-01-15');
    expect(note).toMatch(/leave "This is where I currently live" unticked/);
    const complete = { lived_elsewhere_last_5_years: true, previous_countries_of_residence: [EARLIER.previous_countries_of_residence[0]] };
    expect(noteOf(complete, '/contact-info', 'Earlier countries of residence')).toBeUndefined();
  });

  it('a list given as text is carried as written', () => {
    const note = noteOf(
      { lived_elsewhere_last_5_years: 'yes', previous_countries_of_residence: 'Saudi Arabia 2018 to 2020 as a worker' },
      '/contact-info',
      'Earlier countries of residence',
    );
    expect(note).toContain('Saudi Arabia 2018 to 2020 as a worker');
  });

  it('Yes without the countries asks the applicant to add them', () => {
    expect(
      noteOf({ lived_elsewhere_last_5_years: true }, '/contact-info', 'Earlier countries of residence'),
    ).toMatch(/Add a row for each country you lived in for more than 6 months/);
  });

  it('No (or "none") leaves no note', () => {
    expect(
      noteOf({ lived_elsewhere_last_5_years: false }, '/contact-info', 'Earlier countries of residence'),
    ).toBeUndefined();
    expect(
      noteOf({ previous_countries_of_residence: 'none' }, '/contact-info', 'Earlier countries of residence'),
    ).toBeUndefined();
  });

  it('Forms page: the yes/no is asked, the list after Yes', () => {
    expect(formKeys({})).toContain('lived_elsewhere_last_5_years');
    expect(formKeys({})).not.toContain('previous_countries_of_residence');
    expect(formKeys({ lived_elsewhere_last_5_years: 'Yes' })).toContain(
      'previous_countries_of_residence',
    );
  });
});

// ── 2. tourist with no host (A 83) ──────────────────────────────────────────
describe('tourist with no host: accommodation asked, invitation left with a note', () => {
  const HOTEL = {
    accommodation_provider_name: 'Maple Grove Hotel',
    accommodation_address: '455 King St W, Toronto, ON M5V 1K4',
  };
  const LABEL = 'Who you will visit or where you will stay';

  const NOWHERE = { accommodation_provider_name: undefined, accommodation_address: undefined };

  it('TRV with no host asks where they will stay', () => {
    expect(missing(NOWHERE)).toEqual(
      expect.arrayContaining(['accommodation_provider_name', 'accommodation_address']),
    );
    expect(missing(HOTEL)).not.toContain('accommodation_provider_name');
    expect(missing(HOTEL)).not.toContain('accommodation_address');
  });

  it('a hosted TRV applicant, the super visa and business visitors are not asked', () => {
    const hosted = { family_in_destination: true, inviter_name: 'Imran Siddiqui' };
    expect(missing({ ...NOWHERE, ...hosted })).not.toContain('accommodation_provider_name');
    expect(missing(NOWHERE, SUPER)).not.toContain('accommodation_provider_name');
    expect(missing(NOWHERE, BUSINESS)).not.toContain('accommodation_provider_name');
  });

  it('the hotel is never written as the inviter', () => {
    expect(targets(HOTEL, '/inviter-info').filter((t) => t.startsWith('#firstInviter'))).toEqual([]);
  });

  // Live 2026-10-31: the tourist (470) flow has no /inviter-info page.
  it('a tourist gets no invitation-page note (the page does not exist)', () => {
    expect(noteOf(HOTEL, '/inviter-info', LABEL)).toBeUndefined();
    expect(noteOf({}, '/inviter-info', LABEL)).toBeUndefined();
  });

  const MEDICAL = { purpose_of_visit: 'medical treatment' };
  it('the note names the place to stay, with its address (non-tourist)', () => {
    expect(noteOf({ ...HOTEL, ...MEDICAL }, '/inviter-info', LABEL)).toBe(
      'IRCC asks who you will visit or where you will stay. You have no host in Canada, so the assistant left this page blank: if IRCC asks for it, enter where you will stay — Maple Grove Hotel, 455 King St W, Toronto, ON M5V 1K4.',
    );
  });

  it('without the accommodation, the note asks for the hotel', () => {
    const l = left(MEDICAL, '/inviter-info').find((x) => x.label === LABEL);
    expect(l?.reason).toBe('not_in_profile');
    expect(l?.note).toMatch(/enter your hotel or the place you will stay \(name and address\)/);
  });

  it('a family visit with the host name missing gets the host-missing note, not "no host"', () => {
    const p = { family_in_destination: true, purpose_of_visit: 'Visit my brother' };
    expect(noteOf(p, '/inviter-info', LABEL)).toBeUndefined();
    const hostObj = { host: { relationship: 'brother' } };
    expect(noteOf(hostObj, '/inviter-info', LABEL)).toBeUndefined();
  });

  it('a host leaves no such note', () => {
    expect(
      noteOf(
        { family_in_destination: true, inviter_name: 'Imran Siddiqui', inviter_relationship: 'brother' },
        '/inviter-info',
        LABEL,
      ),
    ).toBeUndefined();
  });

  it.each([
    ['super visa', 'ca-super-visa'],
    ['business visitor', 'ca-business-visitors'],
  ])('the %s variant never shows it', (_, id) => {
    const variant = resolvePortalFillFor('ircc', id)!;
    const cov = portalFillCoverage(variant, applyPrefillOverrides(variant, { ...BASE }, []));
    const all = cov.pages.flatMap((pg) => pg.left);
    expect(all.some((l) => l.label === LABEL)).toBe(false);
  });

  it('Forms page: asked of a TRV tourist with no host only', () => {
    expect(formKeys({})).toEqual(
      expect.arrayContaining(['accommodation_provider_name', 'accommodation_address']),
    );
    expect(formKeys({ host_name: 'Imran Siddiqui' })).not.toContain('accommodation_provider_name');
    expect(formKeys({}, SUPER)).not.toContain('accommodation_provider_name');
  });
});

// ── 3. visit purposes (A 4, 13, 14) ─────────────────────────────────────────
describe('visit purposes: live-recorded codes written, transit left', () => {
  const purposeOf = (p: Record<string, unknown>) =>
    targets(p, '/purpose').find((t) => t.startsWith('#visaPurpose_'));

  it.each([
    [{ purpose_of_visit: 'A 3-week English language course in Vancouver' }, '477'],
    [{ purpose_of_visit: 'Short study program at a college' }, '477'],
    [{ purpose_of_visit: 'I will attend a 3-month English language course in Toronto', planned_entry_date: '2027-01-04', planned_departure_date: '2027-04-02' }, '477'],
    [{ purpose_of_visit: 'Enrol in a summer school in Montreal' }, '477'],
    // Review of f574b692: tourism words win over "course" / "study".
    [{ purpose_of_visit: 'Tourism, of course' }, '470'],
    [{ purpose_of_visit: 'sightseeing and a short cooking course' }, '470'],
    [{ purpose_of_visit: 'Tourism. I will take public transit around Toronto' }, '470'],
    [{ purpose_of_visit: 'Work without a work permit as a guest speaker' }, '478'],
    [{ purpose_of_visit: 'Provide care to my critically ill mother' }, '674'],
    [{ purpose_of_visit: 'Be with my critically ill father' }, '673'],
    [{ purpose_of_visit: 'Join my ship as marine crew in Halifax' }, '676'],
    [{ purpose_of_visit: 'Diplomatic visit to the high commission' }, '677'],
    [{ purpose_of_visit: 'Accompany my husband as the family member of a diplomat' }, '678'],
    [{ purpose_of_visit: 'Family of a victim of flight PS752' }, '690'],
  ])('%j → %s', (p, code) => {
    expect(purposeOf(p)).toBe(`#visaPurpose_radio-button-${code}-input`);
  });

  it('study longer than 6 months is not 477 (it needs a study permit)', () => {
    expect(
      purposeOf({
        purpose_of_visit: 'English language course',
        planned_entry_date: '2027-01-05',
        planned_departure_date: '2027-09-30',
      }),
    ).toBeUndefined();
  });

  it('"I will study the culture" is not a study purpose', () => {
    expect(purposeOf({ purpose_of_visit: 'I will study the culture' })).toBeUndefined();
  });

  it('"public transit" alone is not a transit application', () => {
    const p = { purpose_of_visit: 'Visit Niagara by public transit, sightseeing' };
    expect(targets(p, '/purpose')[0]).toBe('#applyingFor_radio-button-464-input');
    expect(noteOf(p, '/purpose', 'Transit')).toBeUndefined();
  });

  it.each([
    'Transit visa for a connecting flight to Chicago',
    'Layover in Vancouver on the way to Seattle',
    'Passing through Canada to the United States',
    'Transit via Toronto to Mexico City',
  ])('"%s" is transit', (purpose) => {
    expect(targets({ purpose_of_visit: purpose }, '/purpose')).toEqual([]);
  });

  it('"work" alone is not guessed as work without a permit', () => {
    expect(purposeOf({ purpose_of_visit: 'work in Toronto' })).toBeUndefined();
  });

  it('an unclear purpose is not answered "not sure" (479)', () => {
    expect(purposeOf({ purpose_of_visit: 'not sure yet' })).toBeUndefined();
  });

  it('transit: nothing is written on /purpose, and the note says why', () => {
    const p = { purpose_of_visit: 'Transit through Toronto to Mexico City' };
    expect(targets(p, '/purpose')).toEqual([]);
    expect(noteOf(p, '/purpose', 'Transit')).toMatch(
      /choose "Transit" under "I want to apply for" yourself/,
    );
  });

  it('a visitor still gets 464 and the purpose details', () => {
    const t = targets({}, '/purpose');
    expect(t[0]).toBe('#applyingFor_radio-button-464-input');
    expect(t).toContain('#visaPurpose_radio-button-470-input');
    expect(t).toContain('#visitDetails_txtArea');
    expect(noteOf({}, '/purpose', 'Transit')).toBeUndefined();
  });
});

// ── 4. travel document that is not a passport (A 25) ────────────────────────
describe('travel document "Other": 249 Passport is not written', () => {
  const REFUGEE = {
    passport_type: 'Refugee travel document',
    passport_number: 'RT0098765',
    passport_issue_date: '2024-02-01',
    passport_expiry_date: '2029-01-31',
  };

  it.each([
    'Refugee travel document',
    'Travel document for stateless persons',
    'Certificate of identity',
    'Other travel document',
  ])('"%s": no passport writes on /bio-data-travel-docs', (kind) => {
    const t = targets({ ...REFUGEE, passport_type: kind }, '/bio-data-travel-docs');
    expect(t).not.toContain('#travelDocument_radio-button-249-input');
    expect(t).not.toContain('#travelDocNum_input');
  });

  it('the note gives the document values, and the passport-kind note is not shown', () => {
    const l = left(REFUGEE, '/bio-data-travel-docs');
    const note = l.find((x) => x.label === 'Travel document')?.note;
    expect(note).toBe(
      'The assistant chose "Other" as the type of travel document and "Refugee Travel Document". Choose the country or authority that issued it yourself. Enter the document\'s details yourself: its number RT0098765, issued 2024-02-01, expires 2029-01-31.',
    );
    const stateless = left({ ...REFUGEE, passport_type: 'Travel document for stateless persons' }, '/bio-data-travel-docs')
      .find((x) => x.label === 'Travel document')?.note;
    expect(stateless).toBe(
      'Your travel document is recorded as "Travel document for stateless persons", not a passport: choose "Other" as the type of travel document yourself, then enter what document it is and who issued it, and its number RT0098765, issued 2024-02-01, expires 2029-01-31.',
    );
    expect(l.filter((x) => x.label === 'Travel document')).toHaveLength(1);
  });

  it('the same under travel_document_type', () => {
    const t = targets(
      { travel_document_type: 'Refugee travel document', passport_type: undefined },
      '/bio-data-travel-docs',
    );
    expect(t).not.toContain('#travelDocument_radio-button-249-input');
  });

  it.each(['Regular', 'Passport', 'Ordinary passport', "Alien's passport", 'Diplomatic passport'])(
    '"%s" is still a passport (249)',
    (kind) => {
      expect(targets({ passport_type: kind }, '/bio-data-travel-docs')).toContain(
        '#travelDocument_radio-button-249-input',
      );
    },
  );
});
