import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';
import { linkOrphanDocuments } from '../../slot-link';

/**
 * Jobs after OCR finishes (0 only for a wrong-slot upload):
 *   0. Re-open the slot when the upload is not the document it asks for.
 *   1. Promote the linked checklist item from 'uploaded' to 'verified' when the
 *      document passed identity extraction and did not fail its expiry check.
 *   2. Once every supporting document on the checklist is uploaded/verified,
 *      mark official forms (meta.kind === 'form') as 'verified' too — the data
 *      needed to fill them is now on file.
 */
export function makeSyncChecklistNode(supabase: SupabaseClient) {
  return async function syncChecklist(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    // 0. Wrong document for the slot: re-open it so the applicant is asked
    //    again and forms do not auto-complete on the strength of it. Only an
    //    item still at 'uploaded' — never one another document verified.
    if (!state.error && state.slotMismatch) {
      const { data: doc } = await supabase
        .from('documents')
        .select('checklist_item_id')
        .eq('id', state.documentId)
        .single();
      if (doc?.checklist_item_id) {
        await supabase
          .from('checklist_items')
          .update({ status: 'missing' })
          .eq('id', doc.checklist_item_id)
          .eq('application_id', state.applicationId)
          .eq('status', 'uploaded');
      }
    }

    // 0b. A file with no slot (uploaded to "Additional document", typed from
    //     its text) goes into the missing slot of its kind, if there is one.
    //     Best-effort, never throws. Runs before step 1 so a just-linked
    //     document is promoted by the same pass.
    if (!state.error && !state.slotMismatch) {
      await linkOrphanDocuments(supabase, state.applicationId);
    }

    // 1. Flip the document's checklist item to 'verified' on a clean OCR pass.
    //    An expired document is not a clean pass: prod app 61f16bb5's
    //    medical_insurance slot read 'verified' on a policy that expired
    //    2026-05-31. Step 0b has already settled such a slot from ALL its
    //    files ('verified' if another one is valid, else 'uploaded' with the
    //    reason), so here it is simply not promoted.
    if (
      !state.error &&
      !state.slotMismatch &&
      state.verificationResult === 'pass' &&
      state.expiryStatus !== 'fail'
    ) {
      const { data: doc } = await supabase
        .from('documents')
        .select('checklist_item_id')
        .eq('id', state.documentId)
        .single();

      if (doc?.checklist_item_id) {
        await supabase
          .from('checklist_items')
          .update({ status: 'verified' })
          .eq('id', doc.checklist_item_id)
          .eq('application_id', state.applicationId);
      }
    }

    // 2. Auto-complete forms when all supporting documents are in.
    const { data: items } = await supabase
      .from('checklist_items')
      .select('id, status, meta')
      .eq('application_id', state.applicationId);

    if (!items || items.length === 0) return {};

    const docs = items.filter(
      (i) => (i.meta as { kind?: string } | null)?.kind !== 'form',
    );
    const forms = items.filter(
      (i) => (i.meta as { kind?: string } | null)?.kind === 'form',
    );

    const allDocsReady =
      docs.length > 0 &&
      docs.every((d) => d.status === 'uploaded' || d.status === 'verified');

    if (allDocsReady) {
      const formsToComplete = forms
        .filter((f) => f.status !== 'verified')
        .map((f) => f.id);
      if (formsToComplete.length > 0) {
        await supabase
          .from('checklist_items')
          .update({ status: 'verified' })
          .in('id', formsToComplete)
          .eq('application_id', state.applicationId);
      }
    }

    return {};
  };
}
