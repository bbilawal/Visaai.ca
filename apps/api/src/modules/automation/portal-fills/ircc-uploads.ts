import type { FillFieldMapping } from '../../../strategies/portal-integration/portal-fill.registry';
import type { Profile } from './ircc-profile';

/**
 * IRCC /doc-upload: which of the applicant's VisaAI documents goes into which
 * upload slot.
 *
 * Dry run 2026-10-17: every form page was filled by the assistant, then the
 * applicant still had to find and attach each file by hand. The assistant now
 * attaches the documents the applicant uploaded to VisaAI — only ones that
 * were read successfully and that the consultant did not reject or send back
 * for re-upload, consultant-approved first — into the slot whose label names
 * them. The slot → file pairs are mapping values like every other field, so
 * the consultant's locked review covers exactly which file goes where
 * ("Upload: Passport ← AK1182091.pdf"). The applicant still pays and submits.
 *
 * Slots are found by the TEXT of their row on the page (IRCC numbers its
 * inputs req_upload0.. / opt_upload0.. in an order that depends on the
 * applicant's answers), so each slot carries the words its row must contain.
 */

/** A document the portal fill may attach, as resolved from server state. */
export interface PortalDocument {
  id: string;
  documentType: string;
  fileName: string;
  mimeType: string;
  /** The consultant approved it (preferred over an undecided one). */
  approved: boolean;
  createdAt: string;
}

/** Key the mapping reads the application's attachable documents from. */
export const PORTAL_DOCUMENTS_KEY = '_portal_documents';

export interface UploadSlot {
  key: string;
  /** Shown in the review: "Upload: <label>". */
  label: string;
  /** Words (regex source, case-insensitive) the slot's row on the page contains. */
  rowPattern: string;
  /**
   * VisaAI document types that belong in this slot, best first. A trailing
   * `*` matches any type with that prefix.
   */
  documentTypes: readonly string[];
  category: FillFieldMapping['category'];
  /** Only when this profile answer is truthy (the representative form). */
  requires?: string;
  /**
   * A form the applicant (and others) must SIGN. Nothing on the page or in
   * the file tells a signed copy from an unsigned one, so only a document the
   * consultant APPROVED goes in — their approval is the "it is signed" check.
   * An unsigned form uploaded to IRCC gets the application returned.
   */
  signatureRequired?: boolean;
  /**
   * Only documents of these MIME types (the slot's input accepts nothing
   * else: the PR portal's PDF form rows take application/pdf only).
   */
  mimeTypes?: readonly string[];
}

/** Whether a document type is one a slot lists (`foo*` = any type starting with foo). */
function typeMatches(type: string, documentType: string): boolean {
  return type.endsWith('*')
    ? documentType.startsWith(type.slice(0, -1))
    : documentType === type;
}

export const IRCC_UPLOAD_SLOTS: readonly UploadSlot[] = [
  {
    key: 'national_id',
    label: 'National identity document',
    rowPattern: 'national identity|identity document',
    documentTypes: ['national_id'],
    category: 'passport',
  },
  {
    key: 'passport',
    label: 'Passport',
    rowPattern: '\\bpassport\\b',
    // The business visitor's registry calls it passport_valid_entire_stay,
    // and the discovered checklist passport_biographic_page (live E2E
    // 2026-10-18: the uploaded passport was "not in your VisaAI data").
    documentTypes: [
      'passport_copy',
      'passport',
      'passport_valid_entire_stay',
      'passport_biographic_page',
    ],
    category: 'passport',
  },
  {
    key: 'funds',
    label: 'Proof of financial support',
    rowPattern: 'financial|proof of (?:means|funds)',
    // bank_statement_3mo / _6mo: the discovered checklist's statements.
    documentTypes: [
      'proof_of_funds',
      'bank_statement',
      'bank_statement_*',
      'bank_statements*',
    ],
    category: 'employment',
  },
  {
    key: 'representative',
    label: 'Use of a Representative (IMM 5476)',
    rowPattern: 'representative|5476',
    documentTypes: ['imm5476', 'use_of_representative', 'representative_form'],
    category: 'addresses',
    requires: 'uses_representative',
    signatureRequired: true,
  },
];

/** "AK1182091.pdf [doc:<uuid>]" — the value the review shows and the lock covers. */
export function uploadValue(
  doc: Pick<PortalDocument, 'id' | 'fileName'>,
): string {
  return `${doc.fileName} [doc:${doc.id}]`;
}

/** The document id an upload value names, or null. */
export function documentIdOf(value: string): string | null {
  const m = /\[doc:([0-9a-f-]{36})\]\s*$/i.exec(value);
  return m ? m[1].toLowerCase() : null;
}

function documentsOf(p: Profile): PortalDocument[] {
  const v = p[PORTAL_DOCUMENTS_KEY];
  return Array.isArray(v) ? (v as PortalDocument[]) : [];
}

/** Every attachable document whose type the slot lists (any approval, any format), newest first. */
export function documentsOfSlot(
  p: Profile,
  slot: UploadSlot,
): PortalDocument[] {
  return documentsOf(p)
    .filter((d) =>
      slot.documentTypes.some((t) => typeMatches(t, d.documentType)),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * The document for a slot: the first document type in the slot's order that
 * has one, consultant-approved before undecided, newest first. Undefined when
 * there is none — the slot is then the applicant's to fill.
 */
export function documentForSlot(
  p: Profile,
  slot: UploadSlot,
): PortalDocument | undefined {
  const docs = documentsOf(p).filter(
    (d) =>
      (!slot.signatureRequired || d.approved) &&
      (!slot.mimeTypes || slot.mimeTypes.includes(d.mimeType)),
  );
  for (const type of slot.documentTypes) {
    const ofType = docs
      .filter((d) => typeMatches(type, d.documentType))
      .sort(
        (a, b) =>
          Number(b.approved) - Number(a.approved) ||
          b.createdAt.localeCompare(a.createdAt) ||
          a.id.localeCompare(b.id),
      );
    if (ofType.length) return ofType[0];
  }
  return undefined;
}

/** Selector form the content script resolves by row text: `::upload:<pattern>`. */
export const UPLOAD_SELECTOR_PREFIX = '::upload:';

/**
 * One upload write per slot on `page`. The slot list and the profile-key
 * prefix are the portal's: IRCC tr-rt /doc-upload (the default), the PR
 * portal's application page (canada-ircc-pr-family.ts, `pr_upload`).
 */
export function uploadMappings(
  page: string,
  slots: readonly UploadSlot[] = IRCC_UPLOAD_SLOTS,
  keyPrefix = 'ircc_upload',
): FillFieldMapping[] {
  return slots.map((slot) => ({
    page,
    profileKey: `${keyPrefix}_${slot.key}`,
    selector: `${UPLOAD_SELECTOR_PREFIX}${slot.rowPattern}`,
    action: 'fill',
    op: 'attach_file',
    label: `Upload: ${slot.label}`,
    category: slot.category,
    ...(slot.requires ? { requires: slot.requires } : {}),
    // A form to sign is explained by signatureNotes, not "not in your data".
    ...(slot.signatureRequired ? { silent: true } : {}),
    derive: (p: Profile) => {
      const doc = documentForSlot(p, slot);
      return doc ? uploadValue(doc) : undefined;
    },
  }));
}

/** What the applicant is told about a form to sign that the assistant will not attach. */
export interface SignatureNote {
  label: string;
  note: string;
}

/**
 * For each form to sign that is not going in: why, and what to do. `applies`
 * is the slot's own condition (the representative answer), decided by the
 * caller, which knows the profile's vocabulary.
 */
export function signatureNotes(
  p: Profile,
  applies: (slot: UploadSlot) => boolean,
  slots: readonly UploadSlot[] = IRCC_UPLOAD_SLOTS,
  wording: { unconfirmed: string; missing: string } = {
    unconfirmed:
      'Your copy in VisaAI is not confirmed as signed by your consultant yet, so the assistant will not upload it. Ask your consultant to approve the signed copy, or upload the signed form on IRCC yourself. IRCC will not let you pay until it is uploaded.',
    missing:
      'Print the pre-filled form from the Forms page, sign it, then upload the signed copy to VisaAI for your consultant to approve, or upload it on IRCC yourself. IRCC will not let you pay until it is uploaded.',
  },
): SignatureNote[] {
  const notes: SignatureNote[] = [];
  for (const slot of slots) {
    if (!slot.signatureRequired || !applies(slot)) continue;
    if (documentForSlot(p, slot)) continue;
    const ofSlot = documentsOf(p).filter((d) =>
      slot.documentTypes.some((t) => typeMatches(t, d.documentType)),
    );
    // Approved, but in a format the slot does not take (a photo of a form
    // whose slot takes PDF only).
    const wrongType =
      !!slot.mimeTypes &&
      ofSlot.some((d) => d.approved && !slot.mimeTypes!.includes(d.mimeType));
    notes.push({
      label: `Upload: ${slot.label}`,
      note: wrongType
        ? 'IRCC takes this form as a PDF only, and your approved copy in VisaAI is not a PDF, so the assistant will not upload it. Upload the signed form as a PDF to VisaAI for your consultant to approve, or on IRCC yourself.'
        : ofSlot.length > 0
          ? wording.unconfirmed
          : wording.missing,
    });
  }
  return notes;
}
