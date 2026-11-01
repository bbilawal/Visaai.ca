import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { safeLog } from '../../../shared/log/redact';

/**
 * store_verification node.
 *
 * Writes the identity verification row, surfaces a duplicate as a warning row
 * (GAPS.md §A), persists the dedup + language signals computed upstream onto the
 * documents row, and sets the terminal ocr_status.
 *
 * NOTE: expiry evaluation now lives in the dedicated `evaluate_expiry` node
 * (runs immediately after this one). It was moved out of here so the window is
 * measured against the intended-travel date with a type-aware policy, instead of
 * the old now()-relative inline check (GAPS.md §B).
 */
export function makeStoreVerificationNode(supabase: SupabaseClient) {
  return async function storeVerification(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    const result = state.error ? 'fail' : state.verificationResult;

    // A graph run is a fresh verification pass for this document, so it
    // REPLACES the rows this pipeline wrote before rather than appending. A
    // failed run is rethrown for a BullMQ retry (attempts: 3), and each attempt
    // used to add another identity row — dry run 2026-10-14 showed
    // "Identity ✗ Fail" three times per document. evaluate_expiry runs after
    // this node, so clearing 'expiry' here leaves exactly one per run.
    const { error: clearErr } = await supabase
      .from('document_verifications')
      .delete()
      .eq('document_id', state.documentId)
      .in('verification_type', ['identity', 'duplicate', 'expiry']);
    if (clearErr) {
      safeLog.warn(
        'documents.store',
        `failed to clear earlier verifications for ${state.documentId}: ${clearErr.message}`,
      );
    }

    const { error: identityErr } = await supabase
      .from('document_verifications')
      .insert({
        document_id: state.documentId,
        verification_type: 'identity',
        result,
        details_json: {
          extracted_fields: state.error ? {} : state.extractedFields,
          raw_ocr_length: state.rawOcrText.length,
          error: state.error ?? null,
          // classify_document: the type this generic upload was re-typed to
          // from its text (run_cross_verification compares it tolerantly),
          // and any identity field it corrected or dropped, with the reason.
          ...(!state.error && state.classifiedFromContent
            ? { classified_from_content: state.documentType }
            : {}),
          // The upload is not what its checklist slot asks for; the message
          // is what the applicant sees on the document card.
          ...(!state.error && state.slotMismatch
            ? { slot_mismatch: state.slotMismatch }
            : {}),
          ...(!state.error &&
          state.fieldAdjustments &&
          Object.keys(state.fieldAdjustments).length > 0
            ? { field_adjustments: state.fieldAdjustments }
            : {}),
        },
      });

    // Surface a duplicate as its own verification row (best-effort, non-fatal):
    //  - exact_dup  => 'fail' (the same content is already on file)
    //  - likely_dup => 'warn' (same identity/passport, possibly a re-scan)
    if (!state.error && state.dupStatus && state.dupStatus !== 'unique') {
      const dupResult = state.dupStatus === 'exact_dup' ? 'fail' : 'warn';
      const { error: dupErr } = await supabase
        .from('document_verifications')
        .insert({
          document_id: state.documentId,
          verification_type: 'duplicate',
          result: dupResult,
          details_json: {
            dup_status: state.dupStatus,
            duplicate_of: state.duplicateOf ?? null,
            basis:
              state.dupStatus === 'exact_dup'
                ? 'identical document content already uploaded in this application'
                : 'same identity/passport already uploaded — possible re-scan',
          },
        });
      if (dupErr) {
        safeLog.warn(
          'documents.dedup',
          `failed to store duplicate verification for ${state.documentId}: ${dupErr.message}`,
        );
      }
    }

    // Always set a terminal ocr_status — even if a verification insert failed —
    // so check-docs-ready never blocks on a stuck 'pending' document. Persist
    // the dedup + language signals on the same update.
    const newStatus = state.error || identityErr ? 'failed' : 'complete';
    const { error: updateErr } = await supabase
      .from('documents')
      .update({
        ocr_status: newStatus,
        raw_text_hash: state.contentHash ?? null,
        identity_fphash: state.identityFphash ?? null,
        dup_status: state.dupStatus ?? 'unique',
        duplicate_of: state.duplicateOf ?? null,
        detected_language: state.detectedLanguage ?? null,
        language_confidence: state.languageConfidence ?? null,
        needs_translation: state.needsTranslation ?? false,
      })
      .eq('id', state.documentId);
    if (updateErr) {
      safeLog.warn(
        'documents.store',
        `failed to update document ${state.documentId}: ${updateErr.message}`,
      );
    }

    return identityErr
      ? {
          error: `Failed to store identity verification: ${identityErr.message}`,
        }
      : {};
  };
}
