/**
 * A study permit's funds are weighed against IRCC's own minimum — a year of
 * living costs for everyone coming plus the first-year tuition still unpaid —
 * not against a USD 100-a-day visit (2026-10-20).
 */
import { CA_STUDY_VISAAI_ID, studyFundsNeed, studyLivingCostCad } from '@visaai/types';
import { scoreFinancial } from '../src/modules/vri/graphs/scoring/score-financial';
import type { VriInputData, VriState } from '../src/modules/vri/graphs/vri.state';

const st = (profile: Record<string, unknown>, data: Partial<VriInputData> = {}) =>
  ({
    data: {
      profile,
      checklistItems: [],
      documents: [],
      verifications: [],
      crossVerifications: [],
      destinationCountry: 'CA',
      currentVisaType: null,
      visaaiId: CA_STUDY_VISAAI_ID,
      ...data,
    },
  }) as VriState;

const text = (out: Partial<VriState>) => (out.factorEvidence?.financial_pct ?? []).join('\n');

describe('study permit minimum funds (canada.ca, modified 2026-08-28)', () => {
  it('uses the table in force on the day', () => {
    expect(studyLivingCostCad(1, new Date('2026-10-20'))).toBe(23_448);
    expect(studyLivingCostCad(1, new Date('2026-08-31'))).toBe(22_895);
    expect(studyLivingCostCad(3, new Date('2026-10-20'))).toBe(35_888);
    expect(studyLivingCostCad(9, new Date('2026-10-20'))).toBe(62_054 + 2 * 6_318);
    expect(studyLivingCostCad(1, new Date('2024-06-01'))).toBeNull();
  });

  it('adds the spouse and children coming, and the tuition not yet paid', () => {
    const n = studyFundsNeed(
      { spouse_coming_to_canada: 'Yes', children_accompanying: ['Aleyna'], tuition_cad: '18,500', tuition_paid_cad: 9250 },
      new Date('2026-10-20'),
    );
    expect(n).toEqual({ familyMembers: 3, livingCad: 35_888, tuitionDueCad: 9_250, totalCad: 45_138, quebec: false });
    expect(studyFundsNeed({ children_accompanying: 'none', tuition_cad: 10000 }).familyMembers).toBe(1);
    expect(studyFundsNeed({ study_province: 'Québec', tuition_cad: 10000 }).totalCad).toBeNull();
    expect(studyFundsNeed({}).totalCad).toBeNull();
  });

  it('reads the fact aliases and the per-child answers (review fixes)', () => {
    expect(studyFundsNeed({ tuition: 18000, tuition_cad: '' }).tuitionDueCad).toBe(18000);
    expect(studyFundsNeed({ school_province: 'QC', tuition_cad: 1 }).quebec).toBe(true);
    const kids = (children_accompanying: unknown, extra: Record<string, unknown> = {}) =>
      studyFundsNeed({ children_accompanying, ...extra }).familyMembers - 1;
    expect(kids(undefined, { children: [{ name: 'A', coming_to_canada: 'Yes' }, { name: 'B', coming_to_canada: 'No' }] })).toBe(1);
    expect(kids('Not coming')).toBe(0);
    expect(kids('neither')).toBe(0);
    expect(kids('[]')).toBe(0);
    expect(kids('2 children')).toBe(2);
    expect(kids('both')).toBe(2);
    expect(kids('Aleyna and Sara')).toBe(2);
    expect(kids([{ name: 'A' }])).toBe(1);
  });
});

describe('VRI financial — study permit', () => {
  const base = { tuition_cad: 18500, tuition_paid_cad: 9250 };

  it('weighs funds against living costs plus unpaid tuition, not a daily visit cost', async () => {
    const out = await scoreFinancial(st({ ...base, study_funds_available_cad: 40000 }));
    expect(text(out)).toMatch(/IRCC's minimum of CAD/);
    expect(text(out)).toMatch(/covers it/);
    expect(text(out)).not.toMatch(/-day stay/);
    const short = await scoreFinancial(st({ ...base, study_funds_available_cad: 5000 }));
    expect(text(short)).toMatch(/does not cover it/);
    expect(out.scores!.financial_pct).toBeGreaterThan(short.scores!.financial_pct);
  });

  it('weighs the study funds answer, not a larger amount in another currency', async () => {
    const out = await scoreFinancial(
      st({ ...base, study_funds_available_cad: 40000, available_funds: 5000000, funds_currency: 'PKR' }),
    );
    expect(text(out)).toMatch(/Declared funds: 40,000 CAD/);
    expect(text(out)).toMatch(/covers it/);
  });

  it('does not guess the minimum without the tuition, or in Quebec', async () => {
    expect(text(await scoreFinancial(st({ study_funds_available_cad: 40000 })))).toMatch(/tuition not known yet/);
    expect(text(await scoreFinancial(st({ ...base, study_province: 'Quebec', study_funds_available_cad: 40000 })))).toMatch(/set by Quebec/);
  });

  it('reads a GIC as a fund document', async () => {
    const out = await scoreFinancial(
      st(base, {
        documents: [
          { id: 'g', document_type: 'gic_certificate', ocr_status: 'complete' },
        ] as never,
        verifications: [
          { document_id: 'g', details_json: { extracted_fields: { account_balance: 23448, currency: 'CAD' } } },
        ] as never,
      }),
    );
    expect(text(out)).toMatch(/gic_certificate: balance 23,448 CAD/);
  });

  it('a visitor route keeps the daily-cost check', async () => {
    const out = await scoreFinancial(
      st(
        { available_funds_cad: 5000, planned_entry_date: '2027-01-01', planned_departure_date: '2027-01-14' },
        { visaaiId: 'ca-visitor-visa-temporary-resident-visa' },
      ),
    );
    expect(text(out)).toMatch(/-day stay/);
  });
});
