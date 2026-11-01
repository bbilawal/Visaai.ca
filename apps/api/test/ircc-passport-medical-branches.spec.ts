/**
 * IRCC tr-rt branches the radio audit (bundle 2026-10-19) found with no
 * mapping: a Green Card "Yes" (USCIS number twice + expiry date), the
 * passport questions IRCC asks only for Taiwan, Israel and Romania, and the
 * tuberculosis "Were you treated?" after a positive test. Each is asked in
 * intake under the key the portal mapping reads.
 */
import '../src/modules/automation/portal-fills/canada-ircc';
import { intakeFactSpecs, missingIntakeFacts } from '@visaai/types';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../src/modules/automation/fill-instructions';
import { resolvePortalFill } from '../src/strategies/portal-integration/portal-fill.registry';
import { IRCC_PORTAL_ANSWERS } from './fixtures/ircc-portal-answers';

const trv = () => resolvePortalFill('ircc')!;
const TR_RT_ROUTES = [
  { country: 'CA', visaaiId: 'ca-visitor-visa-temporary-resident-visa' },
  { country: 'CA', visaaiId: 'ca-super-visa' },
  { country: 'CA', visaaiId: 'ca-business-visitors' },
];
const TRV = TR_RT_ROUTES[0];

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
const mapped = (p: Record<string, unknown>) =>
  buildMappingInputs(trv(), values(p));
const at = (p: Record<string, unknown>, target: string) =>
  mapped(p).find((x) => x.targetField === target)?.mappedValue;
const targets = (p: Record<string, unknown>) =>
  mapped(p).map((x) => x.targetField);
const left = (p: Record<string, unknown>, page: string) =>
  portalFillCoverage(trv(), values(p)).pages.find((x) => x.page === page)
    ?.left ?? [];

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

it.each(TR_RT_ROUTES)('every tr-rt route asks the new questions (%o)', (r) => {
  const keys = intakeFactSpecs(r).map((s) => s.key);
  // The Green Card number / expiry are not asked on tr-rt (live 2026-10-31).
  expect(keys).not.toContain('us_green_card_number');
  expect(keys).not.toContain('us_green_card_expiry_date');
  for (const k of [
    'taiwan_passport_with_personal_id',
    'taiwan_personal_id_number',
    'israeli_national_passport',
    'romanian_electronic_passport',
    'tuberculosis_positive_treated',
  ])
    expect(keys).toContain(k);
});

describe('Green Card', () => {
  const GC = {
    us_permanent_resident: true,
    us_green_card_number: 'A-123-456-789',
    us_green_card_expiry_date: '2031-05-20',
  };

  it('a Yes no longer asks the USCIS number or expiry date on tr-rt', () => {
    expect(missing({ us_permanent_resident: true })).not.toContain('us_green_card_number');
    expect(missing({ us_permanent_resident: true })).not.toContain('us_green_card_expiry_date');
  });

  // Live 2026-10-31: "Yes" reveals no number or expiry field and routes to
  // "you don't need to apply": Yes is never written, the card never asked.
  it('a Yes (even with the card details) is left unanswered, with the no-visa note', () => {
    for (const p of [GC, { us_permanent_resident: true }]) {
      expect(targets(p).some((t) => t.startsWith('#hasGreenCard'))).toBe(false);
      expect(targets(p).some((t) => /greenCard|GreenCard/.test(t))).toBe(false);
      const note = left(p, '/bio-data-travel-docs').find((n) => n.label === 'Green Card')?.note;
      expect(note).toMatch(/needs no visitor visa and no eTA/);
    }
  });

  it('no mapping targets the Green Card number or expiry controls', () => {
    expect(trv().some((f) => /greenCardNum|dateExpiryGreenCard/.test(f.selector))).toBe(false);
  });

  it('a No is written as before, with nothing revealed', () => {
    const p = { us_permanent_resident: false };
    expect(at(p, '#hasGreenCard_radio-button-02-input')).toBeDefined();
    expect(targets(p)).not.toContain('#greenCardNum_input');
  });
});

describe('country-specific passport questions', () => {
  it('are asked only of that passport', () => {
    expect(missing({ nationality: 'Pakistan' })).not.toContain(
      'taiwan_passport_with_personal_id',
    );
    expect(missing({ nationality: 'Taiwan' })).toContain(
      'taiwan_passport_with_personal_id',
    );
    expect(missing({ nationality: 'Israel' })).toContain(
      'israeli_national_passport',
    );
    expect(missing({ nationality: 'Romania' })).toContain(
      'romanian_electronic_passport',
    );
  });

  it('Taiwan: Yes with the personal ID number', () => {
    const p = {
      nationality: 'TWN',
      taiwan_passport_with_personal_id: true,
      taiwan_personal_id_number: 'A123456789',
    };
    expect(at(p, '#hasTaiwanPassport_radio-button-01-input')).toBeDefined();
    expect(at(p, '#taiwanNumber_input')).toBe('A123456789');
  });

  it('Taiwan: Yes without the number is left, with a note', () => {
    const p = { nationality: 'TWN', taiwan_passport_with_personal_id: true };
    expect(targets(p)).not.toContain(
      '#hasTaiwanPassport_radio-button-01-input',
    );
    expect(
      left(p, '/bio-data-travel-docs').some(
        (n) => n.label === 'Taiwan passport',
      ),
    ).toBe(true);
  });

  it('Israel and Romania: the answer is written for that passport only', () => {
    expect(
      at(
        { nationality: 'ISR', israeli_national_passport: true },
        '#hasIsraeliPassport_radio-button-01-input',
      ),
    ).toBeDefined();
    expect(
      at(
        { nationality: 'ROU', romanian_electronic_passport: false },
        '#hasRomaniaPassport_radio-button-02-input',
      ),
    ).toBeDefined();
    expect(
      targets({ israeli_national_passport: true }).some((t) =>
        t.startsWith('#hasIsraeliPassport'),
      ),
    ).toBe(false);
  });

  it('nothing is listed for any other passport', () => {
    const rows = left({}, '/bio-data-travel-docs').map((n) => n.label);
    expect(rows).not.toContain('Taiwan passport');
    expect(rows).not.toContain('Israeli passport');
    expect(rows).not.toContain('Romanian passport');
  });
});

describe('tuberculosis: treated after a positive test', () => {
  const TB = {
    tuberculosis_contact: true,
    tuberculosis_tested: true,
    tuberculosis_test_positive: true,
  };

  it('is asked after a positive result only', () => {
    expect(missing({ ...TB, tuberculosis_test_positive: false })).not.toContain(
      'tuberculosis_positive_treated',
    );
    expect(missing(TB)).toContain('tuberculosis_positive_treated');
  });

  it('fills fiveYearsTreatment', () => {
    expect(
      at(
        { ...TB, tuberculosis_positive_treated: true },
        '#fiveYearsTreatment_radio-button-01-input',
      ),
    ).toBeDefined();
  });

  it('a positive test without the answer lists it for the applicant', () => {
    expect(
      left(TB, '/medical-tuberculosis').some((n) =>
        /undergoing treatment/.test(n.label),
      ),
    ).toBe(true);
  });
});

describe('review of #257', () => {
  it('a Taiwan passport that is not regular: the radio is not written (IRCC never shows it)', () => {
    const p = {
      nationality: 'TWN',
      passport_type: 'Diplomatic',
      taiwan_passport_with_personal_id: false,
    };
    expect(targets(p).some((t) => t.startsWith('#hasTaiwanPassport'))).toBe(
      false,
    );
  });

  it('TB treatment uses IRCC wording (at least 6 months)', () => {
    const spec = intakeFactSpecs(TRV).find(
      (s) => s.key === 'tuberculosis_positive_treated',
    )!;
    expect(spec.question).toMatch(/at least 6 months/);
  });

  it('a Pakistani applicant without a Green Card resolves exactly as on main', () => {
    const p = { us_permanent_resident: false };
    const docs = mapped(p)
      .filter((x) => x.page === '/bio-data-travel-docs')
      .map((x) => x.targetField);
    expect(
      docs.filter((t) => /GreenCard|greenCard|Taiwan|Israeli|Romania/.test(t)),
    ).toEqual(['#hasGreenCard_radio-button-02-input']);
  });
});
