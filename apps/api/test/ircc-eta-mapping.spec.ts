/**
 * The IRCC eTA online form, from the selectors recorded live on 2026-10-16
 * (eta.onlineservices-servicesenligne.apps.cic.gc.ca/eta/welcome#/application).
 * One page whose path never changes; every question is a <select> chosen by
 * option text; ids contain dots.
 */
import '../src/modules/automation/portal-fills/canada-ircc'; // registers 'ircc'
import '../src/modules/automation/portal-fills/canada-ircc-eta'; // registers 'ircc-eta'
import type { PreflightMappingInput } from '@visaai/types';
import {
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import {
  isProgressivePage,
  portalPageOrder,
  portalPageTitle,
  resolvePortalFill,
  resolvePortalFillExtras,
} from '../src/strategies/portal-integration/portal-fill.registry';
import { ETA_PAGE } from '../src/modules/automation/portal-fills/canada-ircc-eta';

const mapping = () => resolvePortalFill('ircc-eta')!;
const id = (suffix: string) => `[id="applicationDetails.${suffix}"]`;

/** A British citizen visiting Canada (the persona the form was recorded with). */
const UK: Record<string, unknown> = {
  is_representative: false,
  passport_type: 'ordinary',
  nationality: 'GBR',
  passport_number: '123456789',
  family_name: 'Smith',
  given_name: 'Jane Mary',
  date_of_birth: '1960-05-01',
  sex: 'F',
  place_of_birth: 'Leeds, England',
  passport_issue_date: '2022-03-04',
  passport_expiry_date: '2032-03-03',
  previously_applied_to_canada: 'No',
  preferred_language: 'English',
  email: 'jane@example.com',
  residential_address: {
    street: '12 Acacia Avenue',
    apartment: 'Flat 3',
    city: 'Leeds',
    country: 'England',
  },
  planned_entry_date: '2026-12-01',
  // Explicit answers to the background questions (IRCC tr-rt keys).
  previous_visa_refused: 'No',
  denied_entry: 'No',
  ordered_to_leave: 'No',
  committed_crime: 'No',
  ever_arrested: 'No',
  ever_charged: 'No',
  ever_convicted: 'No',
  tuberculosis: 'No',
  tuberculosis_contact: 'No',
  syphilis: 'No',
  addiction: 'No',
  mental_health_condition: 'No',
};

const writes = (p: Record<string, unknown>) => buildMappingInputs(mapping(), p);
const valueAt = (inputs: PreflightMappingInput[], selector: string) =>
  inputs.find((i) => i.targetField === selector)?.mappedValue;

describe("eTA portal mapping ('ircc-eta')", () => {
  it('is registered as one progressive page on the path the tab reports', () => {
    expect(ETA_PAGE).toBe('/eta/welcome');
    expect(portalPageTitle(ETA_PAGE)).toBe('eTA application');
    expect(portalPageOrder(ETA_PAGE)).toEqual([ETA_PAGE]);
    expect(isProgressivePage(ETA_PAGE)).toBe(true);
    // IRCC tr-rt pages are untouched: multi-page, not progressive.
    expect(isProgressivePage('/bio-data')).toBe(false);
    expect(portalPageOrder('/bio-data')).toContain('/purpose');
    expect(portalPageOrder('/bio-data')).not.toContain(ETA_PAGE);
    for (const m of mapping()) expect(m.page).toBe(ETA_PAGE);
  });

  it('no page key is shared between the two IRCC portals', () => {
    const eta = (resolvePortalFillExtras('ircc-eta').pages ?? []).map(
      (p) => p.page,
    );
    const trv = (resolvePortalFillExtras('ircc').pages ?? []).map(
      (p) => p.page,
    );
    expect(eta.filter((p) => trv.includes(p))).toEqual([]);
  });

  it('every selector names the id by attribute (ids contain dots)', () => {
    for (const m of mapping()) {
      expect(m.selector).toMatch(/^\[id="[A-Za-z0-9_.]+"\]$/);
      expect(m.selector).not.toMatch(/^#/);
    }
  });

  it('never maps the declaration checkbox or the signature', () => {
    for (const m of mapping()) {
      expect(m.selector).not.toMatch(/consentAndDeclaration/);
      expect(m.op).not.toBe('check');
    }
  });

  it('chooses every <select> by its option text', () => {
    for (const m of mapping())
      if (m.action === 'select') expect(m.op).toBe('select_text');
  });

  it('fills the recorded form for a British applicant, in form order', () => {
    const w = writes(UK);
    const expected: Array<[string, string]> = [
      ['[id="welcome_isRepresentative"]', 'No'],
      [id('prerequisite_travelDocumentType'), 'Passport - ordinary/regular'],
      [id('prerequisite_countryOfCitizenship'), 'GBR (UK - British citizen)'],
      [id('prerequisite_passportNotedNationality'), 'UK - British citizen'],
      [id('personalDetails_passportNumber'), '123456789'],
      [id('personalDetails_passportNumberReEnter'), '123456789'],
      [id('personalDetails_lastName'), 'Smith'],
      [id('personalDetails_firstName'), 'Jane Mary'],
      [id('personalDetails_dobYear'), '1960'],
      [id('personalDetails_dobMonth'), 'May'],
      [id('personalDetails_dobDay'), '01'],
      [id('personalDetails_gender'), 'Female'],
      [id('personalDetails_countryOfBirth'), 'England'],
      [id('personalDetails_cityTownOfBirth'), 'Leeds'],
      [id('personalDetails_issueDateYear'), '2022'],
      [id('personalDetails_issueDateMonth'), 'March'],
      [id('personalDetails_issueDateDay'), '04'],
      [id('personalDetails_expiryDateYear'), '2032'],
      [id('personalDetails_expiryDateMonth'), 'March'],
      [id('personalDetails_expiryDateDay'), '03'],
      [id('personalDetails_hasPreviouslyAppliedToCanada'), 'No'],
      [id('contactDetails_languageOfPreference'), 'English'],
      [id('contactDetails_emailAddress'), 'jane@example.com'],
      [id('contactDetails_emailAddressReEnter'), 'jane@example.com'],
      [id('contactDetails_aptUnit'), 'Flat 3'],
      [id('contactDetails_streetNo'), '12'],
      [id('contactDetails_streetAddress'), 'Acacia Avenue'],
      [id('contactDetails_city'), 'Leeds'],
      [id('contactDetails_country'), 'England'],
      [id('travelDetails_isTravelDateKnown'), 'Yes'],
      [id('travelDetails_travelDateYear'), '2026'],
      [id('travelDetails_travelDateMonth'), 'December'],
      [id('travelDetails_travelDateDay'), '01'],
      [
        id('backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanada'),
        'No',
      ],
      [
        id(
          'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhere',
        ),
        'No',
      ],
      [
        id(
          'backgroundQuestions_inThePastTwoYearsWereYouDiagnosedOrInCloseContactWithTuberculosis',
        ),
        'No',
      ],
      [
        id('backgroundQuestions_doYouHaveOneOfTheseConditions'),
        'None of the above',
      ],
    ];
    expect(w.map((i) => [i.targetField, i.mappedValue])).toEqual(expected);
    for (const i of w) expect(i.page).toBe('/eta/welcome');
  });

  it('a Pakistani passport writes the Pakistan options of each list', () => {
    const w = writes({
      ...UK,
      nationality: 'PAK',
      place_of_birth: 'Rawalpindi, Pakistan',
      residential_address: '138 Millat Colony, Rawalpindi, Pakistan',
    });
    expect(valueAt(w, id('prerequisite_countryOfCitizenship'))).toBe(
      'PAK (Pakistan)',
    );
    expect(valueAt(w, id('prerequisite_passportNotedNationality'))).toBe(
      'Pakistan',
    );
    expect(valueAt(w, id('personalDetails_countryOfBirth'))).toBe('Pakistan');
    expect(valueAt(w, id('contactDetails_country'))).toBe('Pakistan');
    expect(valueAt(w, id('contactDetails_streetNo'))).toBe('138');
    expect(valueAt(w, id('contactDetails_streetAddress'))).toBe(
      'Millat Colony',
    );
  });

  it('a UK birth place that names no nation is left for the applicant', () => {
    const w = writes({ ...UK, place_of_birth: 'Leeds, United Kingdom' });
    expect(valueAt(w, id('personalDetails_countryOfBirth'))).toBeUndefined();
    expect(valueAt(w, id('personalDetails_cityTownOfBirth'))).toBe('Leeds');
  });

  it('writes the UCI only after a "Yes" to applying before', () => {
    const yes = writes({
      ...UK,
      previously_applied_to_canada: 'Yes',
      uci: '1234-5678',
    });
    expect(valueAt(yes, id('personalDetails_uci'))).toBe('1234-5678');
    expect(valueAt(yes, id('personalDetails_uciReEnter'))).toBe('1234-5678');
    const no = writes({ ...UK, uci: '1234-5678' });
    expect(valueAt(no, id('personalDetails_uci'))).toBeUndefined();
  });

  it('writes no travel date when none is known', () => {
    const { planned_entry_date: _drop, ...rest } = UK;
    const w = writes(rest);
    expect(valueAt(w, id('travelDetails_isTravelDateKnown'))).toBeUndefined();
    expect(valueAt(w, id('travelDetails_travelDateYear'))).toBeUndefined();
  });

  describe('background questions are declarations, never defaulted', () => {
    const BACKGROUND = [
      id('backgroundQuestions_refusedVisaOrPermitOrDeniedEntryToCanada'),
      id(
        'backgroundQuestions_committedOrArrestedOrChargedOrConvictedOfCriminalOffenceAnywhere',
      ),
      id(
        'backgroundQuestions_inThePastTwoYearsWereYouDiagnosedOrInCloseContactWithTuberculosis',
      ),
      id('backgroundQuestions_doYouHaveOneOfTheseConditions'),
    ];

    it('flags each one a declaration', () => {
      for (const sel of BACKGROUND) {
        const m = mapping().find((x) => x.selector === sel);
        expect(m?.declaration).toBe(true);
      }
    });

    it('with no answers nothing is written and each needs your answer', () => {
      const bare = {
        nationality: 'GBR',
        passport_number: '123456789',
      };
      const w = writes(bare);
      for (const sel of BACKGROUND) expect(valueAt(w, sel)).toBeUndefined();
      const cov = portalFillCoverage(mapping(), bare);
      const left = cov.pages[0].left;
      expect(
        left.filter((l) => l.reason === 'needs_your_answer').length,
      ).toBeGreaterThanOrEqual(4);
    });

    it('one unanswered part of a combined question leaves it unanswered', () => {
      const { ever_convicted: _c, ...rest } = UK;
      expect(valueAt(writes(rest), BACKGROUND[1])).toBeUndefined();
    });

    it('a "Yes" to any part of a combined question answers "Yes"', () => {
      expect(
        valueAt(writes({ ...UK, ever_arrested: 'Yes' }), BACKGROUND[1]),
      ).toBe('Yes');
      // The eTA question covers Canada or any other country.
      expect(
        valueAt(writes({ ...UK, denied_entry: 'Yes' }), BACKGROUND[0]),
      ).toBe('Yes');
    });

    it('the refusal question covers any country: a refusal anywhere is "Yes"', () => {
      expect(
        valueAt(writes({ ...UK, previous_visa_refused: 'Yes' }), BACKGROUND[0]),
      ).toBe('Yes');
      const {
        previous_visa_refused: _a,
        denied_entry: _b,
        ordered_to_leave: _c,
        ...none
      } = UK;
      expect(
        valueAt(writes({ ...none, refused_by_canada: 'Yes' }), BACKGROUND[0]),
      ).toBe('Yes');
      // "Never refused by Canada" says nothing about other countries.
      expect(
        valueAt(writes({ ...none, refused_by_canada: 'No' }), BACKGROUND[0]),
      ).toBeUndefined();
    });

    it('close contact with TB over five years does not answer the two-year question', () => {
      expect(
        valueAt(writes({ ...UK, tuberculosis_contact: 'Yes' }), BACKGROUND[2]),
      ).toBeUndefined();
      expect(
        valueAt(writes({ ...UK, tuberculosis: 'Yes' }), BACKGROUND[2]),
      ).toBe('Yes');
    });

    it('a "Yes" health answer is never turned into one of the listed conditions', () => {
      expect(
        valueAt(writes({ ...UK, addiction: 'Yes' }), BACKGROUND[3]),
      ).toBeUndefined();
    });
  });

  it('a representative is never assumed', () => {
    const { is_representative: _r, ...rest } = UK;
    expect(
      valueAt(writes(rest), '[id="welcome_isRepresentative"]'),
    ).toBeUndefined();
  });

  it('lists the declaration and signature as the applicant’s own', () => {
    const cov = portalFillCoverage(mapping(), UK);
    expect(cov.pages).toHaveLength(1);
    const labels = cov.pages[0].left.map((l) => l.label.toLowerCase());
    expect(labels.some((l) => /declaration/.test(l))).toBe(true);
  });
});
