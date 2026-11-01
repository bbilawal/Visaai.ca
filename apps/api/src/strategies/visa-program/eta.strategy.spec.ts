import { CA_ETA_VISAAI_ID } from '@visaai/types';
import { strategyRegistry, visaProgramRegistry } from '..';
import {
  assessEtaEligibility,
  CA_TRV_VISAAI_ID,
  etaProgram,
} from './eta.strategy';

/**
 * Canada's eTA as a program of its own (dry run 2026-10-16, app a37a534b).
 *
 * A Pakistani applicant — visa-REQUIRED — picked the eTA with no warning, had
 * their Pakistani passport "Verified" in the "valid passport from a
 * visa-exempt country" slot, and was then offered a letter of explanation
 * that said they were "applying for a visitor visa". Each of those is wrong in
 * the way that costs an applicant a refused boarding, not a cosmetic slip.
 */

describe('assessEtaEligibility', () => {
  it('refuses a Pakistani and points to the visitor visa', () => {
    const r = assessEtaEligibility({ nationality: 'Pakistan' });
    expect(r.status).toBe('ineligible');
    expect(r.reason).toMatch(/Pakistan/);
    expect(r.reason).toMatch(/visitor visa/i);
    expect(r.recommendedVisaaiId).toBe(CA_TRV_VISAAI_ID);
  });

  it('reads a passport MRZ code', () => {
    expect(assessEtaEligibility({ nationality: 'PAK' }).status).toBe(
      'ineligible',
    );
  });

  it('accepts a visa-exempt national flying in', () => {
    expect(
      assessEtaEligibility({ nationality: 'GB', travel_by_air: true }).status,
    ).toBe('eligible');
  });

  it('accepts a visa-exempt national before the travel mode is known', () => {
    expect(assessEtaEligibility({ nationality: 'France' }).status).toBe(
      'eligible',
    );
  });

  it('a visa-exempt national arriving by land does not need an eTA', () => {
    const r = assessEtaEligibility({
      nationality: 'DE',
      travel_by_air: false,
    });
    expect(r.status).toBe('not_required');
  });

  it('cannot decide without a nationality', () => {
    expect(assessEtaEligibility({}).status).toBe('unknown');
    expect(assessEtaEligibility({ nationality: 'Atlantis' }).status).toBe(
      'unknown',
    );
  });

  describe('CAN+ (conditional) nationals', () => {
    it('eligible with a valid US non-immigrant visa', () => {
      expect(
        assessEtaEligibility({
          nationality: 'MX',
          valid_us_nonimmigrant_visa: 'yes',
          travel_by_air: true,
        }).status,
      ).toBe('eligible');
    });

    it('eligible with a Canadian visa in the past 10 years', () => {
      expect(
        assessEtaEligibility({
          nationality: 'Philippines',
          canadian_visa_last_10y: true,
        }).status,
      ).toBe('eligible');
    });

    it('ineligible with neither — a visitor visa is needed', () => {
      const r = assessEtaEligibility({
        nationality: 'Brazil',
        valid_us_nonimmigrant_visa: false,
        canadian_visa_last_10y: 'no',
      });
      expect(r.status).toBe('ineligible');
      expect(r.recommendedVisaaiId).toBe(CA_TRV_VISAAI_ID);
    });

    it('ineligible when not flying, even with a US visa', () => {
      const r = assessEtaEligibility({
        nationality: 'MX',
        valid_us_nonimmigrant_visa: true,
        travel_by_air: false,
      });
      expect(r.status).toBe('ineligible');
      expect(r.reason).toMatch(/air/i);
    });

    it('unknown until the CAN+ questions are answered', () => {
      expect(assessEtaEligibility({ nationality: 'Thailand' }).status).toBe(
        'unknown',
      );
    });
  });

  it.each([
    [{ nationality: 'US' }, /United States/],
    [{ nationality: 'Canada' }, /Canadian/],
    [{ nationality: 'PK', us_permanent_resident: true }, /permanent resident/i],
    [{ nationality: 'PK', holds_valid_canadian_visa: true }, /visa/i],
  ])('does not need an eTA: %o', (profile, why) => {
    const r = assessEtaEligibility(profile);
    expect(r.status).toBe('not_required');
    expect(r.reason).toMatch(why);
  });
});

describe('etaProgram', () => {
  const eta = etaProgram('CA');

  it('is its own program, keyed to the registry route', () => {
    expect(eta.id).toBe('eta');
    expect(eta.registryVisaaiIds).toEqual([CA_ETA_VISAAI_ID]);
  });

  it('asks for a passport — and never an email or a payment card', () => {
    const codes = eta.requiredDocuments().map((d) => d.code);
    expect(codes).toEqual(['passport']);
  });

  it('needs no generated letters and no discovery supplement', () => {
    expect(eta.requiredGeneratedDocuments?.()).toEqual([]);
    expect(eta.checklistSupplement).toBe(false);
  });

  it('does not score funds or home ties', () => {
    const w = eta.riskWeightOverrides?.() ?? {};
    expect(w.financial_pct).toBe(0);
    expect(w.home_ties_pct).toBe(0);
  });

  it('exposes evaluable eligibility checks', () => {
    const checks = eta.eligibilityChecks();
    const nat = checks.find((c) => c.id === 'eta_eligible_nationality')!;
    expect(nat.evaluate?.({ nationality: 'PK' })).toBe(false);
    expect(nat.evaluate?.({ nationality: 'JP' })).toBe(true);
  });

  it('carries guidance for the interviewer that is not visitor-visa advice', () => {
    const g = eta.interviewGuidance?.() ?? '';
    expect(g).toMatch(/eTA/);
    expect(g).toMatch(/not a visa/i);
  });
});

describe('registration', () => {
  it('is a registered program type', () => {
    expect(visaProgramRegistry.has('eta')).toBe(true);
    expect(visaProgramRegistry.build('eta', 'CA').id).toBe('eta');
  });

  it('is one of Canada’s programs', () => {
    expect(strategyRegistry.resolve('CA', 'eta')?.program.id).toBe('eta');
  });

  it('resolves from the registry visa type', () => {
    expect(
      strategyRegistry.resolveRoute('CA', CA_ETA_VISAAI_ID)?.program.id,
    ).toBe('eta');
    expect(
      strategyRegistry.resolveRoute('ca', CA_ETA_VISAAI_ID)?.program.id,
    ).toBe('eta');
  });

  it('leaves a route no program claims unresolved', () => {
    expect(
      strategyRegistry.resolveRoute('CA', 'ca-no-such-route'),
    ).toBeUndefined();
    expect(strategyRegistry.resolveRoute('CA', null)).toBeUndefined();
  });
});

// Review 2026-10-16: "Germany" resolved to the retired code DD, so a
// visa-exempt German was refused the eTA.
describe('nationalityCode — current ISO codes for country names', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { nationalityCode, isEtaVisaExempt } = require('@visaai/types');
  it.each([
    ['Germany', 'DE'],
    ['Vietnam', 'VN'],
    ['United Kingdom', 'GB'],
    ['France', 'FR'],
  ])('%s -> %s', (name: string, code: string) => {
    expect(nationalityCode(name)).toBe(code);
  });
  it('a German passport is eTA visa-exempt', () => {
    expect(isEtaVisaExempt(nationalityCode('Germany'))).toBe(true);
  });
});

// Review of #134: IRCC judges the eTA on the passport travelled on. A dual
// national travelling on a British passport is eligible.
describe('profileNationality — passport decides', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { profileNationality } = require('@visaai/types');
  it('prefers passport_country over a visa-required citizenship', () => {
    expect(
      profileNationality({ nationality: 'Pakistan', passport_country: 'United Kingdom' }),
    ).toBe('GB');
  });
  it('falls back to nationality when no passport is known', () => {
    expect(profileNationality({ nationality: 'Pakistan' })).toBe('PK');
  });
});
