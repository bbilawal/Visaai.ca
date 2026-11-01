import {
  CA_ETA_VISAAI_ID,
  isEtaConditional,
  isEtaVisaExempt,
  profileNationality,
  intakeAnswerIsYes,
  requiredGenTypesForRoute,
} from '@visaai/types';
import type { CountryCode, ComplianceRequirement } from '../types';
import type {
  RouteEligibility,
  VisaProgramStrategy,
} from './base-visa-program.strategy';
import { docs } from '../document-requirements/common-documents';

/**
 * Canada's electronic travel authorization (eTA) as a program of its own.
 *
 * WHY THIS EXISTS
 *
 * Until now the eTA was a registry route with no program behind it, so every
 * stage treated it as the only thing it knew — a visitor visa. Dry run
 * 2026-10-16 (app a37a534b, Pakistani applicant):
 *
 *   - the applicant picked the eTA although Pakistanis need a visitor visa;
 *   - their Pakistani passport was "Verified" in the visa-exempt-passport slot;
 *   - an email address and a payment card were upload slots, and a photo of a
 *     VOID card was accepted;
 *   - Generate wrote a letter "applying for a visitor visa";
 *   - sponsor-style evidence (invitation letter, son's funds) was suggested.
 *
 * An eTA is not a visa. It is a CAD 7 online pre-screen for visa-exempt
 * nationals FLYING to Canada, plus a conditional branch ("CAN+") for some
 * visa-required nationals. The officer-facing evidence of a visitor visa —
 * funds, home ties, letters — is not part of it.
 *
 * Sources (read 2026-10-16):
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/entry-requirements-country.html
 *   https://www.canada.ca/en/immigration-refugees-citizenship/services/visit-canada/eta/eligibility/eta-x.html
 */

export const CA_TRV_VISAAI_ID = 'ca-visitor-visa-temporary-resident-visa';
const TRV_LABEL = 'Visitor visa (temporary resident visa, TRV)';

function first(
  p: Record<string, unknown>,
  keys: readonly string[],
): boolean | undefined {
  let sawFalse = false;
  for (const k of keys) {
    const v = intakeAnswerIsYes(p[k]);
    if (v === true) return true;
    if (v === false) sawFalse = true;
  }
  return sawFalse ? false : undefined;
}

/** Air / land-or-sea, from a yes/no answer or a free-text mode of travel. */
function travelsByAir(p: Record<string, unknown>): boolean | undefined {
  const yn = first(p, ['travel_by_air', 'arriving_by_air', 'flying_to_canada']);
  if (yn !== undefined) return yn;
  const mode = [p.travel_mode, p.mode_of_travel, p.arrival_mode]
    .find((v) => typeof v === 'string' && v.trim()) as string | undefined;
  if (!mode) return undefined;
  if (/\b(air|fly|flying|flight|plane|airport)\b/i.test(mode)) return true;
  if (/\b(land|car|bus|train|rail|drive|driving|boat|ship|sea|cruise|ferry)\b/i.test(mode))
    return false;
  return undefined;
}

function countryLabel(code: string): string {
  try {
    return (
      new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
    );
  } catch {
    return code;
  }
}

/**
 * Who may apply for Canada's eTA. Pure; the profile is the intake profile.
 *
 * Order matters: the "you need nothing" answers come first, because a US
 * green-card holder from a visa-required country is told to apply for nothing,
 * not for a visitor visa.
 */
export function assessEtaEligibility(
  profile: Record<string, unknown> | null | undefined,
): RouteEligibility {
  const p = profile ?? {};
  const nationality = profileNationality(p);

  if (
    nationality === 'CA' ||
    first(p, ['canadian_permanent_resident', 'is_canadian_permanent_resident']) === true
  ) {
    return {
      status: 'not_required',
      reason:
        'Canadian citizens and permanent residents do not need an eTA to enter Canada. Travel with a valid Canadian passport or PR card.',
    };
  }
  if (nationality === 'US') {
    return {
      status: 'not_required',
      reason:
        'United States citizens need neither a visa nor an eTA to visit Canada — only a valid U.S. passport when flying.',
    };
  }
  if (
    first(p, [
      'us_permanent_resident',
      'is_us_permanent_resident',
      'us_lawful_permanent_resident',
      'has_us_green_card',
      'us_green_card',
      'us_lpr',
    ]) === true
  ) {
    return {
      status: 'not_required',
      reason:
        'Lawful permanent residents of the United States do not need an eTA. Travel with your valid passport and your green card.',
    };
  }
  if (
    first(p, [
      'holds_valid_canadian_visa',
      'has_valid_canadian_visa',
      'valid_canadian_visitor_visa',
    ]) === true
  ) {
    return {
      status: 'not_required',
      reason:
        'A valid Canadian visitor visa already lets you travel to Canada — you do not need an eTA as well. You need one or the other, not both.',
    };
  }

  if (!nationality) {
    return {
      status: 'unknown',
      reason:
        'Whether you can use an eTA depends on your nationality, which we do not know yet.',
    };
  }

  const name = countryLabel(nationality);
  const byAir = travelsByAir(p);

  if (isEtaVisaExempt(nationality)) {
    if (byAir === false) {
      return {
        status: 'not_required',
        reason: `Citizens of ${name} arriving by car, bus, train or boat do not need an eTA — only a valid passport. An eTA is needed only to fly to Canada.`,
      };
    }
    return {
      status: 'eligible',
      reason: `Citizens of ${name} need an eTA to fly to Canada.`,
    };
  }

  if (isEtaConditional(nationality)) {
    if (byAir === false) {
      return {
        status: 'ineligible',
        reason: `Citizens of ${name} can use an eTA only when travelling to Canada by air. Arriving by car, bus, train or boat, you need a visitor visa (TRV).`,
        recommendedVisaaiId: CA_TRV_VISAAI_ID,
        recommendedLabel: TRV_LABEL,
      };
    }
    // The eTA interview's key and aliases, and the visitor-visa interview's
    // (`held_canadian_visa_10_years`), which they share (audit 2026-10-19).
    const canadianVisa = first(p, [
      'canadian_visa_last_10y',
      'held_canadian_visa_last_10_years',
      'had_canadian_visa_10_years',
      'held_canadian_visa_10_years',
      'held_canadian_visitor_visa',
    ]);
    const usVisa = first(p, [
      'valid_us_nonimmigrant_visa',
      'has_valid_us_visa',
      'valid_us_visa',
      'holds_us_visa',
      'has_us_visa',
    ]);
    if (canadianVisa === true || usVisa === true) {
      return {
        status: 'eligible',
        reason: `Citizens of ${name} may apply for an eTA instead of a visitor visa when flying to Canada, because ${canadianVisa === true ? 'you held a Canadian visitor visa in the past 10 years' : 'you hold a valid U.S. non-immigrant visa'}.`,
      };
    }
    if (canadianVisa === false && usVisa === false) {
      return {
        status: 'ineligible',
        reason: `Citizens of ${name} can apply for an eTA only if they held a Canadian visitor visa in the past 10 years or hold a valid U.S. non-immigrant visa. Without either, you need a visitor visa (TRV).`,
        recommendedVisaaiId: CA_TRV_VISAAI_ID,
        recommendedLabel: TRV_LABEL,
      };
    }
    return {
      status: 'unknown',
      reason: `Citizens of ${name} can use an eTA only with a Canadian visitor visa from the past 10 years or a valid U.S. non-immigrant visa.`,
    };
  }

  return {
    status: 'ineligible',
    reason: `Citizens of ${name} need a visitor visa (TRV) to travel to Canada — ${name} is not on IRCC's list of countries whose citizens can apply for an eTA.`,
    recommendedVisaaiId: CA_TRV_VISAAI_ID,
    recommendedLabel: TRV_LABEL,
  };
}

const INTERVIEW_GUIDANCE = `THIS ROUTE IS CANADA'S eTA (ELECTRONIC TRAVEL AUTHORIZATION).
- An eTA is NOT a visa. It is a short online pre-screen (CAD 7) for citizens of visa-exempt countries who FLY to Canada, plus some visa-required nationals who held a Canadian visa in the past 10 years or hold a valid U.S. non-immigrant visa (and fly).
- Ask only what IRCC's eTA form asks: the questions listed as required. Do not ask about funds, bank balances, sponsors, invitation letters, accommodation, itineraries, ties to home or a return ticket — the eTA form does not ask for them.
- Never ask the applicant to upload or type a credit card or debit card number. IRCC takes the CAD 7 fee on its own payment page at the end of the form.
- Never call this a "visitor visa" application, and never suggest a letter of explanation or cover letter — there is nowhere to send one.
- U.S. citizens, U.S. lawful permanent residents, Canadian citizens and permanent residents, and holders of a valid Canadian visitor visa do NOT need an eTA.`;

export interface EtaOpts {
  label?: string;
  compliance?: ComplianceRequirement[];
}

/**
 * The eTA program. Canada is the only country with one today; the builder
 * takes the country like every other program so the registry stays uniform.
 */
export function etaProgram(
  country: CountryCode,
  opts: EtaOpts = {},
): VisaProgramStrategy {
  return {
    id: 'eta',
    country,
    label: opts.label ?? 'Electronic travel authorization (eTA)',
    registryVisaaiIds: [CA_ETA_VISAAI_ID],
    // A passport, and nothing else: the email address and the payment card
    // are details typed into IRCC's form, never documents VisaAI holds.
    requiredDocuments: () => docs('passport'),
    // No official artifact either: not the country-wide IMM 5476 (a
    // representative on an eTA is declared on the form itself).
    documentTemplates: () => [],
    eligibilityChecks: () => [
      {
        id: 'eta_eligible_nationality',
        description:
          'Citizen of an eTA-required (visa-exempt) country, or of a CAN+ country with a Canadian visa in the past 10 years or a valid U.S. non-immigrant visa',
        evaluate: (profile) => {
          const s = assessEtaEligibility(profile).status;
          return s === 'eligible' || s === 'unknown';
        },
      },
      {
        id: 'eta_travel_by_air',
        description: 'Travelling to Canada by air',
        evaluate: (profile) => travelsByAir(profile) !== false,
      },
      {
        id: 'valid_passport',
        description: 'Valid passport from an eTA-eligible country or territory',
      },
    ],
    validationRules: () => [
      {
        id: 'passport_expiry',
        description:
          'The eTA is linked to the passport and ends when the passport expires',
        severity: 'warning',
      },
      {
        id: 'passport_number_exact',
        description:
          'The passport number must be typed exactly; a wrong number means being refused boarding',
        severity: 'error',
      },
    ],
    evidenceRules: () => [],
    riskSignals: () => [],
    complianceRequirements: () => opts.compliance ?? [],
    forms: () => [],
    assessEligibility: (profile) => assessEtaEligibility(profile),
    // Shared with the web app's progress through @visaai/types route-letters.
    requiredGeneratedDocuments: () =>
      requiredGenTypesForRoute({ country, visaaiId: CA_ETA_VISAAI_ID }),
    checklistSupplement: false,
    riskWeightOverrides: () => ({ financial_pct: 0, home_ties_pct: 0 }),
    interviewGuidance: () => INTERVIEW_GUIDANCE,
  };
}
