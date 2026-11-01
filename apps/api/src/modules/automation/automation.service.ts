import {
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  EligibilityCheckInput,
  ExecutionGateDecision,
  PrefilledFormPayload,
} from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { SessionTokenService } from './session-token.service';
import { ExecutionEligibilityService } from '../eligibility/execution-eligibility.service';
import { TOKEN_VALIDATOR } from '../eligibility/eligibility.repository';
import type { ITokenValidator } from '../eligibility/eligibility.repository';
import type { Env } from '../../config/configuration';

/** Thrown by every legacy socket-fill entry point while the path is deprecated. */
export const LEGACY_EXECUTION_DEPRECATED = 'LEGACY_EXECUTION_DEPRECATED';
import {
  buildInstructionsFromMapping,
  buildFinalReviewStep,
  buildInstructionsFromPrefill,
  buildUploadInstructions,
} from './fill-instructions';
import type { FillInstruction } from './automation.types';
import { resolvePortalFillFor } from '../../strategies/portal-integration/portal-fill.registry';
import './portal-fills/canada-ircc'; // side-effect: registers the IRCC fill mapping
import './portal-fills/canada-ircc-eta'; // side-effect: registers the IRCC eTA fill mapping
import './portal-fills/canada-ircc-study-eapp'; // side-effect: the study permit questionnaire ('ircc-study')
import './portal-fills/canada-ircc-work-eapp'; // side-effect: the work permit questionnaire ('ircc-work')
import './portal-fills/canada-ircc-pr-family'; // side-effect: the spousal sponsorship PR portal ('ircc-pr-family')
import './portal-fills/canada-ircc-super-visa'; // side-effect: the super visa variant of 'ircc'
import './portal-fills/canada-ircc-business-visitor'; // side-effect: the business visitor variant of 'ircc'
import { embeddedVisaaiId, portalForRoute } from '../../strategies';

const DOWNLOAD_URL_TTL_SECONDS = 10 * 60;

@Injectable()
export class AutomationService {
  constructor(
    private supabase: SupabaseService,
    private tokens: SessionTokenService,
    private eligibility: ExecutionEligibilityService,
    private config: ConfigService<Env>,
    @Inject(TOKEN_VALIDATOR) private readonly execTokens: ITokenValidator,
  ) {}

  /** Phase 4B: legacy socket-fill is off unless explicitly enabled. */
  legacyWriteEnabled(): boolean {
    return (
      this.config.get('LEGACY_AUTOMATION_WRITE_ENABLED', { infer: true }) ===
      true
    );
  }

  private assertLegacyEnabled() {
    if (!this.legacyWriteEnabled()) {
      throw new GoneException(LEGACY_EXECUTION_DEPRECATED);
    }
  }

  /**
   * Phase 3E — READ-ONLY execution-eligibility gate. Delegates to
   * ExecutionEligibilityService.evaluate and shapes the gate decision. Purely
   * evaluative: mints no token, creates/mutates no session, triggers no
   * execution or browser automation. The only declared effect is the
   * service-owned EXECUTION_READY audit on a fully-eligible evaluation.
   * createSession (token mint) is intentionally NOT changed in this phase.
   */
  async evaluateExecutionGate(
    input: EligibilityCheckInput,
  ): Promise<ExecutionGateDecision> {
    const result = await this.eligibility.evaluate(input);
    return {
      eligible: result.eligible,
      blockedReasons: result.reasons,
      evaluationDetails: result.conditions,
      executionAllowed: result.eligible, // derived only; no side effects
    };
  }

  // F1: ownership runs under the caller's RLS-scoped client (user JWT path).
  private async verifyOwnership(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
  ) {
    const { data } = await db
      .from('applications')
      .select('id')
      .eq('id', applicationId)
      .eq('user_id', userId)
      .single();
    if (!data) throw new ForbiddenException('Access denied');
  }

  async createSession(
    db: SupabaseClient,
    applicationId: string,
    userId: string,
    portalUrl?: string,
  ) {
    // Not legacy-gated: the session token is how the extension authenticates
    // its socket for the VERIFIED path (portal-fill:start, Phase 7J), and
    // minting it writes nothing to a portal. Gating it (Phase 4B) made every
    // launch 410. The legacy WRITE path stays gated in buildInstructions and
    // the gateway's automation:start.
    await this.verifyOwnership(db, applicationId, userId);
    // Portal auto-fill is unlocked by the one-time form fee for this visa.
    if (!(await this.hasPaidPrefill(applicationId))) {
      throw new HttpException(
        'Pay the one-time form fee to let VisaAI auto-fill the official portal',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const { data: session, error } = await db
      .from('submission_sessions')
      .insert({
        application_id: applicationId,
        status: 'pending',
        portal_url: portalUrl ?? null,
      })
      .select('id')
      .single();

    if (error || !session)
      throw new Error('Failed to create submission session');

    const token = await this.tokens.mint({
      sessionId: session.id,
      applicationId,
      userId,
    });

    // Two credentials, two jobs: `token` is the single-use socket connect
    // token (Redis); `executionToken` is the HMAC token POST
    // /execution/request and portal-fill:start validate. Nothing minted the
    // latter before, so every execution request failed token_invalid.
    const executionToken = this.execTokens.mint(
      session.id,
      applicationId,
      userId,
    );

    return {
      sessionId: session.id,
      token,
      executionToken,
      portalUrl: portalUrl ?? null,
    };
  }

  async getSessionPortalUrl(sessionId: string): Promise<string | null> {
    const { data } = await this.supabase.admin
      .from('submission_sessions')
      .select('portal_url')
      .eq('id', sessionId)
      .single();
    return (data as { portal_url?: string | null } | null)?.portal_url ?? null;
  }

  /**
   * The portal this application's route files on ('ircc' for tr-rt, 'ircc-eta',
   * 'ircc-study', …), sent to the extension in automation:ready so its panel
   * can tell a page of another IRCC application flow from this one's (live
   * 2026-10-30). Null when unknown — a read error is never a guess.
   */
  async getApplicationPortalId(applicationId: string): Promise<string | null> {
    const { data, error } = await this.supabase.admin
      .from('applications')
      .select('destination_country, visa_types(visaai_id)')
      .eq('id', applicationId)
      .maybeSingle();
    if (error || !data) return null;
    const country = (data as { destination_country?: string | null })
      .destination_country;
    return portalForRoute(country, embeddedVisaaiId(data))?.portalId ?? null;
  }

  /**
   * Whether a reconnect may resume this session: it must still exist and not
   * have finished. Fails closed on a read error.
   */
  async isSessionResumable(sessionId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('submission_sessions')
      .select('status')
      .eq('id', sessionId)
      .maybeSingle();
    if (error || !data) return false;
    const status = (data as { status?: string }).status;
    return status === 'pending' || status === 'active' || status === 'paused';
  }

  async buildInstructions(applicationId: string): Promise<FillInstruction[]> {
    // Phase 4B: defense-in-depth — the legacy fill plan is never built while
    // deprecated, so no FillInstruction can reach the extension.
    this.assertLegacyEnabled();
    const fillSteps = await this.buildFillSteps(applicationId);
    const uploadDocs = await this.loadUploadableDocuments(applicationId);
    const uploadSteps = buildUploadInstructions(uploadDocs, fillSteps.length);
    const finalStep = buildFinalReviewStep(
      fillSteps.length + uploadSteps.length,
    );
    return [...fillSteps, ...uploadSteps, finalStep];
  }

  private async buildFillSteps(
    applicationId: string,
  ): Promise<FillInstruction[]> {
    const prefill = await this.loadPaidPrefill(applicationId);
    if (prefill) return buildInstructionsFromPrefill(prefill);

    const [{ data: app }, { data: profile }] = await Promise.all([
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
    ]);

    const raw = profile?.profile_json;
    const safeProfile =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : {};

    // Resolve the portal fill mapping from the destination country's strategy.
    // No country is hardcoded; a country with no registered mapping yields no
    // pre-filled steps (the applicant fills those fields manually).
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
    if (!mapping) return [];

    return buildInstructionsFromMapping(mapping, safeProfile);
  }

  private async loadUploadableDocuments(
    applicationId: string,
  ): Promise<
    Array<{ documentType: string; downloadUrl: string; fileName: string }>
  > {
    // A dropped `error` read as "no documents": the plan was built with no
    // upload steps and the applicant was walked to final review with nothing
    // attached. The order is what makes the de-dupe below keep the newest.
    const { data: docs, error } = await this.supabase.admin
      .from('documents')
      .select('document_type, storage_path, file_name, upload_status')
      .eq('application_id', applicationId)
      .eq('upload_status', 'complete')
      .order('created_at', { ascending: false });
    if (error)
      throw new Error(
        `could not load documents for ${applicationId}: ${error.message}`,
      );

    const rows =
      (docs as Array<{
        document_type: string | null;
        storage_path: string;
        file_name: string | null;
      }> | null) ?? [];

    // De-dupe by document_type so we don't try to attach the same doc twice
    // when a user has re-uploaded a corrected file. Keep the most recent (rows
    // are ordered newest-first by the query above).
    const seen = new Set<string>();
    const out: Array<{
      documentType: string;
      downloadUrl: string;
      fileName: string;
    }> = [];

    for (const row of rows) {
      const type = row.document_type ?? 'document';
      if (seen.has(type)) continue;
      seen.add(type);

      const { data: signed } = await this.supabase.admin.storage
        .from('documents')
        .createSignedUrl(row.storage_path, DOWNLOAD_URL_TTL_SECONDS);
      if (!signed?.signedUrl) continue;

      const fileName =
        row.file_name ?? row.storage_path.split('/').pop() ?? `${type}.pdf`;
      // Rewritten for the extension/browser — see
      // SupabaseService.toPublicStorageUrl. The raw value points at the
      // server's loopback Kong address and cannot be fetched off-box.
      out.push({
        documentType: type,
        downloadUrl: this.supabase.toPublicStorageUrl(signed.signedUrl),
        fileName,
      });
    }

    return out;
  }

  /** True when the one-time form fee has been paid for this application. */
  private async hasPaidPrefill(applicationId: string): Promise<boolean> {
    const { data } = await this.supabase.admin
      .from('payments')
      .select('id')
      .eq('application_id', applicationId)
      .eq('feature', 'prefill')
      .eq('status', 'complete')
      .limit(1);
    return (data?.length ?? 0) > 0;
  }

  private async loadPaidPrefill(
    applicationId: string,
  ): Promise<PrefilledFormPayload | null> {
    if (!(await this.hasPaidPrefill(applicationId))) return null;

    const { data: doc } = await this.supabase.admin
      .from('generated_documents')
      .select('content_md')
      .eq('application_id', applicationId)
      .eq('doc_type', 'prefilled_form_json')
      .maybeSingle();
    if (!doc) return null;

    try {
      return JSON.parse(doc.content_md) as PrefilledFormPayload;
    } catch {
      return null;
    }
  }

  async updateStatus(sessionId: string, status: string, errorLog?: string) {
    const update: Record<string, unknown> = { status };
    if (status === 'active') update.started_at = new Date().toISOString();
    if (status === 'complete' || status === 'error')
      update.completed_at = new Date().toISOString();
    if (errorLog) update.error_log = errorLog;

    const { error } = await this.supabase.admin
      .from('submission_sessions')
      .update(update)
      .eq('id', sessionId);
    if (error)
      throw new Error(`Failed to update session status: ${error.message}`);
  }

  async getSession(db: SupabaseClient, sessionId: string, userId: string) {
    const { data, error } = await db
      .from('submission_sessions')
      .select('*, applications!inner(user_id)')
      .eq('id', sessionId)
      .maybeSingle();

    // A failed read is not "not yours": a swallowed PostgREST error used to
    // answer 403 "Access denied", and the Submit page took the applicant for
    // someone else. No row (or someone else's) stays 403.
    if (error)
      throw new ServiceUnavailableException(
        'Could not read the submission session. Try again.',
      );

    if (
      !data ||
      (data.applications as unknown as { user_id: string }).user_id !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return data;
  }
}
