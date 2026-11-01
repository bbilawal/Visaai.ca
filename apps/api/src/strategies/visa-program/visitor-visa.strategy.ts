import type { CountryCode } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { docs } from '../document-requirements/common-documents';
import { risks, evidence } from '../risk-assessment/common-risks';
import type {
  DocumentRequirement,
  ComplianceRequirement,
  FormSpec,
} from '../types';

export interface VisitorVisaOpts {
  label?: string;
  extraDocuments?: DocumentRequirement[];
  compliance?: ComplianceRequirement[];
  forms?: FormSpec[];
}

/**
 * Generic visitor-visa program reused by any country (Canada TRV, UK Standard
 * Visitor, US B2, etc). Countries pass their compliance regimes + any extra docs
 * (e.g. a country-specific form). Demonstrates a program strategy shared across
 * countries with no per-country branching in the core.
 */
export function visitorVisaProgram(
  country: CountryCode,
  opts: VisitorVisaOpts = {},
): VisaProgramStrategy {
  return {
    id: 'visitor_visa',
    country,
    label: opts.label ?? 'Visitor Visa',
    requiredDocuments: () => [
      ...docs('passport', 'photo', 'proof_of_funds', 'travel_itinerary'),
      ...(opts.extraDocuments ?? []),
    ],
    eligibilityChecks: () => [
      {
        id: 'valid_passport',
        description: 'Passport valid for the duration of stay',
      },
      {
        id: 'sufficient_funds',
        description: 'Demonstrated funds to cover the trip',
      },
      {
        id: 'intent_to_return',
        description: 'Evidence of intent to return home',
      },
    ],
    validationRules: () => [
      {
        id: 'passport_expiry',
        description: 'Passport must not expire before travel',
        severity: 'error',
      },
      {
        id: 'name_consistency',
        description: 'Name matches across all documents',
        severity: 'warning',
      },
    ],
    evidenceRules: () => evidence('employment', 'funds_history', 'itinerary'),
    riskSignals: () =>
      risks(
        'weak_home_ties',
        'insufficient_funds',
        'unclear_purpose',
        'prior_refusal',
      ),
    complianceRequirements: () => opts.compliance ?? [],
    forms: () => opts.forms ?? [],
  };
}
