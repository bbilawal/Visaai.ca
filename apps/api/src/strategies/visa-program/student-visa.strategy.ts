import type { CountryCode, ComplianceRequirement, FormSpec } from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { docs } from '../document-requirements/common-documents';
import { risks, evidence } from '../risk-assessment/common-risks';

/** Student visa / study permit. Generic, reused across countries. */
export function studentVisaProgram(
  country: CountryCode,
  compliance: ComplianceRequirement[] = [],
  /** Country-specific display label, e.g. 'Student visa (subclass 500)'. */
  label = 'Student Visa',
  forms: FormSpec[] = [],
  /** A country's own route, interview and readiness settings on top. */
  overrides: Partial<VisaProgramStrategy> = {},
): VisaProgramStrategy {
  return {
    id: 'student_visa',
    country,
    label,
    forms: () => forms,
    requiredDocuments: () =>
      docs(
        'passport',
        'photo',
        'admission_letter',
        'proof_of_funds',
        'medical_insurance',
      ),
    eligibilityChecks: () => [
      {
        id: 'admission',
        description: 'Valid admission/enrolment at a recognised institution',
      },
      { id: 'tuition_funds', description: 'Funds for tuition + living costs' },
    ],
    validationRules: () => [
      {
        id: 'institution_recognised',
        description: 'Institution is on the recognised list',
        severity: 'error',
      },
    ],
    evidenceRules: () => evidence('funds_history'),
    riskSignals: () =>
      risks('insufficient_funds', 'unclear_purpose', 'weak_home_ties'),
    complianceRequirements: () => compliance,
    ...overrides,
  };
}
