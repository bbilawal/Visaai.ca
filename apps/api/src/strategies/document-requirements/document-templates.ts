import type { DocumentTemplateSpec, VisaProgramId } from '../types';
import { SCHENGEN_MEMBER_CODES } from '../country/schengen-members';

/**
 * The official artifacts that support an application's REQUIRED DOCUMENTS —
 * document checklists, photo specifications, declaration templates, filing
 * instructions and route guidance.
 *
 * WHY THIS TABLE AND NOT A FIELD ON DocumentRequirement
 *
 * A DocumentRequirement ('passport', 'proof_of_funds') is generic and shared
 * across every country by design — COMMON_DOCS is composed, not copied. The
 * artifact that DESCRIBES that requirement is the opposite: it is issued by one
 * authority, for one route, at one URL. Hanging a URL off the shared
 * requirement would force a per-country fork of the shared object. Keying by
 * (country, program) instead keeps `docs('passport', …)` untouched and makes
 * adding a country one entry here, exactly like strategies/index.ts.
 *
 * EVERY URL BELOW WAS FETCHED AND VERIFIED ON 2026-08-13.
 * Recorded per entry: the HTTP status, and the file the landing page actually
 * resolves to. An entry whose source cannot be verified does not belong here —
 * a fabricated government URL is worse than no entry at all, because the
 * applicant would file against it.
 *
 * `PROGRAM_WILDCARD` applies an entry to every program a country registers.
 * Country-level entries and program-level entries are merged; templateCode
 * decides identity, and a program-level entry wins over a wildcard one.
 */
export const PROGRAM_WILDCARD = '*';

// A VisaProgramId, or PROGRAM_WILDCARD. Written as the bare alias because
// VisaProgramId is itself an open `… | string` set, so spelling the union out
// would be a no-op the compiler flags as redundant.
type ProgramKey = VisaProgramId;

/** country code (upper case) → program id (or '*') → the artifacts. */
export type DocumentTemplateTable = Record<
  string,
  Partial<Record<ProgramKey, DocumentTemplateSpec[]>>
>;

// ---------------------------------------------------------------------------
// Canada — IRCC (canada.ca)
// ---------------------------------------------------------------------------
// Landing pages are stable; the PDF they link to carries the revision date in
// its path (…/imm5484/01-05-2026/imm5484e.pdf), which is why these are
// landing-page entries and never deep links.
//
// IMM 5476 is 'link': canada.ca/robots.txt disallows
// /content/dam/ircc/documents/pdf/english/kits/forms/imm5476/ outright
// (verified 2026-08-13). We do not fetch what a site has asked us not to
// fetch, and declaring it here keeps the nightly job from re-discovering that
// refusal every night.
const IRCC_GUIDES =
  'https://www.canada.ca/en/immigration-refugees-citizenship/services/application/application-forms-guides';

const IMM_5484: DocumentTemplateSpec = {
  templateCode: 'IMM 5484',
  templateName:
    'Document Checklist: Temporary Resident Visa (Visitor Visa) outside Canada',
  kind: 'checklist',
  sourceUrl: `${IRCC_GUIDES}/imm5484.html`, // 200 → imm5484e.pdf (276 KB)
};

const IMM_5476: DocumentTemplateSpec = {
  templateCode: 'IMM 5476',
  templateName: 'Use of a Representative',
  kind: 'declaration',
  sourceUrl: `${IRCC_GUIDES}/imm5476.html`, // 200; PDF path robots-disallowed
  resolve: 'link',
};

const CANADA: DocumentTemplateTable[string] = {
  [PROGRAM_WILDCARD]: [IMM_5476],
  visitor_visa: [IMM_5484],
  business_visa: [IMM_5484],
  // Claimed only by the Super Visa (parents and grandparents). IMM 5409, the
  // common-law declaration, is a spousal/partner form and was removed
  // 2026-11-01; spousal sponsorship has its own program with no templates.
  family_sponsorship: [IMM_5484],
  student_visa: [
    {
      templateCode: 'IMM 5483',
      templateName: 'Document Checklist: Study Permit',
      kind: 'checklist',
      sourceUrl: `${IRCC_GUIDES}/imm5483.html`, // 200 → imm5483e.pdf (1.0 MB)
    },
  ],
  work_permit: [
    {
      templateCode: 'IMM 5488',
      templateName: 'Document Checklist: Work Permit (applied outside Canada)',
      kind: 'checklist',
      sourceUrl: `${IRCC_GUIDES}/imm5488.html`, // 200 → imm5488e.pdf (2.8 MB)
    },
  ],
};

// ---------------------------------------------------------------------------
// United States — USCIS + Department of State
// ---------------------------------------------------------------------------
// A USCIS form page lists the form, its supplement and its instructions side
// by side (i-130.pdf, i-130a.pdf, i-130instr.pdf), so every entry here pins an
// EXACT filename. A substring match would hand the applicant the wrong file
// under the right label — the failure uscis.discovery.ts already documents.
//
// B-1/B-2 has no downloadable package: the application is DS-160, filed
// online, and travel.state.gov's document guidance is a web page (and 403s a
// crawler UA). It is therefore 'link' — the applicant gets the official page,
// which is exactly what they have today.
const USA: DocumentTemplateTable[string] = {
  visitor_visa: [
    {
      templateCode: 'DS-160-DOCS',
      templateName: 'Visitor visa (B-1/B-2): required documents',
      kind: 'checklist',
      sourceUrl:
        'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html',
      resolve: 'link',
    },
  ],
  business_visa: [
    {
      templateCode: 'DS-160-DOCS',
      templateName: 'Visitor visa (B-1/B-2): required documents',
      kind: 'checklist',
      sourceUrl:
        'https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html',
      resolve: 'link',
    },
  ],
  family_sponsorship: [
    {
      templateCode: 'I-130INSTR',
      templateName: 'Instructions for Petition for Alien Relative (I-130)',
      kind: 'instructions',
      sourceUrl: 'https://www.uscis.gov/i-130', // 200 → i-130instr.pdf (287 KB)
      match: { filename: 'i-130instr.pdf', exact: true },
    },
    {
      templateCode: 'I-130A',
      templateName: 'Supplemental Information for Spouse Beneficiary (I-130A)',
      kind: 'declaration',
      documentCode: 'proof_of_relationship',
      sourceUrl: 'https://www.uscis.gov/i-130', // 200 → i-130a.pdf
      match: { filename: 'i-130a.pdf', exact: true },
    },
    {
      templateCode: 'I-864',
      templateName: 'Affidavit of Support Under Section 213A of the INA',
      kind: 'declaration',
      documentCode: 'proof_of_status',
      sourceUrl: 'https://www.uscis.gov/i-864', // 200 → i-864.pdf (540 KB)
      match: { filename: 'i-864.pdf', exact: true },
    },
    {
      templateCode: 'I-864INSTR',
      templateName: 'Instructions for Affidavit of Support (I-864)',
      kind: 'instructions',
      sourceUrl: 'https://www.uscis.gov/i-864', // 200 → i-864instr.pdf (342 KB)
      match: { filename: 'i-864instr.pdf', exact: true },
    },
  ],
};

// ---------------------------------------------------------------------------
// United Kingdom — GOV.UK
// ---------------------------------------------------------------------------
// GOV.UK publishes route guidance as a PDF on assets.publishing.service.gov.uk
// under a media id that changes with each edition, so these are landing-page
// entries matched by filename. That host serves no robots.txt (404 → allow),
// verified 2026-08-13.
const UK: DocumentTemplateTable[string] = {
  [PROGRAM_WILDCARD]: [
    {
      templateCode: 'UKV-DOCS',
      templateName: 'Standard Visitor: documents you must provide',
      kind: 'checklist',
      sourceUrl:
        'https://www.gov.uk/standard-visitor/documents-you-must-provide',
      resolve: 'link', // 200, web page only — carries no PDF
    },
  ],
  visitor_visa: [
    {
      templateCode: 'UKV-VISIT-GUIDANCE',
      templateName: 'Visit: caseworker guidance',
      kind: 'guide',
      sourceUrl: 'https://www.gov.uk/government/publications/visit-guidance', // 200 → Visit.pdf (707 KB)
      match: { filename: 'visit.pdf', exact: true },
    },
  ],
  student_visa: [
    {
      templateCode: 'UKV-STUDENT-GUIDANCE',
      templateName: 'Student route: caseworker guidance',
      kind: 'guide',
      sourceUrl:
        'https://www.gov.uk/government/publications/points-based-system-student-route', // 200 → Student_and_Child_Student.pdf (1.0 MB)
      match: { filename: 'student_and_child_student.pdf', exact: true },
    },
  ],
};

// ---------------------------------------------------------------------------
// Australia — Department of Home Affairs
// ---------------------------------------------------------------------------
// Home Affairs form URLs are stable and unversioned, and its forms index is
// JS-rendered with no hrefs to discover (see au-home-affairs.discovery.ts), so
// sourceUrl IS the PDF. The host 403s the crawler UA shape and is already in
// http.ts's HOST_HEADER_OVERRIDES; all three verified 200 application/pdf on
// 2026-08-13 with that identity, and robots.txt does not disallow
// /form-listing/forms/.
const AU_FORM = 'https://immi.homeaffairs.gov.au/form-listing/forms';

const AUSTRALIA: DocumentTemplateTable[string] = {
  [PROGRAM_WILDCARD]: [
    {
      templateCode: '80',
      templateName:
        'Form 80: Personal particulars for assessment including character assessment',
      kind: 'declaration',
      sourceUrl: `${AU_FORM}/80.pdf`, // 200 application/pdf (610 KB)
    },
    {
      templateCode: '956',
      templateName:
        'Form 956: Appointment of a registered migration agent, legal practitioner or exempt person',
      kind: 'declaration',
      sourceUrl: `${AU_FORM}/956.pdf`, // 200 application/pdf (315 KB)
    },
  ],
  visitor_visa: [
    {
      templateCode: '1229',
      templateName:
        'Form 1229: Consent to grant an Australian visa to a child under 18',
      kind: 'declaration',
      sourceUrl: `${AU_FORM}/1229.pdf`, // 200 application/pdf (283 KB)
    },
  ],
  student_visa: [
    {
      templateCode: '1229',
      templateName:
        'Form 1229: Consent to grant an Australian visa to a child under 18',
      kind: 'declaration',
      sourceUrl: `${AU_FORM}/1229.pdf`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Schengen — European Commission
// ---------------------------------------------------------------------------
// The photograph standard is laid down area-wide, so one cached copy serves
// the bloc and all 27 selectable members — the same "one document, many
// countries" shape the harmonised application form already has, and the
// refresh job's per-run dedupe means it is fetched once, not 28 times.
const SCHENGEN_TEMPLATES: DocumentTemplateSpec[] = [
  {
    templateCode: 'ICAO-PHOTO',
    templateName: 'Photograph guidelines for a Schengen visa (ICAO standard)',
    kind: 'specification',
    documentCode: 'photo',
    sourceUrl:
      'https://home-affairs.ec.europa.eu/policies/schengen/visa-policy/applying-schengen-visa_en',
    // The page carries five PDFs behind UUID download links; the filename is
    // in the query string. Substring, because the href is
    // /document/download/<uuid>_en?filename=icao_photograph_guidelines_en.pdf
    match: { filename: 'icao_photograph_guidelines' },
  },
];

const SCHENGEN: DocumentTemplateTable[string] = {
  [PROGRAM_WILDCARD]: SCHENGEN_TEMPLATES,
};

/**
 * Every Schengen member state applies the area-wide rules, so each selectable
 * member gets the same entries. The member list is IMPORTED, never restated:
 * a hand-copied list here would silently miss the next accession the way it
 * would have missed Bulgaria and Romania (migration 20260806150000).
 */
export const DOCUMENT_TEMPLATE_TABLE: DocumentTemplateTable = {
  CA: CANADA,
  US: USA,
  GB: UK,
  AU: AUSTRALIA,
  SCHENGEN,
  ...Object.fromEntries(SCHENGEN_MEMBER_CODES.map((c) => [c, SCHENGEN])),
};

/**
 * The artifacts for one (country, program): the country's wildcard entries
 * plus the program's own, deduped by templateCode with the program-level entry
 * winning — a program that names a more specific artifact under the same code
 * must not be shadowed by the country-wide default.
 */
export function documentTemplatesFor(
  countryCode: string,
  programId: string,
): DocumentTemplateSpec[] {
  const country = DOCUMENT_TEMPLATE_TABLE[countryCode.toUpperCase()];
  if (!country) return [];

  const byCode = new Map<string, DocumentTemplateSpec>();
  for (const spec of country[PROGRAM_WILDCARD] ?? []) {
    byCode.set(spec.templateCode, spec);
  }
  for (const spec of country[programId] ?? []) {
    byCode.set(spec.templateCode, spec);
  }
  return [...byCode.values()];
}
