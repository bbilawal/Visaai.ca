/**
 * Shared types for the global visa strategy system. Strategies are mostly
 * DECLARATIVE data so a new country or program can be added by writing a
 * strategy object and registering it — no changes to core application logic.
 */

export type CountryCode =
  | 'CA'
  | 'US'
  | 'GB'
  | 'AU'
  | 'NZ'
  | 'SCHENGEN'
  | 'AE'
  | 'SA'
  | 'SG'
  | 'JP'
  // Registry-sourced destinations (country/registry-destinations.ts)
  | 'CN'
  | 'EG'
  | 'HK'
  | 'IE'
  | 'JO'
  | 'LB'
  | 'MY'
  | 'OM'
  | 'QA'
  | 'TH'
  | 'TR'
  // Schengen members (selectable; share Schengen Type C logic)
  | 'AT'
  | 'BE'
  | 'HR'
  | 'CZ'
  | 'DK'
  | 'EE'
  | 'FI'
  | 'FR'
  | 'DE'
  | 'GR'
  | 'HU'
  | 'IS'
  | 'IT'
  | 'LV'
  | 'LI'
  | 'LT'
  | 'LU'
  | 'MT'
  | 'NL'
  | 'NO'
  | 'PL'
  | 'PT'
  | 'SK'
  | 'SI'
  | 'ES'
  | 'SE'
  | 'CH'
  | string; // open set: future countries

export type VisaProgramId =
  | 'visitor_visa'
  | 'tourist_visa'
  | 'business_visa'
  | 'student_visa'
  | 'work_permit'
  | 'family_sponsorship'
  | string;

export type Owner = 'applicant' | 'sponsor';

export interface DocumentRequirement {
  code: string;
  label: string;
  required: boolean;
  ownedBy?: Owner;
  acceptedMimeTypes?: string[];
  notes?: string;
}

export interface EligibilityCheck {
  id: string;
  description: string;
  /** Optional predicate over a free-form profile; absent = manual/advisory. */
  evaluate?: (profile: Record<string, unknown>) => boolean;
}

export interface ValidationRule {
  id: string;
  description: string;
  severity: 'error' | 'warning';
}

export interface EvidenceRule {
  id: string;
  description: string;
  strengthens: string; // which refusal risk it mitigates, e.g. 'home_ties'
}

export interface RiskSignal {
  id: string;
  description: string;
  weight: number; // 0..1 contribution to refusal risk
}

export type ComplianceRegime =
  | 'GDPR'
  | 'UK_GDPR'
  | 'PIPEDA'
  | 'AUS_PRIVACY_PRINCIPLES'
  | 'PDPA_SG'
  | 'APPI_JP'
  | 'UAE_PDPL'
  | 'SA_PDPL'
  | 'PIPL_CN'
  | 'PDPO_HK'
  | 'PDPA_MY'
  | 'PDPA_TH'
  | 'NZ_PRIVACY_ACT'
  | 'KVKK_TR'
  | 'PDPL_EG'
  | 'PDPL_JO'
  | 'PDPL_OM'
  | 'PDPPL_QA'
  | 'LB_ETPD'
  | string;

export interface ComplianceRequirement {
  regime: ComplianceRegime;
  description: string;
}

export interface DataResidency {
  /** Processing region for OCR/storage/queues, e.g. 'ca-central-1', 'eu'. */
  region: string;
  /** Legal jurisdiction governing the data, e.g. 'CA', 'EU', 'UK'. */
  jurisdiction: string;
}

export interface FormSpec {
  /** Official form identifier, e.g. 'IMM 5257', 'DS-160', 'VAF1A'. */
  formCode: string;
  formName: string;
  sourceUrl?: string;
}

/**
 * What an official document artifact IS, so the UI can label it honestly.
 *
 *   checklist      the authority's own list of what to submit (IMM 5484)
 *   guide          instructions/caseworker guidance for the route
 *   declaration    a template the applicant fills in and submits (IMM 5409)
 *   specification  a standard an applicant-supplied document must meet
 *                  (the ICAO photograph guidelines behind "passport photo")
 *   instructions   the filing instructions that accompany a form (i-130instr)
 */
export type DocumentTemplateKind =
  | 'checklist'
  | 'guide'
  | 'declaration'
  | 'specification'
  | 'instructions';

/**
 * An official artifact that supports a REQUIRED DOCUMENT rather than being the
 * application form itself.
 *
 * FormSpec covers "the form you fill in and file". This covers everything the
 * authority publishes ABOUT the documents you must gather: the document
 * checklist, the photo specification, the statutory declaration template, the
 * instruction booklet. Applicants download these by hand today, once per
 * application, from pages that move — the same problem the form cache already
 * solved, on the other half of the submission package.
 */
export interface DocumentTemplateSpec {
  /**
   * Stable id, unique per (country, program). Doubles as the discovery
   * filename hint, so it must resemble how the authority names the file:
   * 'IMM 5484' → imm5484e.pdf, 'I-130INSTR' → i-130instr.pdf.
   */
  templateCode: string;
  templateName: string;
  kind: DocumentTemplateKind;
  /**
   * The DocumentRequirement.code this artifact supports, when it supports one
   * specific document. Null/absent = it covers the whole application (a
   * checklist or a route guide).
   */
  documentCode?: string;
  /** Official landing page, or the PDF itself where the authority's URL is stable. */
  sourceUrl: string;
  /**
   * How the cached copy is resolved:
   *   'pdf'  discover + download + cache (the default)
   *   'link' the authority publishes this as a web page only, or robots.txt
   *          disallows the file — never fetch it, always serve the link.
   * Declaring 'link' is not a degradation: it is the honest state, and it
   * keeps the nightly job from re-failing on something we know it cannot take.
   */
  resolve?: 'pdf' | 'link';
  /**
   * Filename match used by discovery when the landing page carries several
   * PDFs. `exact` requires the whole filename (USCIS lists i-130.pdf,
   * i-130a.pdf and i-130instr.pdf side by side, so a substring test picks the
   * wrong one). Absent = derive from templateCode.
   */
  match?: { filename: string; exact?: boolean };
}

export interface PortalIntegration {
  /** Stable id of the government portal, e.g. 'ircc', 'uk-gov-visa'. */
  portalId: string;
  /** Public portal/account URL the applicant uses to submit. */
  portalUrl: string;
  /** Whether VisaAI offers assisted auto-fill for this portal. */
  assistedFill: boolean;
}
