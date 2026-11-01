import type {
  CountryCode,
  ComplianceRequirement,
  DocumentRequirement,
  FormSpec,
} from '../types';
import type { VisaProgramStrategy } from './base-visa-program.strategy';
import { docs } from '../document-requirements/common-documents';
import { risks, evidence } from '../risk-assessment/common-risks';

export interface FamilySponsorshipOpts {
  label?: string;
  /** Country-specific sponsor-income / insurance docs (e.g. Canada Super Visa). */
  extraDocuments?: DocumentRequirement[];
  compliance?: ComplianceRequirement[];
  forms?: FormSpec[];
  /**
   * Registry routes (`visa_types.visaai_id`) this program IS. A claimed route
   * is served this program's own official artifacts, not the union of every
   * program in the country (a Canada visitor-visa route was handed the study
   * and work permit checklists).
   */
  registryVisaaiIds?: readonly string[];
}

/**
 * Family-sponsorship class (parent/grandparent/spouse). Canada Super Visa is a
 * configuration of this program. Two-operator journey: applicant + sponsor.
 */
export function familySponsorshipProgram(
  country: CountryCode,
  opts: FamilySponsorshipOpts = {},
): VisaProgramStrategy {
  return {
    id: 'family_sponsorship',
    country,
    ...(opts.registryVisaaiIds
      ? { registryVisaaiIds: opts.registryVisaaiIds }
      : {}),
    label: opts.label ?? 'Family Sponsorship',
    requiredDocuments: () => [
      ...docs(
        'passport',
        'photo',
        'proof_of_relationship',
        'proof_of_status',
        'invitation_letter',
      ),
      ...(opts.extraDocuments ?? []),
    ],
    eligibilityChecks: () => [
      {
        id: 'sponsor_status',
        description: 'Sponsor is a citizen/permanent resident',
      },
      { id: 'relationship', description: 'Qualifying family relationship' },
      {
        id: 'sponsor_income',
        description: 'Sponsor meets the minimum income requirement',
      },
    ],
    validationRules: () => [
      {
        id: 'relationship_proof',
        description: 'Relationship evidence is consistent',
        severity: 'error',
      },
    ],
    evidenceRules: () => evidence('funds_history'),
    riskSignals: () => risks('insufficient_funds', 'inconsistent_info'),
    complianceRequirements: () => opts.compliance ?? [],
    forms: () => opts.forms ?? [],
  };
}
