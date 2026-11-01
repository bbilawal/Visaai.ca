import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { OAuthException } from './partner-errors';
import { effectiveScopes, scopeDefinition } from './partner-scopes';
import { PARTNER_REPOSITORY } from './partner.tokens';
import type { IPartnerRepository } from './partner.repository';

/**
 * End-user consent: what a user is being asked to allow, what they have
 * already allowed, and how they take it back.
 *
 * The consent screen must state, in plain language, exactly what the partner
 * will be able to see. A screen that says "this app wants access to your
 * account" is not consent — it is a click-through.
 */
@Injectable()
export class PartnerConsentService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  /** Everything the approval screen needs. */
  async describe(
    clientId: string,
    redirectUri: string,
    requestedScopes: string[],
    userId: string,
  ): Promise<Record<string, unknown>> {
    const application = await this.repo.getApplicationByClientId(
      this.db,
      clientId,
    );
    if (
      !application ||
      application.status !== 'active' ||
      application.revoked_at
    ) {
      throw new OAuthException(
        400,
        'invalid_client',
        'Unknown or inactive client.',
      );
    }
    if (!application.redirect_uris.includes(redirectUri)) {
      throw new OAuthException(
        400,
        'invalid_request',
        'redirect_uri does not match a registered URI for this client.',
      );
    }

    const partner = await this.repo.getPartner(this.db, application.partner_id);
    const scopes = effectiveScopes(requestedScopes, application.scopes);
    const existing = await this.repo.getConsent(
      this.db,
      application.id,
      userId,
    );

    return {
      client_id: application.client_id,
      application_name: application.name,
      partner_name: partner?.legal_name ?? 'Unknown partner',
      partner_website: partner?.website ?? null,
      environment: application.environment,
      // Every scope spelled out. This list IS the consent.
      scopes: scopes.map((scope) => ({
        scope,
        description: scopeDefinition(scope).description,
        data_classification: scopeDefinition(scope).dataClassification,
      })),
      already_granted: existing && !existing.revoked_at ? existing.scopes : [],
      // A partner that has not been approved for live is worth flagging to the
      // user rather than hiding behind a familiar-looking dialog.
      partner_approved: partner?.status === 'approved',
    };
  }

  /** Consents a user has granted, for their privacy settings page. */
  async listForUser(userId: string): Promise<Record<string, unknown>[]> {
    const consents = await this.repo.listConsentsForUser(this.db, userId);
    const out: Record<string, unknown>[] = [];
    for (const consent of consents) {
      const application = await this.repo.getApplication(
        this.db,
        consent.application_id,
      );
      if (!application) continue;
      const partner = await this.repo.getPartner(
        this.db,
        application.partner_id,
      );
      out.push({
        application_id: application.id,
        application_name: application.name,
        partner_name: partner?.legal_name ?? 'Unknown partner',
        environment: application.environment,
        scopes: consent.scopes.map((scope) => ({
          scope,
          description: scopeDefinition(scope).description,
        })),
        granted_at: consent.granted_at,
      });
    }
    return out;
  }

  /**
   * Revoke. Kills the consent AND every token issued under it — a revocation
   * that leaves live tokens working is not a revocation, and "your access
   * ends within the hour" is not what a user pressing this button expects.
   */
  async revoke(
    userId: string,
    applicationId: string,
  ): Promise<{ revoked: boolean }> {
    const consent = await this.repo.getConsent(this.db, applicationId, userId);
    if (!consent)
      throw new NotFoundException('No consent found for that application.');

    const now = new Date().toISOString();
    const revoked = await this.repo.revokeConsent(
      this.db,
      applicationId,
      userId,
      now,
    );
    await this.revokeSubjectTokens(applicationId, userId, now);
    return { revoked };
  }

  private async revokeSubjectTokens(
    applicationId: string,
    userId: string,
    at: string,
  ): Promise<void> {
    const res = await this.db
      .from('partner_access_tokens')
      .update({ revoked_at: at })
      .eq('application_id', applicationId)
      .eq('subject_user_id', userId)
      .is('revoked_at', null);
    if (res.error) throw new Error(res.error.message);
  }
}
