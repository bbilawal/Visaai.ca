import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';

export function makeCheckDocsReadyNode(supabase: SupabaseClient) {
  return async function checkDocsReady(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    const { data: docs } = await supabase
      .from('documents')
      .select('ocr_status')
      .eq('application_id', state.applicationId);

    const all = docs ?? [];
    const allProcessed =
      all.length > 0 &&
      all.every(
        (d) => d.ocr_status === 'complete' || d.ocr_status === 'failed',
      );

    return { allDocsProcessed: allProcessed };
  };
}

export function docsReadyRouter(
  state: DocumentState,
): 'run_cross_verification' | '__end__' {
  return state.allDocsProcessed ? 'run_cross_verification' : '__end__';
}
