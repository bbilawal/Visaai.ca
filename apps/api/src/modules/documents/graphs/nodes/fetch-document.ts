import { SupabaseClient } from '@supabase/supabase-js';
import type { DocumentState } from '../document.state';

export function makeFetchDocumentNode(supabase: SupabaseClient) {
  return async function fetchDocument(
    state: DocumentState,
  ): Promise<Partial<DocumentState>> {
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(state.storagePath, 60);

    if (error || !data?.signedUrl) {
      return {
        error: `Failed to get signed URL: ${error?.message ?? 'unknown'}`,
      };
    }

    const res = await fetch(data.signedUrl, { method: 'HEAD' });
    if (!res.ok) {
      return { error: `Document not accessible: HTTP ${res.status}` };
    }

    return { signedUrl: data.signedUrl };
  };
}
