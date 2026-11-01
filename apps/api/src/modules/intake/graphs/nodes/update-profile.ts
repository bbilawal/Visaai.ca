import { SupabaseClient } from '@supabase/supabase-js';
import type { IntakeState } from '../intake.state';

const DOCUMENT_OWNED_KEYS = ['_document_sources', 'document_consistency_flags'];

export function makeUpdateProfileNode(supabase: SupabaseClient) {
  return async function updateProfile(
    state: IntakeState,
  ): Promise<Partial<IntakeState>> {
    // Merge onto the row, never replace it. `state.profileJson` comes from the
    // graph checkpoint, which can be hours old; document OCR writes fields into
    // the same row in the meantime (documents/graphs/nodes/sync-profile.ts).
    // Writing the checkpoint back wholesale erased them — prod 2026-10-15:
    // full_name, nationality, marriage_date, job_title and
    // employment_start_date vanished on the applicant's next intake answer.
    // The applicant's intake answers still win on any key both sides hold.
    //
    // A failed read must not fall back to `{}`: that is the wholesale
    // overwrite again. Abort instead and leave the row untouched.
    const { data: row, error: readErr } = await supabase
      .from('application_profiles')
      .select('profile_json')
      .eq('application_id', state.applicationId)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const raw = (row as { profile_json?: unknown } | null)?.profile_json;
    const current =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    // Keys owned by the document pipeline (provenance and consistency flags,
    // sync-family.ts) always come from the row: the checkpoint's copy is a
    // snapshot from session start and would roll them back.
    const merged: Record<string, unknown> = {
      ...current,
      ...state.profileJson,
    };
    for (const key of DOCUMENT_OWNED_KEYS) {
      if (key in current) merged[key] = current[key];
      else delete merged[key];
    }

    await supabase.from('application_profiles').upsert(
      {
        application_id: state.applicationId,
        profile_json: merged,
        risk_indicators_json: state.riskIndicators,
        last_updated_at: new Date().toISOString(),
      },
      { onConflict: 'application_id' },
    );

    return {};
  };
}
