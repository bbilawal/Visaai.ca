import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { safeLog } from '../../../shared/log/redact';
import { identityRole } from './identity-compare';
import {
  agreementInIdentitySlot,
  agreementKind,
  civilRecordInRelationshipSlot,
  classifyDocumentText,
  isIdCardType,
  refineIdentityFields,
  slotContentMismatch,
} from './classify-document';
import { isPhotoDocumentType } from '../../ocr/extraction-schema';

/**
 * classify_document node (after run_ocr + derive_fields).
 *
 * 1. A generic upload ("Additional document" slot, unrecognisable filename) is
 *    re-typed from its OCR text when the text is unambiguous, and the type is
 *    persisted on documents.document_type — so an IRCC refusal letter becomes
 *    supporting evidence and stops being compared against the passport.
 *    A type chosen by a checklist slot is never overridden — except that a
 *    civil record (birth / marriage certificate) recognised in a broad
 *    relationship slot is stored as that civil record. Only the type
 *    changes; the document stays linked to the slot it was dropped into.
 *    Likewise a document typed as an ID card whose text is plainly a lease
 *    or other contract (agreementKind) is stored as that agreement — the
 *    re-read of one misfiled before, or a lease dropped into the ID slot,
 *    which then fails against that slot.
 * 2. A document in a typed slot is checked against that slot
 *    (slotContentMismatch): a passport bio page dropped into "evidence of
 *    previous travel" fails with a message saying what it is and what the
 *    slot wants, instead of passing as verified.
 * 3. Identity fields are made trustworthy (see refineIdentityFields): no DOB
 *    from a non-identity document unless it is printed beside a birth label;
 *    an ID card keeps the holder's name, not the father's/husband's, and its
 *    number as national_id_number; sex is read from the MRZ / card label.
 */
/** Below this much text a "read" is a failed scan, not a document. */
const MIN_READABLE_CHARS = 200;

/**
 * The checklist slot the document was uploaded into: `{ slotType }`, with
 * null for an "Additional document" upload; or null when the lookup failed.
 * `documents.document_type` cannot tell: it is the slot's type or an earlier
 * classification.
 */
async function uploadSlot(
  supabase: SupabaseClient,
  documentId: string,
): Promise<{ slotType: string | null } | null> {
  try {
    const { data: doc, error } = await supabase
      .from('documents')
      .select('checklist_item_id')
      .eq('id', documentId)
      .maybeSingle();
    if (error || !doc) return null;
    const itemId = (doc as { checklist_item_id?: unknown }).checklist_item_id;
    if (typeof itemId !== 'string' || !itemId) return { slotType: null };
    const { data: item, error: itemErr } = await supabase
      .from('checklist_items')
      .select('document_type')
      .eq('id', itemId)
      .maybeSingle();
    if (itemErr || !item) return null;
    const slotType = (item as { document_type?: unknown }).document_type;
    return typeof slotType === 'string' ? { slotType } : null;
  } catch {
    return null;
  }
}

export function makeClassifyDocumentNode(supabase: SupabaseClient) {
  return async function classifyDocument(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};

    let documentType = state.documentType;
    let classifiedFromContent = false;

    // Dry run 2026-10-15: a NADRA birth registration certificate uploaded to
    // the sponsor's proof-of-relationship slot was stored as
    // `sponsor_proof_of_relationship`, so nothing downstream knew it was a
    // birth certificate.
    let inferred =
      identityRole(documentType) === 'generic'
        ? classifyDocumentText(state.rawOcrText)
        : civilRecordInRelationshipSlot(documentType, state.rawOcrText);
    // Prod 2026-10-19: two shop lease deeds were filed as `national_id`, the
    // landlord's CNIC their "national ID number". A re-read keeps the stored
    // type, so an ID-card type is checked against the text too — as deed
    // versus card, the same question classifyDocumentText's ID rule asks.
    const idTypedAgreement =
      !inferred && isIdCardType(documentType)
        ? agreementKind(state.rawOcrText, { againstIdCard: true })
        : null;
    const storedType = documentType;
    if (idTypedAgreement) inferred = idTypedAgreement;
    if (inferred) {
      documentType = inferred;
      classifiedFromContent = true;
      const { error } = await supabase
        .from('documents')
        .update({ document_type: inferred })
        .eq('id', state.documentId);
      if (error) {
        safeLog.warn(
          'documents.classify',
          `failed to persist inferred type for ${state.documentId}: ${error.message}`,
        );
      }
    }

    // Only a slot-typed upload can be in the wrong slot; a re-typed one was
    // just classified from this same text. The exception is an agreement
    // re-typed from an ID-card type: in the ID slot it was really uploaded
    // into it is the wrong document, and it must never pass there because
    // it was re-typed. When the slot cannot be read, the stored ID type
    // stands in for it: failing closed.
    let slotMismatch = classifiedFromContent
      ? null
      : slotContentMismatch(documentType, state.rawOcrText);
    if (idTypedAgreement) {
      const slot = await uploadSlot(supabase, state.documentId);
      slotMismatch = agreementInIdentitySlot(
        slot ? slot.slotType : storedType,
        idTypedAgreement,
      );
    }

    const { fields, adjustments } = refineIdentityFields(
      documentType,
      state.rawOcrText,
      state.extractedFields ?? {},
    );

    // The run_ocr grade counts extracted fields, which is a measure of an
    // IDENTITY read. A supporting document — the host's invitation letter, a
    // T4, an insurance policy — legitimately yields few or none, and was graded
    // fail/warn for it, so its slot could never reach "verified" (prod app
    // 61f16bb5, 2026-10-16). A supporting document that was read in full and
    // sits in the right slot is as verified as this pipeline can make it.
    const photo = isPhotoDocumentType(documentType);
    const readableSupporting =
      !slotMismatch &&
      !photo &&
      state.verificationResult !== 'pass' &&
      identityRole(documentType) === 'supporting' &&
      (state.rawOcrText ?? '').trim().length >= MIN_READABLE_CHARS;

    // A photograph has no text to read and no fields to extract, so the field
    // count graded every applicant photo fail (prod 2026-10-24, study permit
    // `passport_photos`). An image with next to no text in the photo slot is
    // as verified as this pipeline can make it. Anything else there — a PDF, a
    // page of text the classifier could not name (a lease, a certificate) — is
    // a warn for the consultant to look at, never verified on a field count.
    const photoGrade: 'pass' | 'warn' | null =
      photo && !slotMismatch
        ? (state.mimeType ?? '').toLowerCase().startsWith('image/') &&
          (state.rawOcrText ?? '').trim().length < MIN_READABLE_CHARS
          ? 'pass'
          : 'warn'
        : null;

    return {
      documentType,
      classifiedFromContent,
      extractedFields: fields,
      fieldAdjustments: adjustments,
      slotMismatch,
      ...(slotMismatch ? { verificationResult: 'fail' as const } : {}),
      ...(readableSupporting ? { verificationResult: 'pass' as const } : {}),
      ...(photoGrade ? { verificationResult: photoGrade } : {}),
    };
  };
}
