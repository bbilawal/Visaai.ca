/**
 * Which routes ask for the applicant's FAMILY on the official form, and where
 * a family document is obtained in the country that issued it.
 *
 * Dry run 2026-10-15 (Canada visitor visa, Pakistani applicant): IRCC's form
 * asks for the spouse's and every child's date of birth. VisaAI reads those
 * from civil documents (sync-family.ts), and a document the client never
 * uploaded used to leave the field silently empty. The owner's rule: a
 * document the client has not provided is a MISSING document, requested from
 * the client on the checklist.
 *
 * Configuration, not code: a route is added here by its registry id, and a
 * country's guidance by its ISO code. Nothing in the gap logic names Canada
 * or Pakistan.
 */

export interface FamilyDocumentGapRoute {
  /** Stable id, for logs. */
  id: string;
  /**
   * `visa_types.visaai_id` values this route covers, matched as a prefix:
   * 'ca-visitor' covers 'ca-visitor-visa-temporary-resident-visa'.
   */
  visaaiIdPrefixes: string[];
  /** The form section the family facts are needed for — shown on the item. */
  formSection: string;
}

export const FAMILY_DOCUMENT_GAP_ROUTES: FamilyDocumentGapRoute[] = [
  {
    id: 'ca-visitor',
    // Every route filing IRCC tr-rt (IMM 5257) asks the same family section:
    // the business visitor and the super visa were missed by the prefix.
    visaaiIdPrefixes: ['ca-visitor', 'ca-business-visitors', 'ca-super-visa'],
    formSection:
      'IRCC asks for the date of birth of your spouse and of every child in the family section of the application (IMM 5257 / IMM 5645).',
  },
];

/** Where each family document is obtained in one issuing country. */
export interface IssuingCountryGuidance {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** Lower-case names, demonyms and codes a profile may hold for it. */
  names: string[];
  birthCertificate: string;
  spouseIdentity: string;
  marriageCertificate: string;
  /** The country's own name for the marriage certificate, for the label. */
  marriageCertificateName?: string;
}

export const ISSUING_COUNTRY_GUIDANCE: IssuingCountryGuidance[] = [
  {
    code: 'PK',
    names: ['pk', 'pak', 'pakistan', 'pakistani'],
    birthCertificate:
      "Pakistan: the computerised birth registration certificate issued by the Union Council where the birth was registered (NADRA CRMS), or NADRA's Child Registration Certificate (B-Form). An attested copy can be requested from the Union Council or a NADRA Registration Centre.",
    spouseIdentity:
      "Pakistan: your spouse's own CNIC / SNIC (front and back) or passport bio page. A replacement card can be ordered from NADRA (Pak-Identity) if it is lost.",
    marriageCertificate:
      "Pakistan: the nikah nama, together with the Union Council's NADRA computerised marriage registration certificate (MRC).",
    marriageCertificateName: 'nikah nama',
  },
];

/** Used when the issuing country is unknown or has no entry above. */
export const DEFAULT_FAMILY_GUIDANCE = {
  birthCertificate:
    'The civil registry office (or equivalent authority) where the birth was registered.',
  spouseIdentity:
    "Your spouse's own national identity card or passport bio page.",
  marriageCertificate:
    'The civil registry office (or religious authority) where the marriage was registered.',
};
