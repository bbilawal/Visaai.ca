import { SupabaseClient } from '@supabase/supabase-js';
import type { PrefilledFormField, PrefilledFormPayload } from '@visaai/types';
import type { PrefillState } from '../prefill.state';

export function makeStorePrefillNode(supabase: SupabaseClient) {
  return async function storePrefill(
    state: PrefillState,
  ): Promise<Partial<PrefillState>> {
    // Last line of defence: this upsert REPLACES the stored draft, so an empty
    // field list would silently wipe the applicant's form and edits.
    if (!state.fields?.length) {
      throw new Error(
        'Refusing to replace the prefilled form with an empty draft.',
      );
    }

    // A regeneration must not erase a consultant's correction: those values
    // are what portal auto-fill writes and what the consultant locked. Read
    // the stored form first (a read error aborts — guessing "none" would drop
    // the corrections silently) and carry every consultant field over.
    const { data: existing, error: readErr } = await supabase
      .from('generated_documents')
      .select('content_md')
      .eq('application_id', state.applicationId)
      .eq('doc_type', 'prefilled_form_json')
      .maybeSingle();
    if (readErr)
      throw new Error(
        `Failed to read the current prefilled form: ${readErr.message}`,
      );
    const fields = keepConsultantFields(
      state.fields,
      (existing as { content_md?: string } | null)?.content_md,
    );

    const payload: PrefilledFormPayload = {
      visaType: state.context.visaType,
      countryCode: state.context.countryCode,
      purpose: state.context.purpose,
      generatedAt: new Date().toISOString(),
      fields,
    };

    const { data, error } = await supabase
      .from('generated_documents')
      .upsert(
        {
          application_id: state.applicationId,
          doc_type: 'prefilled_form_json',
          content_md: JSON.stringify(payload),
          approved_by_user: false,
          generated_at: new Date().toISOString(),
        },
        { onConflict: 'application_id,doc_type' },
      )
      .select('id')
      .single();

    if (error || !data)
      throw new Error(
        `Failed to store prefilled form: ${error?.message ?? 'unknown'}`,
      );
    return { payload, generatedDocumentId: data.id };
  };
}

function keepConsultantFields(
  draft: PrefilledFormField[],
  storedRaw: string | undefined,
): PrefilledFormField[] {
  if (!storedRaw) return draft;
  let stored: PrefilledFormField[] = [];
  try {
    const parsed = JSON.parse(storedRaw) as { fields?: PrefilledFormField[] };
    stored = Array.isArray(parsed.fields) ? parsed.fields : [];
  } catch {
    return draft; // unreadable old form: nothing trustworthy to carry over
  }
  const corrected = new Map(
    stored.filter((f) => f.source === 'consultant').map((f) => [f.key, f]),
  );
  if (corrected.size === 0) return draft;
  const out = draft.map((f) => corrected.get(f.key) ?? f);
  const present = new Set(out.map((f) => f.key));
  for (const [key, f] of corrected) if (!present.has(key)) out.push(f);
  return out;
}
