/**
 * tr-rt wave 3c (live probe 2026-10-31, child applicant born 2022-03-10):
 * /minors-guardian for a child 16 or under, the 2-year TB chain for a child
 * surely 5 or under, and the pages a child under 14 never sees. Only ids
 * recorded live are written; a missing control would halt the run. Names
 * are invented.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import '../src/modules/automation/portal-fills/canada-ircc-business-visitor';
import '../src/modules/automation/portal-fills/canada-ircc-super-visa';
import { missingIntakeFacts } from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { selectPageGroups } from '../src/modules/portal-fill/page-groups';
import {
  resolvePortalFill,
  resolvePortalFillFor,
} from '../src/strategies/portal-integration/portal-fill.registry';
import {
  finalizeFields,
  type FinalizeContext,
} from '../src/modules/prefill/graphs/nodes/finalize-fields';
import type { SignedWriteIntent } from '@visaai/types';

const trv = () => resolvePortalFill('ircc')!;
const TRV = { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' };
const DAY = 24 * 60 * 60 * 1000;

/** Born `years` ago, shifted by `days` (positive = later birthday). */
const born = (years: number, days = -10) => {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() - years);
  return new Date(d.getTime() + days * DAY).toISOString().slice(0, 10);
};

const BASE: Record<string, unknown> = {
  given_name: 'Zarina',
  family_name: 'Toorabi',
  date_of_birth: born(4),
  nationality: 'PAK',
  country_of_residence: 'Pakistan',
  residential_address: { street: '7 Canal View', city: 'Multan', country: 'Pakistan' },
  passport_number: 'QX7654321',
  purpose_of_visit: 'visit parent',
};

const all = (p: Record<string, unknown>) => buildMappingInputs(trv(), { ...BASE, ...p });
const on = (p: Record<string, unknown>, page: string) =>
  all(p).filter((x) => x.page === page);
const targets = (p: Record<string, unknown>, page: string) =>
  on(p, page).map((x) => x.targetField);
const coverage = (p: Record<string, unknown>) =>
  portalFillCoverage(trv(), { ...BASE, ...p }).pages;
const left = (p: Record<string, unknown>, page: string) =>
  coverage(p).find((x) => x.page === page)?.left ?? [];
const notes = (p: Record<string, unknown>, page: string) =>
  left(p, page)
    .map((l) => `${l.label}: ${l.note ?? ''}`)
    .join(' | ');
const missingKeys = (p: Record<string, unknown>) =>
  missingIntakeFacts({ ...BASE, ...p }, TRV).map((s) => s.key);

const ADULT = { date_of_birth: '1980-05-05' };

// ── 1. /minors-guardian ────────────────────────────────────────────────────
describe('/minors-guardian: a child 16 or under', () => {
  it('the intake asks a child 16 or under, never an adult or an unknown age', () => {
    expect(missingKeys({})).toContain('minor_travelling_with_guardian');
    expect(missingKeys({ date_of_birth: born(16) })).toContain('minor_travelling_with_guardian');
    expect(missingKeys({ date_of_birth: born(17) })).not.toContain('minor_travelling_with_guardian');
    expect(missingKeys(ADULT)).not.toContain('minor_travelling_with_guardian');
    expect(missingKeys({ date_of_birth: undefined })).not.toContain('minor_travelling_with_guardian');
  });

  it('birth year alone: asked only when surely 16 or under', () => {
    const y = new Date().getUTCFullYear();
    expect(missingKeys({ date_of_birth: undefined, birth_year: y - 16 })).toContain(
      'minor_travelling_with_guardian',
    );
    expect(missingKeys({ date_of_birth: undefined, birth_year: y - 17 })).not.toContain(
      'minor_travelling_with_guardian',
    );
  });

  it('Yes asks both-or-one; No asks alone-or-someone-else', () => {
    const yes = missingKeys({ minor_travelling_with_guardian: 'yes' });
    expect(yes).toContain('minor_guardians_travelling');
    expect(yes).not.toContain('minor_travelling_without_guardian');
    const no = missingKeys({ minor_travelling_with_guardian: 'no' });
    expect(no).toContain('minor_travelling_without_guardian');
    expect(no).not.toContain('minor_guardians_travelling');
    expect(missingKeys({})).not.toContain('minor_travelling_without_guardian');
  });

  it('Yes + one parent writes 01 then 531', () => {
    expect(
      targets(
        { minor_travelling_with_guardian: 'yes', minor_guardians_travelling: 'one parent' },
        '/minors-guardian',
      ),
    ).toEqual([
      '#isTravelingGuardian_radio-button-01-input',
      '#minorsTravellingwithGuardian_radio-button-531-input',
    ]);
    expect(
      targets(
        { minor_travelling_with_guardian: 'yes', minor_guardians_travelling: 'Both' },
        '/minors-guardian',
      ),
    ).toContain('#minorsTravellingwithGuardian_radio-button-530-input');
  });

  it('No + alone / with someone else writes 02 then 532 / 533; no custodian note (live: none follows)', () => {
    const alone = { minor_travelling_with_guardian: 'no', minor_travelling_without_guardian: 'alone' };
    expect(targets(alone, '/minors-guardian')).toEqual([
      '#isTravelingGuardian_radio-button-02-input',
      '#minorsTravellingwithoutGuardian_radio-button-532-input',
    ]);
    expect(
      targets(
        { minor_travelling_with_guardian: 'no', minor_travelling_without_guardian: 'With someone else' },
        '/minors-guardian',
      ),
    ).toContain('#minorsTravellingwithoutGuardian_radio-button-533-input');
    expect(notes(alone, '/minors-guardian')).not.toMatch(/custodian/i);
    expect(
      notes({ minor_travelling_with_guardian: 'yes', minor_guardians_travelling: 'one' }, '/minors-guardian'),
    ).not.toMatch(/Custodian/);
  });

  it('nothing is guessed: no answer, an unclear answer, an adult, or no date of birth', () => {
    expect(targets({}, '/minors-guardian')).toEqual([]);
    expect(
      targets(
        { minor_travelling_with_guardian: 'yes', minor_guardians_travelling: 'not sure' },
        '/minors-guardian',
      ),
    ).toEqual(['#isTravelingGuardian_radio-button-01-input']);
    expect(targets({ ...ADULT, minor_travelling_with_guardian: 'yes' }, '/minors-guardian')).toEqual([]);
    expect(
      targets({ date_of_birth: undefined, minor_travelling_with_guardian: 'yes' }, '/minors-guardian'),
    ).toEqual([]);
    expect(left({}, '/minors-guardian').map((l) => l.label)).toContain(
      'The child travels to Canada with a parent or legal guardian',
    );
    expect(left(ADULT, '/minors-guardian')).toEqual([]);
  });

  it("PR #259's under-18 note: now only for a 17-year-old", () => {
    const n = (dob: string) => left({ date_of_birth: dob }, '/bio-data').map((l) => l.label);
    expect(n(born(17))).toContain('Applicant under 18');
    expect(n(born(16))).not.toContain('Applicant under 18');
    expect(n(born(4))).not.toContain('Applicant under 18');
  });

  it('business visitor and super visa carry the same page', () => {
    for (const id of ['ca-business-visitors', 'ca-super-visa']) {
      const m = resolvePortalFillFor('ircc', id)!;
      expect(m).not.toBe(trv());
      const t = buildMappingInputs(m, {
        ...BASE,
        minor_travelling_with_guardian: 'yes',
        minor_guardians_travelling: 'both',
      }).map((x) => x.targetField);
      expect(t).toContain('#minorsTravellingwithGuardian_radio-button-530-input');
    }
  });
});

describe('Forms step 13: the /minors-guardian questions', () => {
  const ctx = (profile: Record<string, unknown>): FinalizeContext => ({
    applicantName: 'ZARINA TOORABI',
    profile,
    documentFields: {},
    documentFieldsByType: {},
    otherPartyDocuments: [],
    accountProfile: {},
    route: TRV,
  });
  const keys = (p: Record<string, unknown>) =>
    finalizeFields([], ctx({ ...BASE, ...p })).map((f) => f.key);

  it('asked of a child 16 or under only', () => {
    expect(keys({})).toContain('minor_travelling_with_guardian');
    expect(keys(ADULT)).not.toContain('minor_travelling_with_guardian');
    expect(keys({ date_of_birth: undefined })).not.toContain('minor_travelling_with_guardian');
  });

  it('the follow-up matches the answer', () => {
    expect(keys({ minor_travelling_with_guardian: 'Yes' })).toContain('minor_guardians_travelling');
    expect(keys({ minor_travelling_with_guardian: 'No' })).toContain(
      'minor_travelling_without_guardian',
    );
    expect(keys({})).not.toContain('minor_guardians_travelling');
  });
});

// ── 2. TB, child surely 5 or under ─────────────────────────────────────────
describe('TB: the 2-year chain of a child surely 5 or under', () => {
  const tb = (p: Record<string, unknown>) => targets(p, '/medical-tuberculosis');

  it('writes the chain from explicit answers, stopping at the first No', () => {
    expect(
      tb({
        tuberculosis: 'no',
        tuberculosis_contact_two_years: 'yes',
        tuberculosis_tested_two_years: 'yes',
        tuberculosis_test_positive_two_years: 'no',
        tuberculosis_positive_treated_two_years: 'yes',
      }),
    ).toEqual([
      '#hasTuberculosis_radio-button-02-input',
      '#contactTwoYears_radio-button-01-input',
      '#hasTestTwoYears_radio-button-01-input',
      '#twoYearsPostive_radio-button-02-input',
    ]);
    expect(tb({ tuberculosis_contact_two_years: 'no', tuberculosis_tested_two_years: 'yes' })).toEqual([
      '#contactTwoYears_radio-button-02-input',
    ]);
  });

  it('the full Yes chain reaches twoYearsTreatment', () => {
    expect(
      tb({
        tuberculosis_contact_two_years: 'yes',
        tuberculosis_tested_two_years: 'yes',
        tuberculosis_test_positive_two_years: 'yes',
        tuberculosis_positive_treated_two_years: 'yes',
      }),
    ).toContain('#twoYearsTreatment_radio-button-01-input');
  });

  it('never writes a 5-year question, even when answered', () => {
    const t = tb({
      tuberculosis_contact: 'yes',
      tuberculosis_tested: 'yes',
      tuberculosis_contact_two_years: 'no',
    });
    expect(t.some((x) => /FiveYears|fiveYears/.test(x))).toBe(false);
  });

  it('an unanswered 2-year question is not guessed; it is listed as needing an answer', () => {
    expect(tb({}).some((x) => /TwoYears|twoYears/.test(x))).toBe(false);
    const l = left({}, '/medical-tuberculosis');
    expect(l.find((x) => /last 2 years/.test(x.label))?.reason).toBe('needs_your_answer');
    // The near-6th-birthday explanation is not shown to a child surely 5 or under.
    expect(l.map((x) => x.label)).not.toContain('Close contact with a person with tuberculosis');
  });

  it('near the 6th birthday nothing of either chain is written; the note stays', () => {
    const p = {
      date_of_birth: born(6, 0),
      tuberculosis_contact: 'no',
      tuberculosis_contact_two_years: 'no',
    };
    expect(tb(p).some((x) => /TwoYears|FiveYears/.test(x))).toBe(false);
    expect(notes(p, '/medical-tuberculosis')).toMatch(/last 2 years: No/);
  });

  it('a birth year 6 years ago is unsure: left; 5 years ago is sure: written', () => {
    const y = new Date().getUTCFullYear();
    const p = { date_of_birth: undefined, tuberculosis_contact_two_years: 'no' };
    expect(tb({ ...p, birth_year: y - 6 })).not.toContain('#contactTwoYears_radio-button-02-input');
    expect(tb({ ...p, birth_year: y - 5 })).toContain('#contactTwoYears_radio-button-02-input');
  });

  it('an adult is unchanged: 5-year question only', () => {
    const t = tb({ ...ADULT, tuberculosis_contact: 'no', tuberculosis_contact_two_years: 'no' });
    expect(t).toContain('#contactFiveYears_radio-button-02-input');
    expect(t.some((x) => /TwoYears/.test(x))).toBe(false);
  });
});

// ── 3. a child under 14: pages IRCC does not show ──────────────────────────
describe('a child under 14', () => {
  const CHILD_ANSWERS = {
    biometrics_given: 'no',
    military_service: 'no',
    occupation: 'None',
    is_employed: 'no',
    has_post_secondary_education: 'no',
    travelled_last_5_years: 'no',
    ever_convicted: 'no',
    violent_organization_member: 'no',
    immigration_violations: 'no',
  };
  const HIDDEN = [
    '/biometrics',
    '/travel-history',
    '/validity-status',
    '/crime-activity',
    '/security-questions',
  ];

  it('writes nothing to the pages a child never sees, and only education on /activities', () => {
    for (const page of HIDDEN) expect(on(CHILD_ANSWERS, page)).toEqual([]);
    expect(targets(CHILD_ANSWERS, '/activities')).toEqual([
      '#hasPostSecondaryEducation_radio-button-02-input',
    ]);
  });

  it('the run on /activities is not refused for a missing servedArmy or work table', () => {
    const intents = on(CHILD_ANSWERS, '/activities').map(
      (m) =>
        ({
          selector: m.targetField,
          page: m.page,
          fieldKey: m.fieldKey,
        }) as unknown as SignedWriteIntent,
    );
    // The live child page has only hasPostSecondaryEducation.
    const probe = intents.map((i) => ({
      selector: i.selector,
      found: i.selector.startsWith('#hasPostSecondaryEducation'),
    }));
    expect(selectPageGroups(intents, probe, '/en/activities').ok).toBe(true);
  });

  it('pages not reached are skipped: only the current page group runs', () => {
    const intents = all({ ...CHILD_ANSWERS, tuberculosis: 'no', date_of_birth: born(15) }).map(
      (m) =>
        ({ selector: m.targetField, page: m.page, fieldKey: m.fieldKey }) as unknown as SignedWriteIntent,
    );
    const onPage = intents.filter((i) => i.page === '/medical-tuberculosis');
    const sel = selectPageGroups(
      intents,
      onPage.map((i) => ({ selector: i.selector, found: true })),
      '/en/medical-tuberculosis',
    );
    expect(sel.ok && sel.intents.every((i) => i.page === '/medical-tuberculosis')).toBe(true);
  });

  it('no note sends the parent to a page IRCC will not show', () => {
    const pages = coverage({});
    for (const page of HIDDEN)
      expect(pages.find((x) => x.page === page)?.left ?? []).toEqual([]);
    const act = left({}, '/activities').map((l) => l.label);
    expect(act.some((l) => /military|job|work|Unemployed|Homemaker|Retire/i.test(l))).toBe(false);
  });

  it('an 18-year-old and an applicant of unknown age keep every page', () => {
    for (const p of [{ date_of_birth: born(18) }, { date_of_birth: undefined }]) {
      const t = all({ ...CHILD_ANSWERS, ...p }).map((x) => x.targetField);
      expect(t).toContain('#servedArmy_radio-button-02-input');
      expect(left(p, '/crime-activity').length).toBeGreaterThan(0);
    }
  });
});
