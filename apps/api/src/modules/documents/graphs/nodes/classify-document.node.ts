import type { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { safeLog } from '../../../shared/log/redact';
import { identityRole } from './identity-compare';
import {
  classifyDocumentText,
  refineIdentityFields,
  slotContentMismatch,
} from './classify-document';

/**
 * classify_document node (after run_ocr + derive_fields).
 *
 * 1. A generic upload ("Additional document" slot, unrecognisable filename) is
 *    re-typed from its OCR text when the text is unambiguous, and the type is
 *    persisted on documents.document_type — so an IRCC refusal letter becomes
 *    supporting evidence and stops being compared against the passport.
 *    A type chosen by a checklist slot is never overridden.
 * 2. A document in a typed slot is checked against that slot
 *    (slotContentMismatch): a passport bio page dropped into "evidence of
 *    previous travel" fails with a message saying what it is and what the
 *    slot wants, instead of passing as verified.
 * 3. Identity fields are made trustworthy (see refineIdentityFields): no DOB
 *    from a non-identity document unless it is printed beside a birth label;
 *    an ID card keeps the holder's name, not the father's/husband's, and its
 *    number as national_id_number; sex is read from the MRZ / card label.
 */
export function makeClassifyDocumentNode(supabase: SupabaseClient) {
  return async function classifyDocument(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    if (state.error) return {};

    let documentType = state.documentType;
    let classifiedFromContent = false;

    if (identityRole(documentType) === 'generic') {
      const inferred = classifyDocumentText(state.rawOcrText);
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
    }

    // Only a slot-typed upload can be in the wrong slot; a generic one was
    // just re-typed from this same text.
    const slotMismatch = classifiedFromContent
      ? null
      : slotContentMismatch(documentType, state.rawOcrText);

    const { fields, adjustments } = refineIdentityFields(
      documentType,
      state.rawOcrText,
      state.extractedFields ?? {},
    );

    return {
      documentType,
      classifiedFromContent,
      extractedFields: fields,
      fieldAdjustments: adjustments,
      slotMismatch,
      ...(slotMismatch ? { verificationResult: 'fail' as const } : {}),
    };
  };
}
