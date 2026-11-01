import { scoreDocumentation } from '../src/modules/vri/graphs/scoring/score-documentation';
import { scoreFinancial } from '../src/modules/vri/graphs/scoring/score-financial';
import { scoreTravelHistory } from '../src/modules/vri/graphs/scoring/score-travel-history';
import { scoreHomeTies } from '../src/modules/vri/graphs/scoring/score-home-ties';
import { scoreEmployment } from '../src/modules/vri/graphs/scoring/score-employment';
import { scoreConsistency } from '../src/modules/vri/graphs/scoring/score-consistency';
import { makeGenerateRecommendationsNode } from '../src/modules/vri/graphs/nodes/generate-recommendations';
import type {
  VriInputData,
  VriState,
} from '../src/modules/vri/graphs/vri.state';
import { RETIREE_DATA } from './fixtures/vri-trv-refused-retiree';

/**
 * "VRI should not generate dummy score — it should analyze completely with all
 * the documents and every possibility."
 *
 * Driven by a real refused-retiree TRV case (anonymised fixture). The old
 * scorers read keys the intake never writes and counted files instead of
 * reading them, producing: documentation 100, financial 0, travel 30,
 * home ties 0, employment 0, consistency 0.
 */

const st = (data: Partial<VriInputData>, extra: Partial<VriState> = {}) =>
  ({
    data: {
      profile: {},
      checklistItems: [],
      documents: [],
      verifications: [],
      crossVerifications: [],
      destinationCountry: 'CA',
      currentVisaType: null,
      ...data,
    },
    ...extra,
  }) as VriState;

const retiree = () => st(RETIREE_DATA);
const evidenceText = (out: Partial<VriState>) =>
  Object.values(out.factorEvidence ?? {})
    .flat()
    .join('\n');

describe('VRI evidence-based scoring — refused-retiree TRV case', () => {
  it('documentation: does not pass 100% when 6 of 11 uploads were never read', async () => {
    const out = await scoreDocumentation(retiree());
    expect(out.scores!.documentation_pct).toBeLessThan(100);
    expect(out.unassessedFactors ?? []).not.toContain('documentation_pct');
    const ev = evidenceText(out);
    expect(ev).toMatch(/6 of 11/);
    expect(ev).toMatch(/bank_statement/);
  });

  it('documentation: a required item whose only upload failed OCR is not satisfied', async () => {
    const out = await scoreDocumentation(
      st({
        checklistItems: [
          {
            id: 'a',
            document_type: 'passport',
            required: true,
            status: 'uploaded',
          },
          {
            id: 'b',
            document_type: 'bank_statement',
            required: true,
            status: 'uploaded',
          },
        ],
        documents: [
          {
            id: 'p',
            document_type: 'passport',
            ocr_status: 'complete',
            checklist_item_id: 'a',
          },
          {
            id: 'q',
            document_type: 'bank_statement',
            ocr_status: 'failed',
            checklist_item_id: 'b',
          },
        ],
        verifications: [
          {
            document_id: 'p',
            verification_type: 'identity',
            result: 'pass',
            details_json: { extracted_fields: { full_name: 'X Y' } },
          },
        ],
      }),
    );
    // 1 of 2 required satisfied, 1 of 2 uploads readable.
    expect(out.scores!.documentation_pct).toBe(50);
  });

  it('financial: counts declared sponsor funds vs stay, but NOT an unreadable bank statement', async () => {
    const out = await scoreFinancial(retiree());
    const pct = out.scores!.financial_pct;
    expect(out.unassessedFactors ?? []).not.toContain('financial_pct');
    expect(pct).toBeGreaterThan(0); // old: 0 (keys not found)
    expect(pct).toBeLessThan(60); // nothing documentary was readable
    const ev = evidenceText(out);
    expect(ev).toMatch(/30,?000 CAD/);
    expect(ev).toMatch(/unreadable/i);
  });

  it('financial: a readable bank statement with a balance scores higher than declared-only', async () => {
    const declared = await scoreFinancial(retiree());
    const withBank = await scoreFinancial(
      st({
        ...RETIREE_DATA,
        documents: [
          ...RETIREE_DATA.documents.filter((d) => d.id !== 'bank'),
          {
            id: 'bank',
            document_type: 'bank_statement',
            ocr_status: 'complete',
          },
        ],
        verifications: [
          ...RETIREE_DATA.verifications.filter((v) => v.document_id !== 'bank'),
          {
            document_id: 'bank',
            verification_type: 'identity',
            result: 'pass',
            details_json: {
              extracted_fields: { account_balance: 25000, currency: 'CAD' },
            },
          },
        ],
      }),
    );
    expect(withBank.scores!.financial_pct).toBeGreaterThan(
      declared.scores!.financial_pct + 25,
    );
  });

  it('travel history: a recent refusal with no travel scores below the no-travel floor', async () => {
    const out = await scoreTravelHistory(retiree());
    expect(out.unassessedFactors ?? []).not.toContain('travel_history_pct');
    expect(out.scores!.travel_history_pct).toBeLessThan(30); // old: 30 regardless
    expect(evidenceText(out)).toMatch(/refus/i);
  });

  it('home ties: reads property, spouse and child at home from the real keys', async () => {
    const out = await scoreHomeTies(retiree());
    const pct = out.scores!.home_ties_pct;
    expect(pct).toBeGreaterThanOrEqual(25); // old: 0
    expect(pct).toBeLessThan(80); // ties declared, marriage cert unreadable
    const ev = evidenceText(out);
    expect(ev).toMatch(/propert/i);
    expect(ev).toMatch(/spouse/i);
    expect(ev).toMatch(/not documented|unreadable/i);
    expect(ev).toMatch(/previous refusal/i);
  });

  it('home ties: documenting a tie lifts the refusal discount', async () => {
    const declaredOnly = await scoreHomeTies(retiree());
    const withMarriageCert = await scoreHomeTies(
      st({
        ...RETIREE_DATA,
        documents: RETIREE_DATA.documents.map((d) =>
          d.id === 'marriage' ? { ...d, ocr_status: 'complete' } : d,
        ),
        verifications: RETIREE_DATA.verifications.map((v) =>
          v.document_id === 'marriage'
            ? {
                ...v,
                result: 'pass',
                details_json: {
                  extracted_fields: { spouse_name: 'Nadia Mahmood' },
                },
              }
            : v,
        ),
      }),
    );
    expect(withMarriageCert.scores!.home_ties_pct).toBeGreaterThan(
      declaredOnly.scores!.home_ties_pct + 10,
    );
  });

  it('employment: a retiree is not scored 0% — unassessed with the reason stated', async () => {
    const out = await scoreEmployment(retiree());
    expect(out.unassessedFactors).toContain('employment_pct');
    expect(evidenceText(out)).toMatch(/retired/i);
  });

  it('employment: a sponsor’s employment letter is not the applicant’s employment', async () => {
    const out = await scoreEmployment(
      st({
        profile: { employed: true, full_name: 'Tariq Mahmood' },
        documents: [
          {
            id: 'e',
            document_type: 'employment_letter',
            ocr_status: 'complete',
          },
        ],
        verifications: [
          {
            document_id: 'e',
            verification_type: 'identity',
            result: 'pass',
            details_json: {
              extracted_fields: { full_name: 'Bilal Tariq', employer: 'Acme' },
            },
          },
        ],
      }),
    );
    const own = await scoreEmployment(
      st({
        profile: { employed: true, full_name: 'Tariq Mahmood' },
        documents: [
          {
            id: 'e',
            document_type: 'employment_letter',
            ocr_status: 'complete',
          },
        ],
        verifications: [
          {
            document_id: 'e',
            verification_type: 'identity',
            result: 'pass',
            details_json: {
              extracted_fields: {
                full_name: 'Tariq Mahmood',
                employer: 'Acme',
              },
            },
          },
        ],
      }),
    );
    expect(own.scores!.employment_pct).toBeGreaterThan(
      out.scores!.employment_pct,
    );
  });

  it('consistency: format-only and order-only differences are not mismatches', async () => {
    const out = await scoreConsistency(retiree());
    expect(out.unassessedFactors ?? []).not.toContain('consistency_pct');
    // Old: 16 comparisons, 14 "mismatches" -> 0%. Re-checked: DOBs all agree,
    // swapped name order agrees; only different-person names remain open.
    expect(out.scores!.consistency_pct).toBeGreaterThanOrEqual(50);
    const ev = evidenceText(out);
    expect(ev).toMatch(/56/); // stated 56 days vs 61 from the dates
    expect(ev).toMatch(/61/);
  });

  it('consistency: a genuine date mismatch still counts', async () => {
    const out = await scoreConsistency(
      st({
        crossVerifications: [
          {
            field_compared: 'date_of_birth',
            result: 'mismatch',
            details_json: { value_a: '1960-03-10', value_b: '1961-03-10' },
          },
        ],
      }),
    );
    expect(out.scores!.consistency_pct).toBe(0);
  });

  it('consistency: a date difference the cross-check downgraded to a warning counts half, not as a mismatch', async () => {
    // run_cross_verification downgrades a difference on an upload that is not
    // known to be the applicant's own document (prod 2026-10-14).
    const out = await scoreConsistency(
      st({
        crossVerifications: [
          {
            field_compared: 'date_of_birth',
            result: 'warning',
            details_json: { value_a: '1961-06-15', value_b: '1970-02-01' },
          },
        ],
      }),
    );
    expect(out.scores!.consistency_pct).toBe(50);
  });
});

describe('VRI — a factor with no evidence is unassessed, never defaulted', () => {
  it.each([
    ['financial_pct', scoreFinancial],
    ['travel_history_pct', scoreTravelHistory],
    ['home_ties_pct', scoreHomeTies],
    ['employment_pct', scoreEmployment],
  ] as const)('%s', async (key, scorer) => {
    const out = await scorer(st({}));
    expect(out.unassessedFactors).toContain(key);
  });
});

describe('VRI recommendations address the refusal grounds', () => {
  it('adds deterministic refusal + unreadable-document recommendations and gives the LLM the evidence', async () => {
    const invoke = jest.fn().mockResolvedValue({ content: 'not json' });
    const node = makeGenerateRecommendationsNode({ invoke } as never, null, 70);
    const out = await node({
      ...retiree(),
      scores: {
        documentation_pct: 60,
        financial_pct: 45,
        travel_history_pct: 15,
        home_ties_pct: 50,
        employment_pct: 0,
        consistency_pct: 80,
      },
      unassessedFactors: ['employment_pct'],
      factorEvidence: {
        financial_pct: ['bank_statement uploaded but unreadable'],
      },
    });

    const text = out
      .recommendations!.map((r) => `${r.issue} ${r.recommendation_text}`)
      .join('\n');
    expect(text).toMatch(/179\(b\)/);
    expect(text).toMatch(/temporary|purpose/i);
    expect(text).toMatch(/re-?upload/i);
    // LLM prompt carries the evidence and the refusal reason.
    const human = JSON.stringify(invoke.mock.calls[0][0]);
    expect(human).toMatch(/bank_statement uploaded but unreadable/);
    expect(human).toMatch(/179\(b\)/);
    // Every recommendation uses a factor key the readiness UI can label.
    for (const r of out.recommendations!) expect(r.factor).toMatch(/_pct$/);
  });
});
