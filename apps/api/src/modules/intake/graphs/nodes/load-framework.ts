import { SupabaseClient } from '@supabase/supabase-js';
import type { IntakeState } from '../intake.state';
import {
  convertRegistryToFramework,
  type RegistryRequirement,
} from '../../../visa-rules/registry-to-framework';
import { profileToRuleFacts } from '../../../visa-rules/profile-to-rule-facts';

/**
 * Load the requirements an application's checklist is built from.
 *
 * THREE SOURCES, IN THIS ORDER, AND THE ORDER IS THE POINT
 *
 *   1. `visa_requirements` — the sourced registry. Every row is quoted from a
 *      government page and bound to the source version it was read from.
 *   2. `country_frameworks` — the legacy table, when a framework_id is set.
 *   3. Nothing, which puts the graph in discovery mode and lets the model ask
 *      country-specific questions.
 *
 * The registry goes first because it is the only one of the three that can
 * say where a requirement came from. Until this change nothing in the
 * application flow read it at all: 166 verified requirements served the public
 * visa pages while an applicant's own checklist came from a one-row legacy
 * table or, far more often, a model's recall.
 *
 * `country_frameworks` is deliberately kept as the fallback rather than
 * removed. It still holds the only data for visa types the registry has not
 * reached, and dropping it would replace a thin checklist with no checklist.
 */
export function makeLoadFrameworkNode(supabase: SupabaseClient) {
  return async function loadFramework(
    state: IntakeState,
  ): Promise<Partial<IntakeState>> {
    const { data: existingItems } = await supabase
      .from('checklist_items')
      .select('*')
      .eq('application_id', state.applicationId);

    const checklistItems = existingItems ?? [];

    const fromRegistry = await loadFromRegistry(supabase, state);
    if (fromRegistry) return { ...fromRegistry, checklistItems };

    // Discovery mode: no registry coverage and no framework. The model asks
    // country-specific questions and proposes a visa type first.
    if (!state.frameworkId) {
      return { requirementsJson: {}, checklistItems };
    }

    const { data: framework } = await supabase
      .from('country_frameworks')
      .select('id, requirements_json')
      .eq('id', state.frameworkId)
      .single();

    if (!framework)
      throw new Error(`Framework not found: ${state.frameworkId}`);

    return {
      requirementsJson: framework.requirements_json as Record<string, unknown>,
      checklistItems,
    };
  };
}

/**
 * Build requirements from the registry, or null when it has no coverage.
 *
 * Returns null rather than throwing on any problem. A registry outage must
 * fall through to the legacy path, not fail the intake — the applicant is
 * mid-conversation and a checklist that is thinner than it could be beats a
 * conversation that stops.
 */
async function loadFromRegistry(
  supabase: SupabaseClient,
  state: IntakeState,
): Promise<{ requirementsJson: Record<string, unknown> } | null> {
  const countryCode = state.destinationCountry?.trim().toUpperCase();
  if (!countryCode) return null;

  try {
    const { data: country } = await supabase
      .from('visa_countries')
      .select('id')
      .eq('code', countryCode)
      .maybeSingle();
    if (!country) return null;

    // Narrow to the chosen visa type. Before the applicant picks one there is
    // no single correct list, and merging every visa type's requirements into
    // one checklist would show someone documents for a route they are not
    // taking. Discovery mode is the honest state.
    if (!state.visaTypeId) return null;

    const { data: visaType } = await supabase
      .from('visa_types')
      .select('id, visaai_id')
      .eq('id', state.visaTypeId)
      .maybeSingle();
    if (!visaType) return null;

    const { data: requirements } = await supabase
      .from('visa_requirements')
      .select(
        'requirement_code, kind, officially_required, label, description, ' +
          'official_form_code, official_form_url, rule, display_order',
      )
      .eq('visa_type_id', (visaType as { id: string }).id)
      .eq('status', 'active')
      .order('display_order');

    if (!requirements || requirements.length === 0) return null;

    // Facts the applicant has already given. Conditional requirements are
    // evaluated against them here; anything still undetermined is reported
    // rather than dropped.
    //
    // Normalized first: intake writes free-form keys ("purpose_of_visit":
    // "family visit") while rules read the closed vocabulary in rule.types.ts
    // ("purpose" in [visit_family, ...]). Raw, every conditional row came out
    // `unknown` — the 2026-10-14 dry run's three-item TRV checklist.
    const facts = profileToRuleFacts(state.profileJson ?? {});

    const { framework, undetermined, excluded } = convertRegistryToFramework(
      (visaType as { visaai_id: string }).visaai_id,
      requirements as unknown as RegistryRequirement[],
      facts,
    );

    return {
      requirementsJson: {
        ...framework,
        // Carried so the checklist surface can render "may be required —
        // answer X to confirm" instead of omitting the item silently, and so
        // the next question can target the fact that settles it.
        undetermined,
        excluded,
      },
    };
  } catch {
    return null;
  }
}
