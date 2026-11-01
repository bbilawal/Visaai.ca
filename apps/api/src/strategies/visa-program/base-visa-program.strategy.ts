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

  // ── Route-aware behaviour (all optional; absent = today's defaults) ───────
  //
  // Added for Canada's eTA (dry run 2026-10-16), which the pipeline treated as
  // a visitor visa end to end. Each member below replaces one hard-coded
  // visitor-visa assumption; a program that leaves them out keeps behaving
  // exactly as before.

  /**
   * Registry visa types (`visa_types.visaai_id`) this program IS. Lets the
   * pipeline find the program from the route an applicant picked — see
   * StrategyRegistry.resolveRoute.
   */
  readonly registryVisaaiIds?: readonly string[];
  /**
   * Can THIS applicant use this program? Run when the route is chosen and
   * during the interview. Absent = no program-level eligibility gate.
   */
  assessEligibility?(profile: Record<string, unknown>): RouteEligibility;
  /**
   * Generated letters the program needs approved. Absent = the default pair
   * (LOE + cover letter). The shared source is @visaai/types route-letters.
   */
  requiredGeneratedDocuments?(): string[];
  /**
   * May discovery add strengthening evidence to a thin sourced checklist?
   * Absent = true. A program whose official list is short BY DESIGN sets false.
   */
  readonly checklistSupplement?: boolean;
  /**
   * Readiness-weight overrides keyed by the VRI factor (`financial_pct`, ...).
   * A 0 removes the factor from the score and from the recommendations.
   */
  riskWeightOverrides?(): Partial<Record<string, number>>;
  /** Route-specific brief for the intake interviewer. */
  interviewGuidance?(): string;
}

export type RouteEligibilityStatus =
  /** The applicant can use this program. */
  | 'eligible'
  /** They cannot — another program is the right one. */
  | 'ineligible'
  /** They need nothing at all for this trip (e.g. a US citizen and the eTA). */
  | 'not_required'
  /** Not enough is known yet; the interview asks. */
  | 'unknown';

export interface RouteEligibility {
  status: RouteEligibilityStatus;
  /** Plain-language reason, safe to show the applicant. */
  reason: string;
  /** The registry route to use instead, when there is one. */
  recommendedVisaaiId?: string;
  recommendedLabel?: string;
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
