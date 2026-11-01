import type {
  CountryCode,
  VisaProgramId,
  DocumentRequirement,
  EligibilityCheck,
  ValidationRule,
  EvidenceRule,
  RiskSignal,
  ComplianceRequirement,
  FormSpec,
  DocumentTemplateSpec,
} from '../types';

/**
 * A visa program for a specific country (e.g. Canada visitor visa). Defines
 * everything the pipeline needs without the pipeline knowing the country/program.
 */
export interface VisaProgramStrategy {
  readonly id: VisaProgramId;
  readonly country: CountryCode;
  readonly label: string;
  requiredDocuments(): DocumentRequirement[];
  eligibilityChecks(): EligibilityCheck[];
  validationRules(): ValidationRule[];
  evidenceRules(): EvidenceRule[];
  riskSignals(): RiskSignal[];
  complianceRequirements(): ComplianceRequirement[];
  /** Official government forms for this program (resolved to renderers elsewhere). */
  forms?(): FormSpec[];
  /**
   * Official artifacts that support the REQUIRED DOCUMENTS — checklists, photo
   * specifications, declaration templates, route guidance.
   *
   * Optional, and unimplemented by the shared program factories on purpose:
   * these artifacts are per-authority, so the default source is the declarative
   * table in document-requirements/document-templates.ts. A program overrides
   * this only when it needs artifacts that the country-level table cannot
   * express. Resolution order lives in DocumentTemplateCatalog.
   */
  documentTemplates?(): DocumentTemplateSpec[];
}

/**
 * Convenience base so a concrete program is just data. Override only what differs.
 */
export abstract class BaseVisaProgramStrategy implements VisaProgramStrategy {
  abstract readonly id: VisaProgramId;
  abstract readonly country: CountryCode;
  abstract readonly label: string;

  requiredDocuments(): DocumentRequirement[] {
    return [];
  }
  eligibilityChecks(): EligibilityCheck[] {
    return [];
  }
  validationRules(): ValidationRule[] {
    return [];
  }
  evidenceRules(): EvidenceRule[] {
    return [];
  }
  riskSignals(): RiskSignal[] {
    return [];
  }
  complianceRequirements(): ComplianceRequirement[] {
    return [];
  }
}
