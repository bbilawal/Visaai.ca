import { intakeFactSpecs, missingIntakeFacts } from '@visaai/types';
import { canonicalKeysBlock } from './graphs/nodes/required-facts';

/**
 * Prod 2026-10-29: the TRV interview recorded the spouse's birth date, country
 * and occupation from one answer but not her name — `spouse_name` was no
 * canonical key on the route, so the extractor had nowhere to put it.
 */
const route = {
  country: 'CA',
  visaaiId: 'ca-visitor-visa-temporary-resident-visa',
};

describe('TRV interview — the spouse name is a recorded fact', () => {
  it('is a canonical key the extractor is told about', () => {
    expect(intakeFactSpecs(route).map((s) => s.key)).toContain('spouse_name');
    const block = canonicalKeysBlock({
      destinationCountry: 'CA',
      requirementsJson: {
        visaai_id: route.visaaiId,
      },
    } as never);
    expect(block).toMatch(/- spouse_name:/);
  });

  it('is asked of a married applicant until answered, never of a single one', () => {
    const missing = (p: Record<string, unknown>) =>
      missingIntakeFacts(p, route).map((s) => s.key);
    expect(missing({ marital_status: 'Married' })).toContain('spouse_name');
    expect(
      missing({ marital_status: 'Married', spouse_name: 'Hina Farooq' }),
    ).not.toContain('spouse_name');
    expect(missing({ marital_status: 'Single' })).not.toContain('spouse_name');
  });
});

describe('TRV interview — a spouse name recorded another way is an answer', () => {
  const missing = (p: Record<string, unknown>) =>
    missingIntakeFacts(p, route).map((s) => s.key);
  it('counts a spouse record with a name', () => {
    expect(
      missing({ marital_status: 'Married', spouse: { name: 'Hina Farooq' } }),
    ).not.toContain('spouse_name');
  });
  it('counts the family and given names given separately', () => {
    expect(
      missing({
        marital_status: 'Married',
        spouse_family_name: 'Farooq',
        spouse_given_name: 'Hina',
      }),
    ).not.toContain('spouse_name');
  });
});
