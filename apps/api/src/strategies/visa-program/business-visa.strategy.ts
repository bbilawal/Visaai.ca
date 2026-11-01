import type { CountryCode, ComplianceRequirement, FormSpec } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { docs, COMMON_DOCS } from '../document-requirements/common-documents';
import { risks, evidence } from '../risk-assessment/common-risks';

/** Business visa (meetings/conferences). Generic, reused across countries. */
export function businessVisaProgram(
  country: CountryCode,
  compliance: ComplianceRequirement[] = [],
  forms: FormSpec[] = [],
): VisaProgramStrategy {
  return {
    id: 'business_visa',
    country,
    forms: () => forms,
    label: 'Business Visa',
    requiredDocuments: () => [
      ...docs('passport', 'photo', 'employment_letter', 'proof_of_funds'),
      {
        ...COMMON_DOCS.invitation_letter,
        required: true,
        ownedBy: 'sponsor',
        label: 'Business invitation letter',
      },
    ],
    eligibilityChecks: () => [
      {
        id: 'valid_passport',
        description: 'Passport valid for the duration of stay',
      },
      {
        id: 'business_purpose',
        description: 'Clear, documented business purpose',
      },
    ],
    validationRules: () => [
      {
        id: 'employer_match',
        description: 'Employer matches invitation',
        severity: 'warning',
      },
    ],
    evidenceRules: () => evidence('employment'),
    riskSignals: () => risks('unclear_purpose', 'weak_home_ties'),
    complianceRequirements: () => compliance,
  };
}
