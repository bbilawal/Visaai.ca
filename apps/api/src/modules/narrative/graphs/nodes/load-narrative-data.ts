import { SupabaseClient } from '@supabase/supabase-js';
import type { NarrativeState, NarrativeContext } from '../narrative.state';
import { withStayFromDates } from '../../../shared/stay-duration';
import { narrativeEvidence, type VerificationRow } from './document-evidence';

/**
 * The verifications of the application's documents. Best effort: a letter
 * can still be written from the profile when this read fails.
 */
async function loadVerifications(
  supabase: SupabaseClient,
  applicationId: string,
): Promise<VerificationRow[]> {
  try {
    const { data: docs } = await supabase
      .from('documents')
      .select('id, document_type')
      .eq('application_id', applicationId);
    const list = (docs ?? []) as Array<{
      id: string;
      document_type: string | null;
    }>;
    if (list.length === 0) return [];
    const typeOf = new Map(list.map((d) => [d.id, d.document_type]));
    const { data: verifs } = await supabase
      .from('document_verifications')
      .select('document_id, verification_type, result, details_json')
      .in('document_id', [...typeOf.keys()]);
    return (
      (verifs ?? []) as Array<VerificationRow & { document_id: string }>
    ).map((v) => ({ ...v, document_type: typeOf.get(v.document_id) ?? null }));
  } catch {
    return [];
  }
}

export function makeLoadNarrativeDataNode(supabase: SupabaseClient) {
  return async function loadNarrativeData(
    state: NarrativeState,
  ): Promise<Partial<NarrativeState>> {
    const { data: app, error: appErr } = await supabase
      .from('applications')
      .select(
        'vri_score, destination_country, country_frameworks(country_code, visa_type, purpose), visa_types(visaai_id, official_name)',
      )
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

    // The registry route the applicant chose. Registry applications never set
    // a framework, so without this the letter prompt got an empty visa name
    // and the model filled it with the commonest one — an eTA applicant's LOE
    // said "applying for a visitor visa" (dry run 2026-10-16).
    const vtRaw = (app as { visa_types?: unknown }).visa_types;
    const visaType = (Array.isArray(vtRaw) ? vtRaw[0] : vtRaw) as {
      official_name?: string | null;
      visaai_id?: string | null;
    } | null;
    const destination =
      (app as { destination_country?: string | null }).destination_country ??
      '';

    const rawProfile = profile?.profile_json;
    const safeProfile =
      rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? (rawProfile as Record<string, unknown>)
        : {};

    // Dates win over the stated duration (the intake's estimate), so every
    // letter quotes the same length of stay as the form. See stay-duration.ts.
    const { profile: datedProfile, stay } = withStayFromDates(safeProfile);

    const evidence = narrativeEvidence(
      safeProfile,
      await loadVerifications(supabase, state.applicationId),
    );

    const context: NarrativeContext = {
      profile: datedProfile,
      evidence,
      stay,
      vriScore: app?.vri_score ?? null,
      countryCode: framework?.country_code ?? destination,
      visaType: framework?.visa_type ?? visaType?.official_name ?? '',
      purpose: framework?.purpose ?? '',
      visaaiId: visaType?.visaai_id ?? null,
    };

    return { context };
  };
}
