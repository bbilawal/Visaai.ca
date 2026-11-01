import type { CountryCode, ComplianceRequirement, FormSpec } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { docs } from '../document-requirements/common-documents';
import { risks, evidence } from '../risk-assessment/common-risks';

/** Tourist visa (short-stay leisure). Generic, reused across countries. */
export function touristVisaProgram(
  country: CountryCode,
  compliance: ComplianceRequirement[] = [],
  forms: FormSpec[] = [],
): VisaProgramStrategy {
  return {
    id: 'tourist_visa',
    country,
    forms: () => forms,
    label: 'Tourist Visa',
    requiredDocuments: () =>
      docs(
        'passport',
        'photo',
        'proof_of_funds',
        'travel_itinerary',
        'medical_insurance',
      ),
    eligibilityChecks: () => [
      {
        id: 'valid_passport',
        description: 'Passport valid for the duration of stay',
      },
      { id: 'return_ticket', description: 'Return or onward travel evidence' },
    ],
    validationRules: () => [
      {
        id: 'passport_expiry',
        description: 'Passport valid past travel dates',
        severity: 'error',
      },
    ],
    evidenceRules: () => evidence('funds_history', 'itinerary'),
    riskSignals: () => risks('insufficient_funds', 'unclear_purpose'),
    complianceRequirements: () => compliance,
  };
}
