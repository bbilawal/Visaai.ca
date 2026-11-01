/**
 * Live E2E 2026-10-19: IRCC asked travel history, date of marriage, each
 * child's country of birth, biometrics, travel by air, a Canadian visa in the
 * past 10 years and a 10-year work history, and the portal assistant had
 * nothing — the interview never asked. The interview now asks each under the
 * key the portal mapping reads; these check that the answers, recorded the
 * way the interview's extractor is told to record them, reach the portal.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import { intakeFactSpecs, type PrefilledFormField } from '@visaai/types';
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

const trv = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };

const BASE: Record<string, unknown> = {
  given_name: 'Muzaffar',
  family_name: 'Ahmad',
  date_of_birth: '1958-03-09',
  nationality: 'PAK',
  purpose_of_visit: 'family visit',
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2027-04-30',
};

/** The profile as the portal derivation sees it with no Forms page yet. */
const values = (p: Record<string, unknown>) =>
  applyPrefillOverrides(trv(), { ...BASE, ...p }, []);
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), values(p));

describe('IRCC portal reads the new interview answers', () => {
  it('every new question is asked under a key the portal mapping reads', () => {
    const keys = new Set(trv().map((f) => f.profileKey));
    for (const k of [
      'travelled_last_5_years',
      'marriage_date',
      'held_canadian_visa_10_years',
      'biometrics_given',
    ]) {
      expect(keys).toContain(k);
      expect(intakeFactSpecs(TRV).map((s) => s.key)).toContain(k);
    }
  });

  it('trips recorded as the interview shape become travel-history rows', () => {
    const p = {
      travelled_last_5_years: true,
      travel_history: [
        { country: 'United Arab Emirates', city: 'Dubai', from: '2023-01', to: '2023-02', purpose: 'Tourism' },
      ],
    };
    const inputs = mapped(p);
    expect(
      inputs.find((x) => x.fieldKey === 'travelled_last_5_years')?.mappedValue,
    ).toBe('Yes');
    expect(
      inputs.find((x) => x.targetField === '#travelHistoryLocation_input')?.mappedValue,
    ).toBe('Dubai');
  });

  it('a trip recorded by country only is located in that country (live E2E 2026-10-19)', () => {
    const inputs = mapped({
      travelled_last_5_years: true,
      travel_history: [
        { country: 'Thailand', from: '2022-05', to: '2022-05', purpose: 'tourism' },
      ],
    });
    expect(
      inputs.find((x) => x.fieldKey === 'travelled_last_5_years')?.mappedValue,
    ).toBe('Yes');
    expect(
      inputs.find((x) => x.targetField === '#travelHistoryLocation_input')?.mappedValue,
    ).toBe('Thailand');
  });

  it('a ninth trip is written, not left for the applicant (live E2E 2026-10-19)', () => {
    const trips = Array.from({ length: 12 }, (_, i) => ({
      country: 'Thailand',
      from: `20${14 + i}-05`,
      to: `20${14 + i}-06`,
      purpose: 'tourism',
    }));
    const inputs = mapped({ travelled_last_5_years: true, travel_history: trips });
    const locations = inputs.filter(
      (x) => x.targetField === '#travelHistoryLocation_input' && x.mappedValue,
    );
    expect(locations).toHaveLength(12);
  });

  it('trips past the 20th are left for the applicant, by name', () => {
    const trips = Array.from({ length: 21 }, (_, i) => ({
      country: 'Thailand',
      from: `${2000 + i}-05`,
      to: `${2000 + i}-06`,
      purpose: 'tourism',
    }));
    const p = { travelled_last_5_years: true, travel_history: trips };
    const inputs = mapped(p);
    expect(inputs.some((x) => x.fieldKey === 'ircc_trip_20_location')).toBe(true);
    expect(inputs.some((x) => x.fieldKey.startsWith('ircc_trip_21_'))).toBe(false);
    const left = portalFillCoverage(trv(), { ...BASE, ...p })
      .pages.find((x) => x.page === '/travel-history')
      ?.left.filter((l) => /^Trip \d+$/.test(l.label));
    expect(left).toEqual([
      expect.objectContaining({
        label: 'Trip 21',
        note: 'The assistant adds up to 20 trips; add this one yourself.',
      }),
    ]);
  });

  it('two trips to one country in the same month are one IRCC row, as IRCC asks', () => {
    const inputs = mapped({
      travelled_last_5_years: true,
      travel_history: [
        { country: 'United Arab Emirates', city: 'Dubai', from: '2023-05', to: '2023-05', purpose: 'tourism' },
        { country: 'Oman', from: '2023-05', to: '2023-05', purpose: 'tourism' },
        { country: 'United Arab Emirates', city: 'Abu Dhabi', from: '2023-05', to: '2023-05', purpose: 'business' },
      ],
    });
    const rows = inputs.filter((x) => x.op === 'dialog_open' && /^ircc_trip_/.test(x.fieldKey));
    expect(rows.map((x) => x.mappedValue)).toEqual([
      'United Arab Emirates 2023-05 to 2023-05',
      'Oman 2023-05 to 2023-05',
    ]);
    const v = (k: string) => inputs.find((x) => x.fieldKey === k)?.mappedValue;
    expect(v('ircc_trip_1_location')).toBe('Dubai; Abu Dhabi');
    expect(v('ircc_trip_1_purpose')).toBe('tourism; business');
    expect(inputs.some((x) => x.fieldKey.startsWith('ircc_trip_3_'))).toBe(false);
  });

  it('a repeat past the cap is not left for the applicant as a second row', () => {
    const others = Array.from({ length: 20 }, (_, i) => ({
      country: 'Thailand',
      from: `${2000 + i}-05`,
      to: `${2000 + i}-06`,
      purpose: 'tourism',
    }));
    const p = {
      travelled_last_5_years: true,
      travel_history: [
        { country: 'United Arab Emirates', city: 'Dubai', from: '2023-05', to: '2023-05', purpose: 'Tourism' },
        ...others,
        // Index 21: past the cap. Its place joins row 1; no note of its own.
        { country: 'United Arab Emirates', city: 'Abu Dhabi', from: '2023-05', to: '2023-05', purpose: 'tourism ' },
        // An incomplete repeat lends its place and adds no note either.
        { country: 'United Arab Emirates', city: 'Sharjah', from: '2023-05', to: '2023-05' },
      ],
    };
    const inputs = mapped(p);
    const v = (k: string) => inputs.find((x) => x.fieldKey === k)?.mappedValue;
    expect(v('ircc_trip_1_location')).toBe('Dubai; Abu Dhabi; Sharjah');
    expect(v('ircc_trip_1_purpose')).toBe('Tourism');
    const left = portalFillCoverage(trv(), { ...BASE, ...p })
      .pages.find((x) => x.page === '/travel-history')
      ?.left.filter((l) => /^Trip \d+$/.test(l.label))
      .map((l) => l.label);
    // Only Thailand trip 21 (index 20) is past the cap; the repeats are on
    // row 1 and never listed.
    expect(left).toEqual(['Trip 21']);
  });

  it("joined places and purposes stay within IRCC's 50 and 100 characters", () => {
    const forty = 'A place name that is exactly forty chars';
    expect(forty).toHaveLength(40);
    const p = {
      travelled_last_5_years: true,
      travel_history: [
        { country: 'Turkey', city: 'Istanbul', from: '2022-08', to: '2022-08', purpose: 'tourism' },
        { country: 'Turkey', city: forty, from: '2022-08', to: '2022-08', purpose: 'tourism' },
        // Would make the place 55 characters: skipped, a later short one still fits.
        { country: 'Turkey', city: 'Antalya', from: '2022-08', to: '2022-08', purpose: 'p'.repeat(95) },
      ],
    };
    const inputs = mapped(p);
    const v = (k: string) => inputs.find((x) => x.fieldKey === k)?.mappedValue;
    expect(v('ircc_trip_1_location')).toBe(`Istanbul; ${forty}`);
    expect(v('ircc_trip_1_purpose')).toBe('tourism');
    const note = portalFillCoverage(trv(), { ...BASE, ...p })
      .pages.find((x) => x.page === '/travel-history')
      ?.left.find((l) => l.label === 'Trip 1');
    expect(note?.reason).toBe('fill_yourself');
    expect(note?.note).toMatch(/not entered: place "Antalya", purpose "p{95}"/);
  });

  it('a place IRCC would refuse falls back to the country; the trip is still written', () => {
    const p = {
      travelled_last_5_years: true,
      travel_history: [
        { country: 'Oman', city: 'x'.repeat(60), from: '2022-09', to: '2022-09', purpose: 'Business/Tourism – Muscat' },
        { country: 'Saudi Arabia', city: 'مكة', from: '2026-01', to: '2026-01', purpose: 'Umrah' },
      ],
    };
    const inputs = mapped(p);
    const v = (k: string) => inputs.find((x) => x.fieldKey === k)?.mappedValue;
    expect(v('ircc_trip_1_location')).toBe('Oman');
    // "/" is outside IRCC's pattern; written as a comma.
    expect(v('ircc_trip_1_purpose')).toBe('Business, Tourism - Muscat');
    expect(v('ircc_trip_2_location')).toBe('Saudi Arabia');
    const left = portalFillCoverage(trv(), { ...BASE, ...p })
      .pages.find((x) => x.page === '/travel-history')
      ?.left.filter((l) => /^Trip \d+$/.test(l.label));
    expect(left?.map((l) => l.label)).toEqual(['Trip 1', 'Trip 2']);
    expect(left?.[1].note).toMatch(/not entered: place "مكة"/);
  });

  it('a purpose IRCC would refuse leaves the trip for the applicant, saying why', () => {
    const p = {
      travelled_last_5_years: true,
      travel_history: [
        { country: 'Oman', city: 'Muscat', from: '2022-09', to: '2022-09', purpose: 'q'.repeat(101) },
      ],
    };
    expect(mapped(p).some((x) => x.fieldKey.startsWith('ircc_trip_1_'))).toBe(false);
    const note = portalFillCoverage(trv(), { ...BASE, ...p })
      .pages.find((x) => x.page === '/travel-history')
      ?.left.find((l) => l.label === 'Trip 1');
    expect(note?.note).toMatch(/missing: purpose\. .*not entered: purpose "q{101}"/);
  });

  it('the date of marriage fills dateOfDating', () => {
    const inputs = mapped({ marital_status: 'Married', marriage_date: '1990-05-12' });
    expect(
      inputs.find((x) => x.targetField === '#dateOfDatingYear_sltDateYear')?.mappedValue,
    ).toBe('1990');
  });

  it("each child's country of birth reaches the child row without a Forms page", () => {
    const kid = {
      name: 'Ali Ahmad',
      relationship: 'son',
      date_of_birth: '1995-01-01',
      same_address: 'Yes',
      coming_to_canada: 'No',
    };
    const inputs = mapped({
      has_children: true,
      children: [kid],
      children_countries_of_birth: 'Ali Ahmad: Pakistan',
    });
    expect(inputs.some((x) => /countryOfBirthChild/.test(x.targetField))).toBe(true);
  });

  it('biometrics given in the past 10 years are re-used while they cover the trip', () => {
    const v = values({ biometrics_given: true, biometrics_enrollment_date: '2019-03' });
    expect(v.biometrics_valid_until).toBe('2029-03-01');
    const reuse = (q: Record<string, unknown>) =>
      buildMappingInputs(trv(), q).find((x) => x.fieldKey === 'biometrics_reuse');
    expect(reuse(v)?.targetField).toBe('#biometricsAgain_radio-button-3005-input');
    // Expired before the trip: given again, not re-used.
    const old = values({ biometrics_given: true, biometrics_enrollment_date: '2016-01-15' });
    expect(reuse(old)?.targetField).toBe('#biometricsAgain_radio-button-3004-input');
  });

  it('biometrics given more than 10 years ago are not "given in the last 10 years"', () => {
    const v = values({ biometrics_enrollment_date: '2012-05-01' });
    expect(v.biometrics_given).toBe('No');
    expect(
      buildMappingInputs(trv(), v).find((x) => x.fieldKey === 'biometrics_given')?.mappedValue,
    ).toBe('No');
    // An explicit answer is never overridden.
    expect(values({ biometrics_given: true, biometrics_enrollment_date: '2012-05-01' }).biometrics_given).toBe(true);
  });

  it('travel by air and a Canadian visa in the past 10 years are written', () => {
    const inputs = mapped({ travel_by_air: true, held_canadian_visa_10_years: false });
    expect(inputs.find((x) => x.fieldKey === 'travelling_by_air')?.mappedValue).toBe('Yes');
    expect(
      inputs.find((x) => x.fieldKey === 'held_canadian_visa_10_years')?.mappedValue,
    ).toBe('No');
  });
});

describe('earlier jobs and trips on the Forms page', () => {
  const ctx = (profile: Record<string, unknown>): FinalizeContext => ({
    applicantName: 'MUZAFFAR AHMAD',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: TRV,
  });

  it('"No" to travel in the past 5 years renders the travel history as None', () => {
    const out = finalizeFields(
      [{ key: 'travel_history', label: 'Travel history', value: '', source: 'inferred' } as PrefilledFormField],
      ctx({ ...BASE, travelled_last_5_years: false }),
    );
    expect(out.find((x) => x.key === 'travel_history')?.value).toBe('None');
  });

  it('carries the work history as one line per period', () => {
    const out: PrefilledFormField[] = finalizeFields(
      [],
      ctx({
        ...BASE,
        work_history: [
          { from: '2012-01', to: '2020-06', activity: 'Clerk', employer: 'HBL', city: 'Lahore', country: 'Pakistan' },
        ],
      }),
    );
    const f = out.find((x) => x.key === 'work_history');
    expect(f?.group).toBe('Employment');
    expect(f?.value).toBe(
      'from: 2012-01; to: 2020-06; activity: Clerk; employer: HBL; city: Lahore; country: Pakistan',
    );
  });
});
