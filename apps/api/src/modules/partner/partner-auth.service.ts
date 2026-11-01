import { Inject, Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerPrincipal, PartnerScope } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  ipAllowed,
  isCredentialUsable,
  parseApiKey,
  secureCompare,
  sha256,
} from './partner-credentials';
import { PartnerErrors } from './partner-errors';
import { PARTNER_REPOSITORY } from './partner.tokens';
import type {
  IPartnerRepository,
  PartnerApplicationRow,
  PartnerRow,
} from './partner.repository';

/**
 * Resolves a presented credential into a PartnerPrincipal, or refuses.
 *
 * This is the authorization boundary for all partner traffic. There is no user
 * JWT on these requests, so RLS cannot help — every check that matters happens
 * here, and the repository is then called with the service-role client and
 * explicit filters derived from the principal.
 *
 * Order is deliberate, cheapest and most-decisive first:
 *   1. shape        — reject garbage without touching the database
 *   2. credential   — exists, hash matches, not revoked, not expired
 *   3. application  — active, not revoked
 *   4. partner      — approved / not suspended
 *   5. environment  — the credential's environment matches the application's
 *   6. network      — IP allow-list
 *   7. scopes       — intersected DOWN, never up
 */
@Injectable()
export class PartnerAuthService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  /** Service-role: partner requests carry no user identity to scope with. */
  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  /**
   * @param presented raw credential from the Authorization header
   * @param clientIp  request IP, already resolved through the proxy
   */
  async authenticate(
    presented: string,
    clientIp: string,
    now: Date = new Date(),
  ): Promise<PartnerPrincipal> {
    if (!presented) throw PartnerErrors.missingCredential();

    const parsedKey = parseApiKey(presented);
    return parsedKey
      ? this.authenticateApiKey(presented, parsedKey.prefix, clientIp, now)
      : this.authenticateToken(presented, clientIp, now);
  }

  private async authenticateApiKey(
    presented: string,
    prefix: string,
    clientIp: string,
    now: Date,
  ): Promise<PartnerPrincipal> {
    const key = await this.repo.getApiKeyByPrefix(this.db, prefix);
    // Compare the hash even when no row was found is impossible without a
    // stored value; the lookup itself is by a public prefix, so a miss here
    // leaks nothing beyond "no such prefix".
    if (!key) throw PartnerErrors.invalidCredential();
    if (!secureCompare(key.key_hash, sha256(presented))) {
      throw PartnerErrors.invalidCredential();
    }
    if (!isCredentialUsable(key, now)) throw PartnerErrors.invalidCredential();

    const { application, partner } = await this.loadAndCheckApplication(
      key.application_id,
      clientIp,
    );

    // A key's scopes are intersected with the application's on every request,
    // so narrowing an application immediately narrows every key it issued —
    // no need to hunt down and re-issue credentials.
    const scopes = intersect(key.scopes, application.scopes);

    await this.repo.touchApiKey(this.db, key.id, now.toISOString());

    return {
      partnerId: partner.id,
      organizationId: partner.organization_id,
      applicationId: application.id,
      clientId: application.client_id,
      environment: application.environment,
      scopes,
      credentialKind: 'api_key',
      credentialId: key.id,
      subjectUserId: null,
    };
  }

  private async authenticateToken(
    presented: string,
    clientIp: string,
    now: Date,
  ): Promise<PartnerPrincipal> {
    // Opaque tokens are looked up BY their hash, so an invalid token costs one
    // indexed miss and reveals nothing.
    const token = await this.repo.getAccessTokenByHash(
      this.db,
      sha256(presented),
    );
    if (!token) throw PartnerErrors.invalidCredential();
    if (token.revoked_at) throw PartnerErrors.invalidCredential();
    if (new Date(token.expires_at).getTime() <= now.getTime()) {
      throw PartnerErrors.invalidCredential();
    }

    const { application, partner } = await this.loadAndCheckApplication(
      token.application_id,
      clientIp,
    );

    await this.repo.touchAccessToken(this.db, token.id, now.toISOString());

    return {
      partnerId: partner.id,
      organizationId: partner.organization_id,
      applicationId: application.id,
      clientId: application.client_id,
      environment: application.environment,
      scopes: intersect(token.scopes, application.scopes),
      credentialKind: 'oauth_token',
      credentialId: token.id,
      subjectUserId: token.subject_user_id,
    };
  }

  private async loadAndCheckApplication(
    applicationId: string,
    clientIp: string,
  ): Promise<{ application: PartnerApplicationRow; partner: PartnerRow }> {
    const application = await this.repo.getApplication(this.db, applicationId);
    // A credential whose application vanished is not a 404 — from the caller's
    // side it is simply an invalid credential.
    if (!application) throw PartnerErrors.invalidCredential();
    if (application.revoked_at) throw PartnerErrors.invalidCredential();
    if (application.status !== 'active') {
      throw PartnerErrors.applicationInactive(
        application.status === 'suspended'
          ? (application.status_reason ?? 'the application is suspended')
          : 'the application is not approved for API access',
      );
    }

    const partner = await this.repo.getPartner(this.db, application.partner_id);
    if (!partner) throw PartnerErrors.invalidCredential();
    if (partner.status === 'suspended' || partner.status === 'rejected') {
      throw PartnerErrors.applicationInactive(
        partner.status_reason ?? `the partner account is ${partner.status}`,
      );
    }
    // A partner still awaiting approval may exercise sandbox only. This is the
    // gate that stops an unapproved integration touching real applicants.
    if (partner.status === 'pending' && application.environment === 'live') {
      throw PartnerErrors.applicationInactive(
        'the partner account has not been approved for live access',
      );
    }

    if (!ipAllowed(clientIp, application.ip_allowlist)) {
      throw PartnerErrors.ipNotAllowed();
    }

    return { application, partner };
  }

  /**
   * Consent check for anything reading a user's data. Called by the resource
   * routes, not the guard: only the routes know which user is being addressed.
   *
   * Consent must cover the scope being exercised, not merely exist — a user
   * who consented to `applications:read` has not consented to
   * `applications:write`.
   */
  async assertConsent(
    principal: PartnerPrincipal,
    userId: string,
    scope: PartnerScope,
  ): Promise<void> {
    const consent = await this.repo.getConsent(
      this.db,
      principal.applicationId,
      userId,
    );
    if (!consent || consent.revoked_at)
      throw PartnerErrors.consentRequired(scope);
    if (!consent.scopes.includes(scope))
      throw PartnerErrors.consentRequired(scope);
  }
}

function intersect(
  a: readonly PartnerScope[],
  b: readonly PartnerScope[],
): PartnerScope[] {
  const other = new Set<string>(b);
  return a.filter((s) => other.has(s));
}
