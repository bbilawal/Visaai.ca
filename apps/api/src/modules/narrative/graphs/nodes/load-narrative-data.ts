import { SupabaseClient } from '@supabase/supabase-js';
import type { NarrativeState, NarrativeContext } from '../narrative.state';
import { withStayFromDates } from '../../../shared/stay-duration';

export function makeLoadNarrativeDataNode(supabase: SupabaseClient) {
  return async function loadNarrativeData(
    state: NarrativeState,
  ): Promise<Partial<NarrativeState>> {
    const { data: app, error: appErr } = await supabase
      .from('applications')
      .select('vri_score, country_frameworks(country_code, visa_type, purpose)')
      .eq('id', state.applicationId)
      .single();

    if (appErr || !app) {
      throw new Error(
        `Failed to load application data: ${appErr?.message ?? 'application not found'}`,
      );
    }

    const { data: profile } = await supabase
      .from('application_profiles')
      .select('profile_json')
      .eq('application_id', state.applicationId)
      .single();

    const framework = app?.country_frameworks as unknown as {
      country_code: string;
      visa_type: string;
      purpose: string;
    } | null;

    const rawProfile = profile?.profile_json;
    const safeProfile =
      rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? (rawProfile as Record<string, unknown>)
        : {};

    // Dates win over the stated duration (the intake's estimate), so every
    // letter quotes the same length of stay as the form. See stay-duration.ts.
    const { profile: datedProfile, stay } = withStayFromDates(safeProfile);

    const context: NarrativeContext = {
      profile: datedProfile,
      stay,
      vriScore: app?.vri_score ?? null,
      countryCode: framework?.country_code ?? '',
      visaType: framework?.visa_type ?? '',
      purpose: framework?.purpose ?? '',
    };

    return { context };
  };
}
