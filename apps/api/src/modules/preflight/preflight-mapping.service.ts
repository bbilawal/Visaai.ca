import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { PortalFillCoverage, PreflightMappingInput } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { embeddedVisaaiId, portalForRoute } from '../../strategies';
import {
  resolvePortalFillFor,
  type PortalFillMapping,
} from '../../strategies/portal-integration/portal-fill.registry';
import {
  applyPrefillOverrides,
  buildMappingInputs,
  portalFillCoverage,
} from '../automation/fill-instructions';
import { PrefillFormStore } from './prefill-form.store';
import { loadPortalDocuments } from './portal-documents';
import { PORTAL_DOCUMENTS_KEY } from '../automation/portal-fills/ircc-uploads';
// Side effects: the portal mappings this service resolves by portal id.
import '../automation/portal-fills/canada-ircc';
import '../automation/portal-fills/canada-ircc-eta';
import '../automation/portal-fills/canada-ircc-study-eapp';
import '../automation/portal-fills/canada-ircc-work-eapp';
import '../automation/portal-fills/canada-ircc-pr-family';
import '../automation/portal-fills/canada-ircc-super-visa';
import '../automation/portal-fills/canada-ircc-business-visitor';
import { ConsultantApprovalService } from '../consultant/consultant-approval.service';

/**
 * PreflightMappingService (Phase 7K) — the single, deterministic source of the
 * field mappings every step of the execution chain must agree on.
 *
 * Why this exists: `mappings` are supplied by the caller at preflight/start,
 * preflight/complete, preflight/validate AND execution/request, and they must
 * reproduce the same diff hash at each step. They are never persisted — the lock
 * is a hash, not a row. Crucially the steps do not share a client: the CONSULTANT
 * completes and locks the review, and the APPLICANT later requests execution
 * from a different browser and session. Neither can hand the array to the other,
 * so the array has to be re-derivable on demand from server state alone.
 *
 * Derivation is the same path the fill uses (destination country → portal
 * strategy → registered portal mapping → values), so the review a consultant
 * locks is a review of exactly the fields that later get written.
 *
 * VALUES come from the applicant's SAVED application form first (the reviewed
 * copy the applicant — and the consultant, via the editable review — corrects),
 * falling back to the intake profile only for mapped keys the form lacks. See
 * applyPrefillOverrides. Because the form is server state, the derivation stays
 * re-derivable, and any later edit to a mapped value shifts the lock hash.
 *
 * Determinism is a security property here, not a convenience: if this returned a
 * different set between the lock and the execution request, the lock check would
 * fail closed and no fill could ever run. If it returned a LARGER set, a field
 * could be written that no consultant reviewed.
 */
@Injectable()
export class PreflightMappingService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly forms: PrefillFormStore,
    // The class itself, not a Pick<>: Nest resolves providers from the emitted
    // design:paramtypes, and a mapped type emits Object.
    private readonly consultant: ConsultantApprovalService,
  ) {}

  /**
   * Resolve the portal mappings for an application. The portal is the
   * destination country's, narrowed by the application's route
   * (visa_types.visaai_id). Returns an empty array when that portal has no
   * registered mapping — a country we
   * cannot auto-fill yields nothing to review rather than a partial plan.
   */
  async forApplication(
    applicationId: string,
  ): Promise<PreflightMappingInput[]> {
    return (await this.resolve(applicationId)).inputs;
  }

  /**
   * What the assistant fills on each portal page and what it leaves for the
   * applicant (with why), from the same values the mappings are derived from.
   * Null when the destination has no portal mapping.
   */
  async coverage(applicationId: string): Promise<PortalFillCoverage | null> {
    const r = await this.resolve(applicationId);
    if (!r.mapping) return null;
    return portalFillCoverage(r.mapping, r.values, r.notApplicable);
  }

  /** forApplication plus the portal mapping it was derived from (labels, categories). */
  async resolve(applicationId: string): Promise<{
    mapping: PortalFillMapping | undefined;
    inputs: PreflightMappingInput[];
    values: Record<string, unknown>;
    notApplicable: Set<string>;
  }> {
    const [
      { data: app, error: appError },
      { data: profile },
      form,
      notApplicable,
    ] = await Promise.all([
      this.supabase.admin
        .from('applications')
        .select('destination_country, visa_types(visaai_id)')
        .eq('id', applicationId)
        .single(),
      this.supabase.admin
        .from('application_profiles')
        .select('profile_json')
        .eq('application_id', applicationId)
        .single(),
      this.forms.load(applicationId),
      this.consultant.notApplicableFieldKeys(applicationId),
    ]);

    // A failed read is not "this route has no portal fill": treating it as
    // such returned no mappings, which would let an application be approved
    // with nothing locked (ApprovalLockGate). Fail closed.
    if (appError) {
      throw new ServiceUnavailableException(
        `Could not read the application to derive its portal fill: ${appError.message}`,
      );
    }

    const raw = profile?.profile_json;
    const safeProfile =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    const countryCode = (app as { destination_country?: string } | null)
      ?.destination_country;
    // The route narrows the portal: a Canada eTA fills the eTA form, every
    // other Canada route IRCC tr-rt.
    // The route then picks its own mapping on that portal, when it has one
    // (IRCC tr-rt: the super visa answers /purpose differently).
    const visaaiId = embeddedVisaaiId(app);
    const portalId = portalForRoute(countryCode, visaaiId)?.portalId;
    const mapping = portalId
      ? resolvePortalFillFor(portalId, visaaiId)
      : undefined;
    if (!mapping)
      return { mapping: undefined, inputs: [], values: {}, notApplicable };

    const values = applyPrefillOverrides(
      mapping,
      safeProfile,
      form?.payload.fields,
    );
    // The documents a portal's upload page may receive (IRCC /doc-upload).
    // Server state, so the derivation and the lock hash stay reproducible.
    values[PORTAL_DOCUMENTS_KEY] = await loadPortalDocuments(
      this.supabase.admin as never,
      applicationId,
    );
    // A field the consultant marked 'not applicable' is never written. Server
    // state, so the derivation stays deterministic; marking one changes the
    // set and therefore breaks an existing lock, as it should.
    // Excluded inside the resolution, not filtered after it: a follow-up
    // question hangs off its parent's answer, so dropping the parent must drop
    // the follow-ups too (they would never appear on the portal page).
    const inputs = buildMappingInputs(mapping, values, notApplicable);
    return { mapping, inputs, values, notApplicable };
  }
}
