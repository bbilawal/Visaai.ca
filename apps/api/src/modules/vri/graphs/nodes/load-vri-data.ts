import { SupabaseClient } from '@supabase/supabase-js';
import type { PlanTier } from '@visaai/types';
import type { VriState, VriInputData } from '../vri.state';
import { reviewStoredCrossCheck } from '../../../documents/graphs/nodes/identity-compare';

export function makeLoadVriDataNode(supabase: SupabaseClient) {
  return async function loadVriData(
    state: VriState,
  ): Promise<Partial<VriState>> {
    const { data: application } = await supabase
      .from('applications')
      .select(
        'destination_country, plan_tier, framework_id, country_frameworks(visa_type), visa_types(visaai_id, official_name)',
      )
      .eq('id', state.applicationId)
      .single();

    const framework =
      (
        application as {
          country_frameworks?: { visa_type?: string } | null;
        } | null
      )?.country_frameworks ?? null;
    const vtRaw = (application as { visa_types?: unknown } | null)?.visa_types;
    const registry = (Array.isArray(vtRaw) ? vtRaw[0] : vtRaw) as {
      official_name?: string | null;
    } | null;
    const planTier = ((application as { plan_tier?: string } | null)
      ?.plan_tier ?? 'none') as PlanTier;

    const { data: profile } = await supabase
      .from('application_profiles')
      .select('profile_json')
      .eq('application_id', state.applicationId)
      .single();

    const { data: checklist } = await supabase
      .from('checklist_items')
      .select('id, document_type, required, status')
      .eq('application_id', state.applicationId);

    const { data: documents } = await supabase
      .from('documents')
      .select('id, document_type, ocr_status, checklist_item_id')
      .eq('application_id', state.applicationId);

    const docIds = (documents ?? []).map((d) => d.id);
    let verifications: VriInputData['verifications'] = [];
    if (docIds.length > 0) {
      const { data: verifs } = await supabase
        .from('document_verifications')
        .select('document_id, verification_type, result, details_json')
        .in('document_id', docIds);
      verifications = verifs ?? [];
    }

    const { data: crossVerifications } = await supabase
      .from('cross_verifications')
      .select('field_compared, result, details_json')
      .eq('application_id', state.applicationId);

    // Guard against profile_json being null/string/array — scorers expect a plain object
    const rawProfile = profile?.profile_json;
    const safeProfile =
      rawProfile && typeof rawProfile === 'object' && !Array.isArray(rawProfile)
        ? (rawProfile as Record<string, unknown>)
        : {};

    const data: VriInputData = {
      profile: safeProfile,
      checklistItems: checklist ?? [],
      documents: documents ?? [],
      verifications,
      // Current untyped-upload rules, not the ones in force when stored.
      crossVerifications: (crossVerifications ?? [])
        .map((row) => reviewStoredCrossCheck(row))
        .filter((row) => row !== null),
      destinationCountry:
        (application as { destination_country?: string | null } | null)
          ?.destination_country ?? null,
      // A registry route has no framework row; name its registry visa type.
      currentVisaType: framework?.visa_type ?? registry?.official_name ?? null,
      visaaiId: visaaiIdOf(application),
    };

    return { data, planTier };
  };
}

function visaaiIdOf(application: unknown): string | null {
  const raw = (application as { visa_types?: unknown } | null)?.visa_types;
  const vt = (Array.isArray(raw) ? raw[0] : raw) as {
    visaai_id?: string | null;
  } | null;
  return vt?.visaai_id ?? null;
}
