import type { CountryCode, ComplianceRequirement, FormSpec } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { docs, COMMON_DOCS } from '../document-requirements/common-documents';
import { risks, evidence } from '../risk-assessment/common-risks';

/**
 * Business visa (meetings/conferences). Generic, reused across countries.
 *
 * `registryVisaaiIds`: the registry routes this program IS (Canada:
 * `ca-business-visitors`). A claimed route is served this program's own
 * official artifacts instead of the union of every program in the country
 * (an unclaimed business route was offered the super visa's IMM 5409 and the
 * study and work permit checklists).
 */
export function businessVisaProgram(
  country: CountryCode,
  compliance: ComplianceRequirement[] = [],
  forms: FormSpec[] = [],
  registryVisaaiIds?: readonly string[],
  assessEligibility?: VisaProgramStrategy['assessEligibility'],
): VisaProgramStrategy {
  return {
    id: 'business_visa',
    country,
    ...(registryVisaaiIds ? { registryVisaaiIds } : {}),
    ...(assessEligibility ? { assessEligibility } : {}),
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
