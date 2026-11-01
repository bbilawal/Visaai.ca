/**
 * Live probe 2026-10-31 (draft, purpose 686): applicants aged 15 and 17 skip
 * /travel-history, /validity-status, /crime-activity and
 * /security-questions, and /activities shows only hasPostSecondaryEducation.
 * /biometrics is shown at 15 and 17 (not at 4 or 12). /minors-guardian is
 * shown at 15, not at 17; "No" then Alone / With someone else goes straight
 * to /inviter-info (no custodian page). Names are invented.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';

const trv = () => resolvePortalFill('ircc')!;
const DAY = 24 * 60 * 60 * 1000;
const born = (years: number, days = -10) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
};

const BASE: Record<string, unknown> = {
  given_name: 'Hamid',
  family_name: 'Sarwari',
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  residential_address: { street: '3 Garden Town', city: 'Lahore', country: 'Pakistan' },
  passport_number: 'WE1122334',
  purpose_of_visit: 'visit parent',
  biometrics_given: 'no',
  military_service: 'no',
  occupation: 'None',
  is_employed: 'no',
  has_post_secondary_education: 'no',
  travelled_last_5_years: 'no',
  immigration_violations: 'no',
  ever_convicted: 'no',
  violent_organization_member: 'no',
  minor_travelling_with_guardian: 'no',
  minor_travelling_without_guardian: 'alone',
};
const MINOR_HIDDEN = ['/travel-history', '/validity-status', '/crime-activity', '/security-questions'];

const at = (age: number, days = -10) => {
  const p = { ...BASE, date_of_birth: born(age, days) };
  const m = buildMappingInputs(trv(), p);
  const on = (page: string) => m.filter((x) => x.page === page).map((x) => x.targetField);
  const left = (page: string) =>
    portalFillCoverage(trv(), p).pages.find((x) => x.page === page)?.left ?? [];
  return { on, left };
};

describe.each([15, 16, 17])('an applicant aged %i', (age) => {
  const r = at(age);
  it('nothing on travel history, validity, crime or security', () => {
    for (const page of MINOR_HIDDEN) {
      expect(r.on(page)).toEqual([]);
      expect(r.left(page)).toEqual([]);
    }
  });
  it('/activities: only the education question, no military or work rows', () => {
    expect(r.on('/activities')).toEqual(['#hasPostSecondaryEducation_radio-button-02-input']);
    expect(
      r.left('/activities').some((l) => /military|job|work|Unemployed|Homemaker/i.test(l.label)),
    ).toBe(false);
  });
  it('biometrics is written', () => {
    expect(r.on('/biometrics').length).toBeGreaterThan(0);
  });
  it(`/minors-guardian written: ${age <= 16}`, () => {
    expect(r.on('/minors-guardian').length > 0).toBe(age <= 16);
    expect(r.left('/minors-guardian').some((l) => /custodian/i.test(`${l.label} ${l.note ?? ''}`))).toBe(false);
  });
});

describe('the gates', () => {
  it('a child of 12: biometrics not written either', () => {
    expect(at(12).on('/biometrics')).toEqual([]);
  });

  it('18, or turning 18 tomorrow (the browser may already say 18): every page as before', () => {
    for (const r of [at(18), at(18, 1)]) {
      expect(r.on('/activities')).toContain('#servedArmy_radio-button-02-input');
      expect(r.on('/travel-history').length).toBeGreaterThan(0);
      expect(r.on('/crime-activity').length).toBeGreaterThan(0);
      expect(r.on('/biometrics').length).toBeGreaterThan(0);
      expect(r.on('/minors-guardian')).toEqual([]);
    }
  });
});
