import { SupabaseClient } from '@supabase/supabase-js';
import type { IntakeState } from '../intake.state';
import { applyConsistencyFlags } from '../../../documents/graphs/nodes/sync-family';
import {
  childrenUpdate,
  dedupePlaceholderChildren,
  removedChildFlatKeys,
  mergeChildLists,
} from '../../../shared/profile/intake-children';
import { withoutRemovedChildren } from '../../../shared/profile/family-members';
import { canonicalGapFill } from '../../../shared/profile/canonical-fact-keys';
import { routeFactKeys } from './required-facts';

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

    // Children are people, matched by name — not a value the checkpoint may
    // overwrite. A birth certificate processed since the checkpoint was taken
    // added a child, or a child's full date of birth, to the row; a plain
    // spread would have replaced that list with the interview's older one.
    if (Array.isArray(current.children) && Array.isArray(merged.children)) {
      merged.children = mergeChildLists(
        current.children as Record<string, unknown>[],
        merged.children as Record<string, unknown>[],
      );
    }
    // A child the applicant removed (family-members.ts) is still on the row's
    // list; the by-name merge above keeps him, so drop him here.
    if (Array.isArray(merged.children)) {
      merged.children = withoutRemovedChildren(
        merged,
        merged.children as Record<string, unknown>[],
      );
    }
    // Children named in the interview under ad-hoc keys (`youngest_son_name`)
    // join `children`, where the forms read them. Gap-fill only here: a
    // detail the applicant gave this turn was already applied by
    // process_answer.
    const folded = childrenUpdate(merged);
    if (folded) Object.assign(merged, folded);
    // "Unknown" sons intake recorded before it learned their names fold into
    // the named ones (prod 2026-10-16: four sons in Canada for two).
    if (Array.isArray(merged.children)) {
      merged.children = dedupePlaceholderChildren(merged.children);
    }

    // A fact held only under a synonym (`birthplace_city` next to a null
    // `place_of_birth`, prod 2026-10-17) is copied onto the key the forms
    // read. Gap-fill only; the synonym stays.
    Object.assign(merged, canonicalGapFill(merged, routeFactKeys(state)));

    // The family consistency flags are derived from marriage_date and the
    // children's dates of birth. An applicant correcting the marriage date
    // (dry run 2026-10-15: 1999 → 1988-09-16) resolves the "marriage after
    // child's birth" flags it caused, so recompute them from the profile
    // being written. Same function the document pipeline uses; flags of any
    // other kind are left exactly as the row had them.
    // A removed child's flat interview keys go with him; the checkpoint still
    // carries them (its reducer cannot delete), so this runs on every write.
    for (const k of removedChildFlatKeys(merged)) delete merged[k];

    applyConsistencyFlags(merged);

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
