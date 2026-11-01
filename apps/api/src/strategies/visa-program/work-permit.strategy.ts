import type { CountryCode, ComplianceRequirement, FormSpec } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { docs, COMMON_DOCS } from '../document-requirements/common-documents';
import { risks, evidence } from '../risk-assessment/common-risks';

/** Work permit / work visa. Generic, reused across countries. */
export function workPermitProgram(
  country: CountryCode,
  compliance: ComplianceRequirement[] = [],
  forms: FormSpec[] = [],
  /** A country's own route, interview and readiness settings on top. */
  overrides: Partial<VisaProgramStrategy> = {},
): VisaProgramStrategy {
  return {
    id: 'work_permit',
    country,
    forms: () => forms,
    label: 'Work Permit',
    requiredDocuments: () => [
      ...docs('passport', 'photo', 'proof_of_funds'),
      {
        ...COMMON_DOCS.employment_letter,
        required: true,
        label: 'Job offer / employment contract',
      },
    ],
    eligibilityChecks: () => [
      {
        id: 'job_offer',
        description: 'Valid job offer from an eligible employer',
      },
      { id: 'qualifications', description: 'Qualifications match the role' },
    ],
    validationRules: () => [
      {
        id: 'employer_eligible',
        description: 'Employer authorised to hire foreign workers',
        severity: 'error',
      },
    ],
    evidenceRules: () => evidence('employment'),
    riskSignals: () => risks('inconsistent_info', 'unclear_purpose'),
    complianceRequirements: () => compliance,
    ...overrides,
  };
}
