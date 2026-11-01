import { SupabaseClient } from '@supabase/supabase-js';
import type { PrefilledFormField, PrefilledFormPayload } from '@visaai/types';
import type { PrefillState } from '../prefill.state';
import { overlayTripEdits, TRIP_ROW_FIELD, tripEditRows } from './trip-rows';
import { loadHeldIdentity, scrubHeldIdentity } from './held-identity';

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

    // A regeneration must not erase a person's answer: a consultant's
    // correction (what portal auto-fill writes and what was locked) or an
    // answer the applicant typed — for an applicant who skipped the
    // interview, the Forms page IS their answers (dry run 2026-10-18). Read
    // the stored form first (a read error aborts — guessing "none" would drop
    // them silently) and carry those fields over.
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
    // Copies: the held-document check below edits them in place.
    const fields = keepConsultantFields(
      state.fields,
      (existing as { content_md?: string } | null)?.content_md,
    ).map((f) => ({ ...f }));

    // A passport held after the generator read the verifications (a
    // Regenerate racing sync_profile) must not put its holder back on the
    // form. Unreadable evidence changes nothing.
    const evidence = await loadHeldIdentity(supabase, state.applicationId);
    if (!evidence)
      console.warn(
        `[prefill] held-document check unreadable for ${state.applicationId}; form saved unscrubbed`,
      );
    else if (evidence.held.length)
      scrubHeldIdentity(fields, evidence.held, evidence.own);

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

/** Fields a person entered on a stored form: consultant corrections and non-empty applicant answers. */
export function personFieldsOf(
  storedRaw: string | undefined | null,
): PrefilledFormField[] {
  if (!storedRaw) return [];
  try {
    const parsed = JSON.parse(storedRaw) as { fields?: PrefilledFormField[] };
    const stored = Array.isArray(parsed.fields) ? parsed.fields : [];
    const person = stored.filter(
      (f) =>
        f.source === 'consultant' ||
        (f.source === 'applicant' && String(f.value ?? '').trim() !== ''),
    );
    // A trip row carries its whole stored row, so the edit can follow its
    // trip (country and month) when the rows are renumbered.
    return [
      ...person.filter((f) => !TRIP_ROW_FIELD.test(f.key)),
      ...tripEditRows(
        stored.filter(
          (f) =>
            !TRIP_ROW_FIELD.test(f.key) ||
            f.source !== 'applicant' ||
            String(f.value ?? '').trim() !== '',
        ),
      ),
    ];
  } catch {
    return []; // unreadable old form: nothing trustworthy to carry over
  }
}

const sameLabel = (a: string, b: string) =>
  a.trim().toLowerCase().replace(/\s+/g, ' ') ===
  b.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The draft with every person-entered field carried over: it replaces the
 * draft's field of the same key, else an EMPTY draft field of the same label
 * (the generator renamed the key — live 2026-10-18 showed "Funds available"
 * twice), else it is appended.
 */
export function mergePersonFields(
  draft: PrefilledFormField[],
  person: PrefilledFormField[],
): PrefilledFormField[] {
  if (person.length === 0) return draft;
  const out = [...draft];
  // Travel-history rows follow their trip, not their row number (trip-rows).
  const trips = person.filter((f) => TRIP_ROW_FIELD.test(f.key));
  for (const f of person.filter((x) => !TRIP_ROW_FIELD.test(x.key))) {
    let i = out.findIndex((d) => d.key === f.key);
    if (i < 0)
      i = out.findIndex(
        (d) =>
          !String(d.value ?? '').trim() &&
          d.source !== 'consultant' &&
          d.source !== 'applicant' &&
          sameLabel(d.label, f.label),
      );
    if (i >= 0) out[i] = f;
    else out.push(f);
  }
  return overlayTripEdits(out, trips);
}

function keepConsultantFields(
  draft: PrefilledFormField[],
  storedRaw: string | undefined,
): PrefilledFormField[] {
  return mergePersonFields(draft, personFieldsOf(storedRaw));
}
