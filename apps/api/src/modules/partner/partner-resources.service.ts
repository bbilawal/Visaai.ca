import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerPrincipal } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerErrors } from './partner-errors';
import { PartnerSandboxService } from './partner-sandbox.service';
import { PARTNER_REPOSITORY } from './partner.tokens';
import type { IPartnerRepository } from './partner.repository';

/**
 * The immigration resources a partner may read or create, and — more
 * importantly — the projection that decides what they may see.
 *
 * Two rules govern everything here:
 *
 * 1. **Consent per subject, per scope.** A partner never gets "all
 *    applications". They ask about a specific user, and that user must have
 *    granted the exact scope being exercised.
 *
 * 2. **Allow-list projection.** Responses are built field by field from an
 *    explicit list. A `select('*')` passed to a partner would leak whatever
 *    column the next migration adds — internal risk indicators, AI notes,
 *    plan tiers. The mapping functions below are the review surface for
 *    "what can a partner see", and they are the only way data leaves.
 *
 * Sandbox traffic is routed to PartnerSandboxService before any production
 * table is touched.
 */
@Injectable()
export class PartnerResourcesService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly auth: PartnerAuthService,
    private readonly sandbox: PartnerSandboxService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  // ---- applications -----------------------------------------------------

  async listApplications(
    principal: PartnerPrincipal,
    userId: string | null,
  ): Promise<Record<string, unknown>[]> {
    if (principal.environment === 'sandbox') {
      return this.sandbox.listApplications(principal);
    }

    const subject = this.resolveSubject(principal, userId);
    await this.auth.assertConsent(principal, subject, 'applications:read');

    const res = await this.db
      .from('applications')
      .select(
        'id, user_id, status, framework_id, vri_score, submitted_at, decision_at, created_at',
      )
      .eq('user_id', subject)
      .order('created_at', { ascending: false })
      .limit(100);
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []).map(toApplicationView);
  }

  async getApplication(
    principal: PartnerPrincipal,
    id: string,
  ): Promise<Record<string, unknown>> {
    if (principal.environment === 'sandbox') {
      const found = await this.sandbox.getApplication(principal, id);
      if (!found) throw PartnerErrors.notFound('application');
      return found;
    }

    const res = await this.db
      .from('applications')
      .select(
        'id, user_id, status, framework_id, vri_score, submitted_at, decision_at, created_at',
      )
      .eq('id', id)
      .maybeSingle();
    if (res.error) throw new Error(res.error.message);
    const row = res.data as { user_id: string } | null;
    // 404 before the consent check would confirm the id exists; consent-first
    // would 403 on ids that do not exist. Both leak. Checking consent against
    // the resolved owner and returning 404 for everything else does not.
    if (!row) throw PartnerErrors.notFound('application');
    await this.auth.assertConsent(principal, row.user_id, 'applications:read');
    return toApplicationView(row);
  }

  async createApplication(
    principal: PartnerPrincipal,
    input: {
      user_id?: string;
      country?: string;
      visa_type?: string;
      framework_id?: string;
    },
  ): Promise<Record<string, unknown>> {
    if (principal.environment === 'sandbox') {
      return this.sandbox.createApplication(principal, {
        country: input.country ?? 'CA',
        visa_type: input.visa_type ?? 'visitor',
      });
    }

    const subject = this.resolveSubject(principal, input.user_id ?? null);
    await this.auth.assertConsent(principal, subject, 'applications:write');

    const res = await this.db
      .from('applications')
      .insert({
        user_id: subject,
        framework_id: input.framework_id ?? null,
        status: 'draft',
      })
      .select(
        'id, user_id, status, framework_id, vri_score, submitted_at, decision_at, created_at',
      )
      .single();
    if (res.error) throw new Error(res.error.message);
    return toApplicationView(res.data);
  }

  // ---- documents ---------------------------------------------------------

  async listDocuments(
    principal: PartnerPrincipal,
    applicationId: string,
  ): Promise<Record<string, unknown>[]> {
    if (principal.environment === 'sandbox') {
      return this.sandbox.listDocuments(principal, applicationId);
    }

    const owner = await this.db
      .from('applications')
      .select('user_id')
      .eq('id', applicationId)
      .maybeSingle();
    if (owner.error) throw new Error(owner.error.message);
    const ownerId = ownerUserId(owner.data);
    if (!ownerId) throw PartnerErrors.notFound('application');
    await this.auth.assertConsent(principal, ownerId, 'documents:read');

    const res = await this.db
      .from('documents')
      .select(
        'id, application_id, file_name, mime_type, upload_status, ocr_status, created_at',
      )
      .eq('application_id', applicationId)
      .order('created_at', { ascending: false })
      .limit(200);
    if (res.error) throw new Error(res.error.message);
    return (res.data ?? []).map(toDocumentView);
  }

  // ---- consents ----------------------------------------------------------

  async listConsents(
    principal: PartnerPrincipal,
    limit: number,
    cursor: { createdAt: string; id: string } | null,
  ): Promise<
    {
      user_id: string;
      scopes: string[];
      granted_at: string;
      id: string;
      created_at: string;
    }[]
  > {
    const rows = await this.repo.listConsentsForApplication(
      this.db,
      principal.applicationId,
      limit,
      cursor,
    );
    return rows.map((r) => ({
      id: r.id,
      user_id: r.user_id,
      scopes: r.scopes,
      granted_at: r.granted_at,
      // The pagination helper sorts on created_at; consents record granted_at.
      created_at: r.granted_at,
    }));
  }

  /**
   * Which user this request is about.
   *
   * A user-consented token already names its subject, and a partner must not
   * be able to override it — that would turn one user's consent into access to
   * another's. A client_credentials token has no subject, so the caller must
   * name one explicitly and consent is checked against it.
   */
  private resolveSubject(
    principal: PartnerPrincipal,
    requested: string | null,
  ): string {
    if (principal.subjectUserId) {
      if (requested && requested !== principal.subjectUserId) {
        throw PartnerErrors.consentRequired('applications:read');
      }
      return principal.subjectUserId;
    }
    if (!requested) {
      throw PartnerErrors.invalidRequest(
        'This credential is not bound to a user. Provide `user_id` for a user whose consent you hold.',
        'user_id',
      );
    }
    return requested;
  }
}

/**
 * The Supabase client here is untyped (no generated `Database` type), so every
 * `data` is `any`. This is the single place that narrows an owner id, so the
 * cast is reviewed once instead of scattered.
 */
function ownerUserId(data: unknown): string | null {
  const value = (data as { user_id?: unknown } | null)?.user_id;
  return typeof value === 'string' ? value : null;
}

/**
 * Application projection. Everything a partner sees about an application is
 * listed here; nothing else can escape.
 *
 * Deliberately absent: `plan_tier` (our commercial relationship with the
 * applicant, not the partner's business) and anything from
 * `application_profiles` (`risk_indicators_json` is an internal assessment
 * that would be damaging if surfaced to a third party).
 */
function toApplicationView(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id: row.id,
    user_id: row.user_id,
    status: row.status,
    framework_id: row.framework_id ?? null,
    readiness_score: row.vri_score ?? null,
    submitted_at: row.submitted_at ?? null,
    decided_at: row.decision_at ?? null,
    created_at: row.created_at,
  };
}

/**
 * Document projection: METADATA ONLY.
 *
 * No `storage_path` (it is a handle to the file itself), no extracted field
 * values, no verification findings. A partner learns that a passport was
 * uploaded and whether processing finished — never what it says.
 */
function toDocumentView(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    application_id: row.application_id,
    file_name: row.file_name,
    mime_type: row.mime_type,
    upload_status: row.upload_status,
    processing_status: row.ocr_status,
    created_at: row.created_at,
  };
}
