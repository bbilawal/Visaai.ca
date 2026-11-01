import type { PartnerScope } from '@visaai/types';
import { InMemoryPartnerRepository } from './in-memory-partner.repository';
import { PartnerAuthService } from './partner-auth.service';
import {
  generateApiKey,
  generateAccessToken,
  tokenExpiry,
} from './partner-credentials';
import { PartnerApiException } from './partner-errors';

/**
 * Authentication and authorization for partner traffic.
 *
 * This is the boundary that replaces RLS for requests with no user JWT, so
 * these tests carry the weight that the RLS policies carry elsewhere.
 */
describe('PartnerAuthService', () => {
  let repo: InMemoryPartnerRepository;
  let service: PartnerAuthService;

  const supabase = { admin: {} } as never;

  async function seed(
    options: {
      partnerStatus?: 'pending' | 'approved' | 'suspended' | 'rejected';
      appStatus?: 'pending_review' | 'active' | 'suspended' | 'revoked';
      environment?: 'sandbox' | 'live';
      appScopes?: PartnerScope[];
      keyScopes?: PartnerScope[];
      ipAllowlist?: string[];
      expiresAt?: string | null;
    } = {},
  ) {
    const partner = await repo.createPartner(null, {
      organization_id: 'org-1',
      legal_name: 'Acme Immigration',
      contact_email: 'dev@acme.test',
      website: null,
      status: options.partnerStatus ?? 'approved',
      tier: 'standard',
    });
    const application = await repo.createApplication(null, {
      partner_id: partner.id,
      name: 'Acme integration',
      environment: options.environment ?? 'live',
      client_id: 'vac_live_abc',
      status: options.appStatus ?? 'active',
      scopes: options.appScopes ?? ['applications:read', 'usage:read'],
      ip_allowlist: options.ipAllowlist ?? [],
    });
    const generated = generateApiKey(application.environment);
    const key = await repo.createApiKey(null, {
      application_id: application.id,
      name: 'primary',
      prefix: generated.prefix,
      key_hash: generated.hash,
      last_four: generated.lastFour,
      scopes: options.keyScopes ??
        options.appScopes ?? ['applications:read', 'usage:read'],
      status: 'active',
      expires_at: options.expiresAt ?? null,
    });
    return { partner, application, key, plaintext: generated.key };
  }

  beforeEach(() => {
    repo = new InMemoryPartnerRepository();
    service = new PartnerAuthService(supabase, repo);
  });

  describe('API keys', () => {
    it('authenticates a valid key', async () => {
      const { plaintext, application, partner } = await seed();
      const principal = await service.authenticate(plaintext, '203.0.113.1');
      expect(principal.applicationId).toBe(application.id);
      expect(principal.partnerId).toBe(partner.id);
      expect(principal.organizationId).toBe('org-1');
      expect(principal.credentialKind).toBe('api_key');
      expect(principal.subjectUserId).toBeNull();
    });

    it('rejects an empty credential', async () => {
      await expect(service.authenticate('', '203.0.113.1')).rejects.toThrow(
        PartnerApiException,
      );
    });

    it('rejects a key with the right prefix but the wrong secret', async () => {
      const { plaintext } = await seed();
      // Same prefix, different secret — the hash comparison must catch it.
      const forged = `${plaintext.slice(0, plaintext.lastIndexOf('_'))}_forgedsecretforgedsecretforgedsecret`;
      await expect(
        service.authenticate(forged, '203.0.113.1'),
      ).rejects.toMatchObject({
        code: 'invalid_credential',
      });
    });

    it('rejects an unknown prefix', async () => {
      const other = generateApiKey('live');
      await expect(
        service.authenticate(other.key, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'invalid_credential' });
    });

    it('rejects a revoked key', async () => {
      const { plaintext, key } = await seed();
      await repo.updateApiKey(null, key.id, {
        status: 'revoked',
        revoked_at: new Date().toISOString(),
      });
      await expect(
        service.authenticate(plaintext, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'invalid_credential' });
    });

    it('rejects an expired key', async () => {
      const { plaintext } = await seed({
        expiresAt: '2020-01-01T00:00:00.000Z',
      });
      await expect(
        service.authenticate(plaintext, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'invalid_credential' });
    });

    it('records last-used on success', async () => {
      const { plaintext, key } = await seed();
      await service.authenticate(plaintext, '203.0.113.1');
      expect((await repo.getApiKey(null, key.id))?.last_used_at).not.toBeNull();
    });
  });

  describe('application and partner state', () => {
    it('refuses a suspended application', async () => {
      const { plaintext } = await seed({ appStatus: 'suspended' });
      await expect(
        service.authenticate(plaintext, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'application_inactive' });
    });

    it('refuses an application still awaiting review', async () => {
      const { plaintext } = await seed({ appStatus: 'pending_review' });
      await expect(
        service.authenticate(plaintext, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'application_inactive' });
    });

    it('refuses a suspended partner even with an active application', async () => {
      const { plaintext } = await seed({ partnerStatus: 'suspended' });
      await expect(
        service.authenticate(plaintext, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'application_inactive' });
    });

    // The gate that keeps unapproved integrations away from real applicants.
    it('refuses live traffic from a partner that is only pending', async () => {
      const { plaintext } = await seed({
        partnerStatus: 'pending',
        environment: 'live',
      });
      await expect(
        service.authenticate(plaintext, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'application_inactive' });
    });

    it('allows sandbox traffic from a partner that is only pending', async () => {
      const { plaintext } = await seed({
        partnerStatus: 'pending',
        environment: 'sandbox',
      });
      const principal = await service.authenticate(plaintext, '203.0.113.1');
      expect(principal.environment).toBe('sandbox');
    });

    it('refuses a revoked application', async () => {
      const { plaintext, application } = await seed();
      await repo.updateApplication(null, application.id, {
        revoked_at: new Date().toISOString(),
      });
      await expect(
        service.authenticate(plaintext, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'invalid_credential' });
    });
  });

  describe('IP allow-list', () => {
    it('permits an address inside the allow-list', async () => {
      const { plaintext } = await seed({ ipAllowlist: ['203.0.113.0/24'] });
      await expect(
        service.authenticate(plaintext, '203.0.113.7'),
      ).resolves.toBeDefined();
    });

    it('refuses an address outside it', async () => {
      const { plaintext } = await seed({ ipAllowlist: ['203.0.113.0/24'] });
      await expect(
        service.authenticate(plaintext, '198.51.100.7'),
      ).rejects.toMatchObject({ code: 'ip_not_allowed' });
    });

    it('permits anything when the allow-list is empty', async () => {
      const { plaintext } = await seed({ ipAllowlist: [] });
      await expect(
        service.authenticate(plaintext, '198.51.100.7'),
      ).resolves.toBeDefined();
    });
  });

  describe('scope narrowing', () => {
    it('intersects the key scopes with the application scopes', async () => {
      const { plaintext } = await seed({
        appScopes: ['applications:read', 'usage:read'],
        keyScopes: ['usage:read'],
      });
      const principal = await service.authenticate(plaintext, '203.0.113.1');
      expect(principal.scopes).toEqual(['usage:read']);
    });

    // The escalation path that must not exist: a key holding more than its
    // application does not get the extra scope.
    it('never grants a key scope the application does not hold', async () => {
      const { plaintext } = await seed({
        appScopes: ['usage:read'],
        keyScopes: ['usage:read', 'applications:read', 'documents:read'],
      });
      const principal = await service.authenticate(plaintext, '203.0.113.1');
      expect(principal.scopes).toEqual(['usage:read']);
    });

    // Narrowing an application takes effect on the next request, without
    // having to hunt down and re-issue every key.
    it('narrows existing keys when the application is narrowed', async () => {
      const { plaintext, application } = await seed({
        appScopes: ['applications:read', 'usage:read'],
      });
      await repo.updateApplication(null, application.id, {
        scopes: ['usage:read'],
      });
      const principal = await service.authenticate(plaintext, '203.0.113.1');
      expect(principal.scopes).toEqual(['usage:read']);
    });
  });

  describe('OAuth access tokens', () => {
    async function seedToken(
      overrides: {
        scopes?: PartnerScope[];
        subjectUserId?: string | null;
        expiresAt?: string;
        revoked?: boolean;
      } = {},
    ) {
      const { application } = await seed();
      const generated = generateAccessToken();
      const row = await repo.createAccessToken(null, {
        application_id: application.id,
        token_hash: generated.hash,
        scopes: overrides.scopes ?? ['applications:read'],
        grant_type: overrides.subjectUserId
          ? 'authorization_code'
          : 'client_credentials',
        subject_user_id: overrides.subjectUserId ?? null,
        expires_at: overrides.expiresAt ?? tokenExpiry(new Date(), 3600),
      });
      if (overrides.revoked) {
        await repo.revokeAccessToken(
          null,
          generated.hash,
          new Date().toISOString(),
        );
      }
      return { token: generated.token, row, application };
    }

    it('authenticates a valid token', async () => {
      const { token, application } = await seedToken();
      const principal = await service.authenticate(token, '203.0.113.1');
      expect(principal.applicationId).toBe(application.id);
      expect(principal.credentialKind).toBe('oauth_token');
    });

    it('carries the subject through for a user-consented token', async () => {
      const { token } = await seedToken({ subjectUserId: 'user-9' });
      const principal = await service.authenticate(token, '203.0.113.1');
      expect(principal.subjectUserId).toBe('user-9');
    });

    // Opaque tokens exist precisely so this works; a JWT would stay valid.
    it('refuses a revoked token immediately', async () => {
      const { token } = await seedToken({ revoked: true });
      await expect(
        service.authenticate(token, '203.0.113.1'),
      ).rejects.toMatchObject({
        code: 'invalid_credential',
      });
    });

    it('refuses an expired token', async () => {
      const { token } = await seedToken({
        expiresAt: '2020-01-01T00:00:00.000Z',
      });
      await expect(
        service.authenticate(token, '203.0.113.1'),
      ).rejects.toMatchObject({
        code: 'invalid_credential',
      });
    });

    it('refuses an unknown token', async () => {
      await expect(
        service.authenticate(generateAccessToken().token, '203.0.113.1'),
      ).rejects.toMatchObject({ code: 'invalid_credential' });
    });
  });

  describe('consent enforcement', () => {
    it('passes when consent covers the scope', async () => {
      const { application, partner } = await seed();
      await repo.upsertConsent(null, application.id, 'user-1', [
        'applications:read',
      ]);
      await expect(
        service.assertConsent(
          principalFor(application.id, partner.id),
          'user-1',
          'applications:read',
        ),
      ).resolves.toBeUndefined();
    });

    it('refuses when no consent exists', async () => {
      const { application, partner } = await seed();
      await expect(
        service.assertConsent(
          principalFor(application.id, partner.id),
          'user-1',
          'applications:read',
        ),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });

    it('refuses when consent was revoked', async () => {
      const { application, partner } = await seed();
      await repo.upsertConsent(null, application.id, 'user-1', [
        'applications:read',
      ]);
      await repo.revokeConsent(
        null,
        application.id,
        'user-1',
        new Date().toISOString(),
      );
      await expect(
        service.assertConsent(
          principalFor(application.id, partner.id),
          'user-1',
          'applications:read',
        ),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });

    // Consent is per scope. Agreeing to be read is not agreeing to be written.
    it('refuses a scope the user did not consent to', async () => {
      const { application, partner } = await seed();
      await repo.upsertConsent(null, application.id, 'user-1', [
        'applications:read',
      ]);
      await expect(
        service.assertConsent(
          principalFor(application.id, partner.id),
          'user-1',
          'applications:write',
        ),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });

    // Cross-tenant: one user's consent must not read across to another user.
    it('refuses a different user than the one who consented', async () => {
      const { application, partner } = await seed();
      await repo.upsertConsent(null, application.id, 'user-1', [
        'applications:read',
      ]);
      await expect(
        service.assertConsent(
          principalFor(application.id, partner.id),
          'user-2',
          'applications:read',
        ),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });

    // Cross-application: a consent granted to one partner app must not be
    // honoured for another.
    it("refuses another application's consent", async () => {
      const { application, partner } = await seed();
      await repo.upsertConsent(null, 'other-app', 'user-1', [
        'applications:read',
      ]);
      await expect(
        service.assertConsent(
          principalFor(application.id, partner.id),
          'user-1',
          'applications:read',
        ),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });
  });
});

function principalFor(applicationId: string, partnerId: string) {
  return {
    partnerId,
    organizationId: 'org-1',
    applicationId,
    clientId: 'vac_live_abc',
    environment: 'live' as const,
    scopes: ['applications:read'] as PartnerScope[],
    credentialKind: 'api_key' as const,
    credentialId: 'key-1',
    subjectUserId: null,
  };
}
