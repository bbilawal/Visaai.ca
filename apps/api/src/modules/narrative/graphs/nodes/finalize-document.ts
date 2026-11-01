import { SupabaseClient } from '@supabase/supabase-js';
import type { NarrativeState } from '../narrative.state';

/** Keeps the text a regeneration is about to replace (revision history). */
export type KeepPreviousLetter = (previous: {
  id: string;
  content_md: string;
}) => Promise<void>;

/**
 * Stores the draft as THE letter of its type for the application (one row per
 * application + doc_type, DOC-002). A fresh generation is always a draft:
 * approved_by_user is reset to false so the applicant must read and approve it
 * explicitly — an approval of the old text never carries over to new text.
 * The replaced text is kept first; if it cannot be kept, nothing is replaced.
 */
export function makeFinalizeDocumentNode(
  supabase: SupabaseClient,
  keepPrevious?: KeepPreviousLetter,
) {
  return async function finalizeDocument(
    state: NarrativeState,
  ): Promise<Partial<NarrativeState>> {
    const read: {
      data: { id: string; content_md: string } | null;
      error: { message: string } | null;
    } = await supabase
      .from('generated_documents')
      .select('id, content_md')
      .eq('application_id', state.applicationId)
      .eq('doc_type', state.docType)
      .maybeSingle();
    if (read.error)
      throw new Error(
        `Failed to read the current ${state.docType}: ${read.error.message}`,
      );

    const previous = read.data;
    if (previous && keepPrevious && previous.content_md !== state.draft) {
      await keepPrevious({ id: previous.id, content_md: previous.content_md });
    }

    const saved: {
      data: { id: string } | null;
      error: { message: string } | null;
    } = await supabase
      .from('generated_documents')
      .upsert(
        {
          application_id: state.applicationId,
          doc_type: state.docType,
          content_md: state.draft,
          approved_by_user: false,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'application_id,doc_type' },
      )
      .select('id')
      .single();

    if (saved.error || !saved.data)
      throw new Error(
        `Failed to save generated document: ${saved.error?.message}`,
      );

    return { generatedDocumentId: saved.data.id };
  };
}
