import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PartnerScope, PartnerTokenResponse } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  generateAccessToken,
  generateAuthorizationCode,
  secureCompare,
  sha256,
  tokenExpiry,
  verifyPkce,
} from './partner-credentials';
import { OAuthException } from './partner-errors';
import {
  effectiveScopes,
  formatScopeString,
  parseScopeString,
} from './partner-scopes';
import {
  PARTNER_CONFIG,
  PARTNER_DEFAULTS,
  PARTNER_REPOSITORY,
} from './partner.tokens';
import type {
  IPartnerRepository,
  PartnerApplicationRow,
} from './partner.repository';

/**
 * OAuth 2.0 authorization server for partner clients.
 *
 * Grants supported:
 *   client_credentials — machine-to-machine, no user data without consent
 *   authorization_code + PKCE — user-consented access
 *
 * Deliberately NOT supported:
 *   password grant   — hands a partner the user's VisaAI password. Never.
 *   implicit grant   — deprecated; puts tokens in URLs and browser history.
 *   refresh tokens   — see the note on `issueToken` below.
 */
@Injectable()
export class PartnerOAuthService {
  private readonly log = new Logger(PartnerOAuthService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    @Inject(PARTNER_REPOSITORY) private readonly repo: IPartnerRepository,
  ) {}

  private get db(): SupabaseClient {
    return this.supabase.admin;
  }

  private get tokenTtl(): number {
    return (
      this.config.get<number>(PARTNER_CONFIG.tokenTtlSeconds) ??
      PARTNER_DEFAULTS.tokenTtlSeconds
    );
  }

  private get codeTtl(): number {
    return (
      this.config.get<number>(PARTNER_CONFIG.authCodeTtlSeconds) ??
      PARTNER_DEFAULTS.authCodeTtlSeconds
    );
  }

  // ---- client_credentials ---------------------------------------------

  async clientCredentials(
    clientId: string,
    clientSecret: string,
    scopeParam: string | undefined,
    now: Date = new Date(),
  ): Promise<PartnerTokenResponse> {
    const application = await this.authenticateClient(clientId, clientSecret);

    if (!application.grant_types.includes('client_credentials')) {
      throw new OAuthException(
        400,
        'unauthorized_client',
        'This client is not permitted to use the client_credentials grant.',
      );
    }

    const scopes = effectiveScopes(
      parseScopeString(scopeParam),
      application.scopes,
    );
    return this.issueToken(
      application,
      scopes,
      'client_credentials',
      null,
      now,
    );
  }

  // ---- authorization_code + PKCE ---------------------------------------

  /**
   * Called by the consent screen once a signed-in VisaAI user approves. The
   * user's identity comes from their own session — a partner can never assert
   * who the user is.
   */
  async issueAuthorizationCode(
    clientId: string,
    subjectUserId: string,
    redirectUri: string,
    requestedScopes: string[],
    codeChallenge: string,
    codeChallengeMethod: string,
    now: Date = new Date(),
  ): Promise<{ code: string; scopes: PartnerScope[] }> {
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
    if (!application.grant_types.includes('authorization_code')) {
      throw new OAuthException(
        400,
        'unauthorized_client',
        'This client is not permitted to use the authorization_code grant.',
      );
    }
    // Exact match, no prefix or wildcard matching: an open redirect here hands
    // the code to whoever crafted the URL.
    if (!application.redirect_uris.includes(redirectUri)) {
      throw new OAuthException(
        400,
        'invalid_request',
        'redirect_uri does not exactly match a registered URI for this client.',
      );
    }
    if (codeChallengeMethod !== 'S256' || !codeChallenge) {
      throw new OAuthException(
        400,
        'invalid_request',
        'PKCE with code_challenge_method=S256 is required.',
      );
    }

    const scopes = effectiveScopes(requestedScopes, application.scopes);
    if (scopes.length === 0) {
      throw new OAuthException(
        400,
        'invalid_scope',
        'None of the requested scopes are granted to this application.',
      );
    }

    const code = generateAuthorizationCode();
    await this.repo.createAuthorizationCode(this.db, {
      application_id: application.id,
      code_hash: code.hash,
      subject_user_id: subjectUserId,
      scopes,
      redirect_uri: redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      expires_at: tokenExpiry(now, this.codeTtl),
    });

    // Consent is recorded at the moment of approval, not at first use: the
    // user's decision is the fact worth persisting.
    await this.repo.upsertConsent(
      this.db,
      application.id,
      subjectUserId,
      scopes,
    );

    return { code: code.token, scopes };
  }

  async exchangeAuthorizationCode(
    clientId: string,
    clientSecret: string | undefined,
    code: string,
    redirectUri: string,
    codeVerifier: string,
    now: Date = new Date(),
  ): Promise<PartnerTokenResponse> {
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
        401,
        'invalid_client',
        'Unknown or inactive client.',
      );
    }
    // Confidential clients must still prove themselves; public (PKCE-only)
    // clients have no secret to prove with, and PKCE is what protects them.
    if (application.client_type === 'confidential') {
      this.assertClientSecret(application, clientSecret);
    }

    // Consume first. If the verifier then fails, the code is already burned —
    // which is correct: a failed exchange means the code may be in the wrong
    // hands, and a second attempt must not be possible.
    const stored = await this.repo.consumeAuthorizationCode(
      this.db,
      sha256(code),
      now.toISOString(),
    );
    if (!stored) {
      throw new OAuthException(
        400,
        'invalid_grant',
        'The authorization code is invalid or has already been used.',
      );
    }
    if (stored.application_id !== application.id) {
      this.log.warn(
        `client ${clientId} attempted to exchange a code issued to another client`,
      );
      throw new OAuthException(
        400,
        'invalid_grant',
        'The authorization code is invalid.',
      );
    }
    if (new Date(stored.expires_at).getTime() <= now.getTime()) {
      throw new OAuthException(
        400,
        'invalid_grant',
        'The authorization code has expired.',
      );
    }
    if (stored.redirect_uri !== redirectUri) {
      throw new OAuthException(
        400,
        'invalid_grant',
        'redirect_uri does not match the one used to obtain the code.',
      );
    }
    if (
      !verifyPkce(
        codeVerifier,
        stored.code_challenge,
        stored.code_challenge_method,
      )
    ) {
      throw new OAuthException(
        400,
        'invalid_grant',
        'PKCE verification failed.',
      );
    }

    return this.issueToken(
      application,
      stored.scopes,
      'authorization_code',
      stored.subject_user_id,
      now,
    );
  }

  // ---- revocation (RFC 7009) -------------------------------------------

  /**
   * Always returns success. RFC 7009 requires it: telling a caller that a
   * token "was not found" turns the revocation endpoint into an oracle for
   * checking whether a stolen token is still live.
   */
  async revoke(
    clientId: string,
    clientSecret: string,
    token: string,
    now: Date = new Date(),
  ): Promise<void> {
    const application = await this.authenticateClient(clientId, clientSecret);
    const stored = await this.repo.getAccessTokenByHash(this.db, sha256(token));
    if (!stored || stored.application_id !== application.id) return;
    await this.repo.revokeAccessToken(
      this.db,
      sha256(token),
      now.toISOString(),
    );
  }

  // ---- internals -------------------------------------------------------

  private async authenticateClient(
    clientId: string,
    clientSecret: string,
  ): Promise<PartnerApplicationRow> {
    const application = await this.repo.getApplicationByClientId(
      this.db,
      clientId,
    );
    if (!application || application.revoked_at) {
      throw new OAuthException(
        401,
        'invalid_client',
        'Client authentication failed.',
      );
    }
    if (application.status !== 'active') {
      throw new OAuthException(
        401,
        'invalid_client',
        'This client is not active.',
      );
    }
    this.assertClientSecret(application, clientSecret);
    return application;
  }

  private assertClientSecret(
    application: PartnerApplicationRow,
    clientSecret: string | undefined,
  ): void {
    if (!application.client_secret_hash || !clientSecret) {
      throw new OAuthException(
        401,
        'invalid_client',
        'Client authentication failed.',
      );
    }
    if (!secureCompare(application.client_secret_hash, sha256(clientSecret))) {
      throw new OAuthException(
        401,
        'invalid_client',
        'Client authentication failed.',
      );
    }
  }

  /**
   * Issue an opaque token.
   *
   * No refresh token is issued, by choice. client_credentials clients can
   * simply request another token — RFC 6749 §4.4.3 says not to issue one. For
   * authorization_code, a refresh token is a long-lived credential that would
   * outlive the user's ability to see and revoke it in the portal; until that
   * revocation UX exists, re-consent is the honest mechanism. Recorded as debt
   * (PD-6) rather than pretended away.
   */
  private async issueToken(
    application: PartnerApplicationRow,
    scopes: PartnerScope[],
    grantType: 'client_credentials' | 'authorization_code',
    subjectUserId: string | null,
    now: Date,
  ): Promise<PartnerTokenResponse> {
    const generated = generateAccessToken();
    const ttl = this.tokenTtl;
    await this.repo.createAccessToken(this.db, {
      application_id: application.id,
      token_hash: generated.hash,
      scopes,
      grant_type: grantType,
      subject_user_id: subjectUserId,
      expires_at: tokenExpiry(now, ttl),
    });

    return {
      access_token: generated.token,
      token_type: 'Bearer',
      expires_in: ttl,
      scope: formatScopeString(scopes),
    };
  }
}
