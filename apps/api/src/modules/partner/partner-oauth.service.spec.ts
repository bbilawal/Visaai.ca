import { createHash, randomBytes } from 'node:crypto';
import { InMemoryPartnerRepository } from './in-memory-partner.repository';
import { generateClientSecret, sha256 } from './partner-credentials';
import { OAuthException } from './partner-errors';
import { PartnerOAuthService } from './partner-oauth.service';

/**
 * OAuth 2.0 grants. The tests that matter here are the refusals: a permissive
 * authorization server is indistinguishable from no authorization at all.
 */
describe('PartnerOAuthService', () => {
  let repo: InMemoryPartnerRepository;
  let service: PartnerOAuthService;
  let secret: string;

  const supabase = { admin: {} } as never;
  const config = { get: () => undefined } as never;

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');

  async function seedClient(
    overrides: Partial<{
      grantTypes: string[];
      redirectUris: string[];
      scopes: string[];
      status: 'pending_review' | 'active' | 'suspended' | 'revoked';
      clientType: 'confidential' | 'public';
    }> = {},
  ) {
    const partner = await repo.createPartner(null, {
      organization_id: 'org-1',
      legal_name: 'Acme',
      contact_email: 'dev@acme.test',
      website: null,
      status: 'approved',
      tier: 'standard',
    });
    const generated = generateClientSecret();
    secret = generated.token;
    return repo.createApplication(null, {
      partner_id: partner.id,
      name: 'Acme',
      environment: 'live',
      client_id: 'client-1',
      client_secret_hash: generated.hash,
      client_type: overrides.clientType ?? 'confidential',
      status: overrides.status ?? 'active',
      scopes: (overrides.scopes ?? [
        'applications:read',
        'usage:read',
      ]) as never,
      grant_types: overrides.grantTypes ?? [
        'client_credentials',
        'authorization_code',
      ],
      redirect_uris: overrides.redirectUris ?? ['https://acme.test/callback'],
    });
  }

  beforeEach(() => {
    repo = new InMemoryPartnerRepository();
    service = new PartnerOAuthService(supabase, config, repo);
  });

  describe('client_credentials', () => {
    it('issues a token for a valid client', async () => {
      await seedClient();
      const response = await service.clientCredentials(
        'client-1',
        secret,
        undefined,
      );
      expect(response.token_type).toBe('Bearer');
      expect(response.access_token.startsWith('vat_')).toBe(true);
      expect(response.expires_in).toBeGreaterThan(0);
    });

    // The stored token must be a hash. A token recoverable from the database
    // is a token an operator or a dump can replay.
    it('stores only the hash of the token', async () => {
      await seedClient();
      const response = await service.clientCredentials(
        'client-1',
        secret,
        undefined,
      );
      expect(repo.tokens[0].token_hash).toBe(sha256(response.access_token));
      expect(JSON.stringify(repo.tokens)).not.toContain(response.access_token);
    });

    it('rejects a wrong client secret', async () => {
      await seedClient();
      await expect(
        service.clientCredentials('client-1', 'wrong', undefined),
      ).rejects.toThrow(OAuthException);
    });

    it('rejects an unknown client', async () => {
      await seedClient();
      await expect(
        service.clientCredentials('nope', secret, undefined),
      ).rejects.toThrow(OAuthException);
    });

    it('rejects a suspended client', async () => {
      await seedClient({ status: 'suspended' });
      await expect(
        service.clientCredentials('client-1', secret, undefined),
      ).rejects.toThrow(OAuthException);
    });

    it('rejects a client not permitted to use the grant', async () => {
      await seedClient({ grantTypes: ['authorization_code'] });
      await expect(
        service.clientCredentials('client-1', secret, undefined),
      ).rejects.toThrow(OAuthException);
    });

    it('narrows the issued scope to what was requested', async () => {
      await seedClient();
      const response = await service.clientCredentials(
        'client-1',
        secret,
        'usage:read',
      );
      expect(response.scope).toBe('usage:read');
    });

    // RFC 6749 §3.3 permits a narrower grant; escalation is what must not
    // happen.
    it('silently drops a requested scope the client does not hold', async () => {
      await seedClient({ scopes: ['usage:read'] });
      const response = await service.clientCredentials(
        'client-1',
        secret,
        'usage:read applications:write',
      );
      expect(response.scope).toBe('usage:read');
    });

    it('defaults to the full granted set when no scope is requested', async () => {
      await seedClient();
      const response = await service.clientCredentials(
        'client-1',
        secret,
        undefined,
      );
      expect(response.scope).toBe('applications:read usage:read');
    });
  });

  describe('authorization_code + PKCE', () => {
    it('issues a code and records the consent', async () => {
      const app = await seedClient();
      const result = await service.issueAuthorizationCode(
        'client-1',
        'user-1',
        'https://acme.test/callback',
        ['applications:read'],
        challenge,
        'S256',
      );
      expect(result.code.startsWith('vac_')).toBe(true);
      const consent = await repo.getConsent(null, app.id, 'user-1');
      expect(consent?.scopes).toEqual(['applications:read']);
    });

    it('exchanges a code for a token bound to the subject', async () => {
      await seedClient();
      const { code } = await service.issueAuthorizationCode(
        'client-1',
        'user-1',
        'https://acme.test/callback',
        ['applications:read'],
        challenge,
        'S256',
      );
      await service.exchangeAuthorizationCode(
        'client-1',
        secret,
        code,
        'https://acme.test/callback',
        verifier,
      );
      expect(repo.tokens[0].subject_user_id).toBe('user-1');
      expect(repo.tokens[0].grant_type).toBe('authorization_code');
    });

    // Single use. A code that can be exchanged twice is a code an attacker can
    // race the legitimate client for.
    it('refuses to exchange the same code twice', async () => {
      await seedClient();
      const { code } = await service.issueAuthorizationCode(
        'client-1',
        'user-1',
        'https://acme.test/callback',
        ['applications:read'],
        challenge,
        'S256',
      );
      await service.exchangeAuthorizationCode(
        'client-1',
        secret,
        code,
        'https://acme.test/callback',
        verifier,
      );
      await expect(
        service.exchangeAuthorizationCode(
          'client-1',
          secret,
          code,
          'https://acme.test/callback',
          verifier,
        ),
      ).rejects.toThrow(OAuthException);
    });

    it('refuses a wrong PKCE verifier', async () => {
      await seedClient();
      const { code } = await service.issueAuthorizationCode(
        'client-1',
        'user-1',
        'https://acme.test/callback',
        ['applications:read'],
        challenge,
        'S256',
      );
      await expect(
        service.exchangeAuthorizationCode(
          'client-1',
          secret,
          code,
          'https://acme.test/callback',
          randomBytes(32).toString('base64url'),
        ),
      ).rejects.toThrow(OAuthException);
    });

    // A failed exchange still burns the code: the code may be in the wrong
    // hands, so a retry must not be possible.
    it('burns the code even when PKCE verification fails', async () => {
      await seedClient();
      const { code } = await service.issueAuthorizationCode(
        'client-1',
        'user-1',
        'https://acme.test/callback',
        ['applications:read'],
        challenge,
        'S256',
      );
      await service
        .exchangeAuthorizationCode(
          'client-1',
          secret,
          code,
          'https://acme.test/callback',
          randomBytes(32).toString('base64url'),
        )
        .catch(() => undefined);
      await expect(
        service.exchangeAuthorizationCode(
          'client-1',
          secret,
          code,
          'https://acme.test/callback',
          verifier,
        ),
      ).rejects.toThrow(OAuthException);
    });

    it('refuses a redirect_uri that differs from the one used to obtain the code', async () => {
      await seedClient({
        redirectUris: ['https://acme.test/callback', 'https://acme.test/other'],
      });
      const { code } = await service.issueAuthorizationCode(
        'client-1',
        'user-1',
        'https://acme.test/callback',
        ['applications:read'],
        challenge,
        'S256',
      );
      await expect(
        service.exchangeAuthorizationCode(
          'client-1',
          secret,
          code,
          'https://acme.test/other',
          verifier,
        ),
      ).rejects.toThrow(OAuthException);
    });

    // Open redirect: exact matching only.
    it('refuses an unregistered redirect_uri at authorization time', async () => {
      await seedClient();
      await expect(
        service.issueAuthorizationCode(
          'client-1',
          'user-1',
          'https://evil.test/callback',
          ['applications:read'],
          challenge,
          'S256',
        ),
      ).rejects.toThrow(OAuthException);
    });

    it('refuses a redirect_uri that merely starts with a registered one', async () => {
      await seedClient({ redirectUris: ['https://acme.test/callback'] });
      await expect(
        service.issueAuthorizationCode(
          'client-1',
          'user-1',
          'https://acme.test/callback.evil.test',
          ['applications:read'],
          challenge,
          'S256',
        ),
      ).rejects.toThrow(OAuthException);
    });

    it('requires PKCE S256', async () => {
      await seedClient();
      await expect(
        service.issueAuthorizationCode(
          'client-1',
          'user-1',
          'https://acme.test/callback',
          ['applications:read'],
          challenge,
          'plain',
        ),
      ).rejects.toThrow(OAuthException);
    });

    it('refuses when none of the requested scopes are granted', async () => {
      await seedClient({ scopes: ['usage:read'] });
      await expect(
        service.issueAuthorizationCode(
          'client-1',
          'user-1',
          'https://acme.test/callback',
          ['documents:read'],
          challenge,
          'S256',
        ),
      ).rejects.toThrow(OAuthException);
    });

    it('refuses a client not permitted to use the grant', async () => {
      await seedClient({ grantTypes: ['client_credentials'] });
      await expect(
        service.issueAuthorizationCode(
          'client-1',
          'user-1',
          'https://acme.test/callback',
          ['applications:read'],
          challenge,
          'S256',
        ),
      ).rejects.toThrow(OAuthException);
    });

    it('requires a confidential client to present its secret at exchange', async () => {
      await seedClient();
      const { code } = await service.issueAuthorizationCode(
        'client-1',
        'user-1',
        'https://acme.test/callback',
        ['applications:read'],
        challenge,
        'S256',
      );
      await expect(
        service.exchangeAuthorizationCode(
          'client-1',
          undefined,
          code,
          'https://acme.test/callback',
          verifier,
        ),
      ).rejects.toThrow(OAuthException);
    });
  });

  describe('revocation', () => {
    it('revokes a token belonging to the client', async () => {
      await seedClient();
      const issued = await service.clientCredentials(
        'client-1',
        secret,
        undefined,
      );
      await service.revoke('client-1', secret, issued.access_token);
      expect(repo.tokens[0].revoked_at).not.toBeNull();
    });

    // RFC 7009: an unknown token still succeeds, so the endpoint cannot be
    // used to test whether a stolen token is live.
    it('reports success for an unknown token', async () => {
      await seedClient();
      await expect(
        service.revoke('client-1', secret, 'vat_unknown'),
      ).resolves.toBeUndefined();
    });

    it("refuses to revoke another client's token", async () => {
      await seedClient();
      const issued = await service.clientCredentials(
        'client-1',
        secret,
        undefined,
      );

      const otherSecret = generateClientSecret();
      await repo.createApplication(null, {
        partner_id: repo.partners[0].id,
        name: 'Other',
        environment: 'live',
        client_id: 'client-2',
        client_secret_hash: otherSecret.hash,
        status: 'active',
        scopes: [],
      });

      await service.revoke('client-2', otherSecret.token, issued.access_token);
      // Untouched: revocation is scoped to the owning client.
      expect(repo.tokens[0].revoked_at).toBeNull();
    });

    it('rejects revocation with a bad client secret', async () => {
      await seedClient();
      const issued = await service.clientCredentials(
        'client-1',
        secret,
        undefined,
      );
      await expect(
        service.revoke('client-1', 'wrong', issued.access_token),
      ).rejects.toThrow(OAuthException);
    });
  });
});
