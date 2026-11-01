import { scoreFinancial } from '../src/modules/vri/graphs/scoring/score-financial';
import { scoreHomeTies } from '../src/modules/vri/graphs/scoring/score-home-ties';
import { scoreDocumentation } from '../src/modules/vri/graphs/scoring/score-documentation';
import { scoreEmployment } from '../src/modules/vri/graphs/scoring/score-employment';
import { scoreConsistency } from '../src/modules/vri/graphs/scoring/score-consistency';
import type {
  VriInputData,
  VriState,
} from '../src/modules/vri/graphs/vri.state';

/**
 * Readiness for a Parent and Grandparent Super Visa (dry run 2026-10-16).
 *
 * The visitor-visa scoring weighed the APPLICANT's funds against USD 100 a day
 * for the stay — USD 36,500 for a super visa year, a test a homemaker hosted
 * by her son can never pass and IRCC never applies — and docked 10 points
 * because her children live in Canada, which is the very basis of a super
 * visa. A super visa is judged on the host's income against the minimum
 * necessary income for the family size, and on the medical insurance.
 */

const st = (
  profile: Record<string, unknown>,
  data: Partial<VriInputData> = {},
) =>
  ({
    data: {
      profile,
      checklistItems: [],
      documents: [],
      verifications: [],
      crossVerifications: [],
      destinationCountry: 'CA',
      currentVisaType: null,
      visaaiId: 'ca-super-visa',
      ...data,
    },
  }) as VriState;

const text = (out: Partial<VriState>) =>
  Object.values(out.factorEvidence ?? {})
    .flat()
    .join('\n');

const SUPER = {
  planned_entry_date: '2027-03-01',
  planned_departure_date: '2028-02-28',
  host_household_members: [{ name: 'Host' }, { name: 'Applicant' }],
  host_annual_income_cad: 80000,
  host_income_tax_year: 2025,
  has_super_visa_insurance: true,
  medical_insurance_coverage_cad: 100000,
  medical_insurance_months: 12,
  medical_insurance_paid: 'paid in full',
  available_funds: 200000,
  funds_currency: 'PKR',
};

describe('VRI financial — super visa', () => {
  it('scores the host income against the minimum necessary income, not the applicant’s funds per day', async () => {
    const out = await scoreFinancial(st(SUPER));
    const ev = text(out);
    expect(ev).toMatch(/minimum necessary income/i);
    expect(ev).toContain('CAD 38,002');
    expect(ev).not.toMatch(/USD [\d,]+ for a 3\d\d-day stay/);
    // host income meets the minimum (40) + insurance meets (30); the 30
    // points for documenting them are not earned without the documents, and
    // nothing is scored for the applicant's own per-day funds
    expect(out.scores!.financial_pct).toBe(70);
  });

  it('a host income below the minimum earns nothing for adequacy and says so', async () => {
    const out = await scoreFinancial(
      st({
        ...SUPER,
        host_household_members: Array.from({ length: 7 }, () => ({})),
      }),
    );
    expect(text(out)).toMatch(/does not meet/i);
    expect(out.scores!.financial_pct).toBe(30);
  });

  it('an insurance shortfall earns nothing and is named', async () => {
    const out = await scoreFinancial(
      st({ ...SUPER, medical_insurance_months: 6 }),
    );
    expect(text(out)).toMatch(/1 year/);
    expect(out.scores!.financial_pct).toBe(40);
  });

  it('an uploaded policy that has expired does not count as insurance', async () => {
    const out = await scoreFinancial(
      st(SUPER, {
        documents: [
          {
            id: 'd1',
            document_type: 'medical_insurance',
            ocr_status: 'complete',
          },
        ],
        verifications: [
          {
            document_id: 'd1',
            verification_type: 'expiry',
            result: 'fail',
            details_json: { basis: 'expired' },
          },
        ],
      }),
    );
    expect(text(out)).toMatch(/expired/i);
    expect(out.scores!.financial_pct).toBe(40);
  });

  it('the visitor visa keeps the funds-per-day test', async () => {
    const out = await scoreFinancial(
      st(SUPER, { visaaiId: 'ca-visitor-visa-temporary-resident-visa' }),
    );
    expect(text(out)).toMatch(/for a 36\d-day stay/);
  });
});

describe('VRI home ties — super visa', () => {
  const ties = {
    has_property: true,
    spouse_coming_to_canada: false,
    family_in_destination: true,
  };

  it('does not penalise children in Canada — they are the basis of the visa', async () => {
    const sv = await scoreHomeTies(st(ties));
    const trv = await scoreHomeTies(
      st(ties, { visaaiId: 'ca-visitor-visa-temporary-resident-visa' }),
    );
    expect(sv.scores!.home_ties_pct).toBe(trv.scores!.home_ties_pct + 10);
    expect(text(sv)).not.toMatch(/counter-pull/);
  });
});

/**
 * Prod replay, app 61f16bb5 (VRI 48 at 2026-10-16 ~21:40Z): Financial 30,
 * Employment 10, and "2 uploaded document(s) could not be read:
 * host_letter_of_invitation, income_proof_option_one".
 *  - The letter of invitation and the host's income proof were read (4,305 and
 *    350 characters of OCR text) but yielded no structured fields, and
 *    "readable" required fields.
 *  - Of two uploaded policies the expired one failed its expiry check, and
 *    that alone sank the insurance — the covering policy was never looked at.
 *  - The host's verified income proof was not an income document the visitor
 *    scorer knew (income_proof_option_one), so "lacks readable proof of the
 *    sponsoring sons' financial capacity".
 *  - A homemaker parent scored 10% employment, as if her job were the tie.
 */
describe('VRI — super visa prod replay (app 61f16bb5)', () => {
  const PROFILE = {
    ...SUPER,
    full_name: 'SUMERA AHMAD',
    employed: false,
    host_household_members: [{}, {}, {}, {}],
    host_annual_income_cad: 80000,
    medical_insurance_provider: 'TEST DUMMY Canadian Insurance Company Inc.',
    available_funds: 5000,
    funds_currency: 'CAD',
  };
  const doc = (id: string, document_type: string) => ({
    id,
    document_type,
    ocr_status: 'complete',
    checklist_item_id: null,
  });
  const identity = (
    document_id: string,
    extracted_fields: Record<string, unknown>,
    raw_ocr_length: number,
    result = 'pass',
  ) => ({
    document_id,
    verification_type: 'identity',
    result,
    details_json: { error: null, raw_ocr_length, extracted_fields },
  });
  const expiry = (document_id: string, result: string) => ({
    document_id,
    verification_type: 'expiry',
    result,
    details_json: {},
  });
  const DATA: Partial<VriInputData> = {
    documents: [
      doc('loi', 'host_letter_of_invitation'),
      doc('t4', 'income_proof_option_one'),
      doc('hostinc', 'income_proof_option_one'),
      doc('ins-old', 'medical_insurance'),
      doc('ins-new', 'medical_insurance'),
    ],
    verifications: [
      identity('loi', {}, 4305),
      identity('t4', { full_name: 'SAJAWAL, MIAN MUHAMMAD' }, 13742, 'warn'),
      identity('hostinc', {}, 350),
      identity(
        'ins-old',
        {
          insurer_name: '21st Century TRAVEL INSURANCE LIMITED',
          policy_number: '11460162V-A',
          coverage_amount: 100000,
          coverage_start_date: 'Jun-01-2025',
          coverage_end_date: '(Jun-15-1961 / 63 yrs)',
          expiry_date: 'May-31-2026',
        },
        5190,
      ),
      expiry('ins-old', 'fail'),
      identity(
        'ins-new',
        {
          insurer_name: 'TEST DUMMY Canadian Insurance Company Inc.',
          policy_number: 'SV-DUMMY-2027-001',
          coverage_amount: 100000,
          coverage_start_date: '2027-03-01',
          coverage_end_date: '2028-03-01',
        },
        837,
      ),
      expiry('ins-new', 'pass'),
    ] as VriInputData['verifications'],
  };

  it('a document OCR read is readable even when it yields no fields', async () => {
    const out = await scoreDocumentation(st(PROFILE, DATA));
    expect(text(out)).not.toMatch(/could not be read/);
    expect(text(out)).toContain('5 of 5 uploaded documents were read');
    expect(out.scores!.documentation_pct).toBe(100);
  });

  it('credits the covering policy and the documented host income', async () => {
    const out = await scoreFinancial(st(PROFILE, DATA));
    const ev = text(out);
    expect(ev).toContain('SV-DUMMY-2027-001');
    expect(ev).not.toMatch(/expired or does not cover/);
    expect(ev).not.toMatch(/not yet documented/);
    expect(ev).toMatch(/CAD 56,724/);
    expect(out.scores!.financial_pct).toBe(100);
  });

  it('the expired policy alone still earns nothing for insurance', async () => {
    const out = await scoreFinancial(
      st(PROFILE, {
        documents: DATA.documents!.filter((d) => d.id !== 'ins-new'),
        verifications: DATA.verifications!.filter(
          (v) => v.document_id !== 'ins-new',
        ),
      }),
    );
    expect(text(out)).toMatch(/does not cover the planned stay/);
    expect(out.scores!.financial_pct).toBe(60);
  });

  it('employment is not assessed for a parent who does not work', async () => {
    const out = await scoreEmployment(st(PROFILE, DATA));
    expect(out.unassessedFactors).toContain('employment_pct');
    expect(text(out)).toMatch(/super visa/i);
  });

  it('a working parent still gets credit for the job as a tie home', async () => {
    const out = await scoreEmployment(st({ ...PROFILE, employed: true }));
    expect(out.unassessedFactors ?? []).not.toContain('employment_pct');
    expect(out.scores!.employment_pct).toBeGreaterThanOrEqual(45);
  });

  it('a visitor-visa applicant who does not work still scores 10', async () => {
    const out = await scoreEmployment(
      st(PROFILE, { visaaiId: 'ca-visitor-visa-temporary-resident-visa' }),
    );
    expect(out.scores!.employment_pct).toBe(10);
  });
});

describe('VRI consistency — a stay stated in months', () => {
  // Prod replay (app 61f16bb5): planned_stay_duration_months 12 was read as a
  // stated stay of 12 DAYS, an "inconsistency" against 364 days of dates.
  it('compares months as months', async () => {
    const out = await scoreConsistency(
      st({
        planned_entry_date: '2027-03-01',
        planned_departure_date: '2028-02-28',
        planned_stay_duration_months: 12,
      }),
    );
    expect(text(out)).not.toMatch(/12 days/);
    expect(text(out)).not.toMatch(/does not match the planned dates/);
  });

  it('still flags a month count the dates contradict', async () => {
    const out = await scoreConsistency(
      st({
        planned_entry_date: '2027-03-01',
        planned_departure_date: '2028-02-28',
        planned_stay_duration_months: 6,
      }),
    );
    expect(text(out)).toMatch(/6 months does not match the planned dates/);
  });
});
