/* eslint-disable @typescript-eslint/require-await --
 * Test doubles implement async interfaces over synchronous fixtures.
 */
import { InMemoryPartnerRepository } from './in-memory-partner.repository';
import { isCredentialUsable, parseApiKey, sha256 } from './partner-credentials';
import { PartnerRegistryService } from './partner-registry.service';

/**
 * Portal-side credential lifecycle.
 *
 * The recurring assertion is tenancy: membership is read from the database for
 * the ACTING user and never taken from the request, so an org admin of org-1
 * cannot reach org-2's credentials by changing one uuid.
 */
class FakeSupabase {
  members: {
    organization_id: string;
    user_id: string;
    role: string;
    status: string;
  }[] = [];
  audit: Record<string, unknown>[] = [];

  get admin() {
    return {
      from: (table: string) => {
        if (table === 'auth_audit_log') {
          return {
            insert: async (row: Record<string, unknown>) => {
              this.audit.push(row);
              return { error: null };
            },
          };
        }
        const filters: Record<string, unknown> = {};
        const api: Record<string, unknown> = {
          select: () => api,
          eq: (column: string, value: unknown) => {
            filters[column] = value;
            return api;
          },
          maybeSingle: async () => ({
            data:
              this.members.find((m) =>
                Object.entries(filters).every(
                  ([k, v]) => (m as Record<string, unknown>)[k] === v,
                ),
              ) ?? null,
            error: null,
          }),
        };
        return api;
      },
    };
  }
}

describe('PartnerRegistryService', () => {
  let repo: InMemoryPartnerRepository;
  let supabase: FakeSupabase;
  let service: PartnerRegistryService;

  const config = { get: () => undefined } as never;

  beforeEach(() => {
    repo = new InMemoryPartnerRepository();
    supabase = new FakeSupabase();
    supabase.members = [
      {
        organization_id: 'org-1',
        user_id: 'admin-1',
        role: 'org_admin',
        status: 'active',
      },
      {
        organization_id: 'org-1',
        user_id: 'member-1',
        role: 'member',
        status: 'active',
      },
      {
        organization_id: 'org-2',
        user_id: 'admin-2',
        role: 'org_admin',
        status: 'active',
      },
    ];
    service = new PartnerRegistryService(supabase as never, config, repo);
  });

  async function registerApproved() {
    const partner = await service.register('admin-1', 'org-1', {
      legalName: 'Acme',
      contactEmail: 'dev@acme.test',
    });
    await repo.updatePartnerStatus(null, partner.id, 'approved', null);
    return partner;
  }

  describe('registration', () => {
    it('registers an organization as a pending partner', async () => {
      const partner = await service.register('admin-1', 'org-1', {
        legalName: 'Acme',
        contactEmail: 'dev@acme.test',
      });
      // Pending, not approved: sandbox now, live after review.
      expect(partner.status).toBe('pending');
    });

    it('refuses a non-admin member', async () => {
      await expect(
        service.register('member-1', 'org-1', {
          legalName: 'Acme',
          contactEmail: 'dev@acme.test',
        }),
      ).rejects.toThrow(/administrator/i);
    });

    it('refuses a user who is not a member at all', async () => {
      await expect(
        service.register('admin-2', 'org-1', {
          legalName: 'Acme',
          contactEmail: 'dev@acme.test',
        }),
      ).rejects.toThrow(/not a member/i);
    });

    it('refuses a second registration for the same organization', async () => {
      await registerApproved();
      await expect(
        service.register('admin-1', 'org-1', {
          legalName: 'Acme again',
          contactEmail: 'dev@acme.test',
        }),
      ).rejects.toThrow(/already registered/i);
    });

    it('audits the registration', async () => {
      await service.register('admin-1', 'org-1', {
        legalName: 'Acme',
        contactEmail: 'dev@acme.test',
      });
      expect(supabase.audit[0]).toMatchObject({
        event_type: 'partner.registered',
      });
    });
  });

  describe('applications', () => {
    it('creates a sandbox application with self-service scopes granted', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['applications:read'],
        },
      );
      expect(application.status).toBe('active');
      expect(application.scopes).toEqual(['applications:read']);
    });

    // Live access to personal data is a human decision.
    it('holds a live data scope for review instead of granting it', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'live',
          scopes: ['applications:read'],
        },
      );
      expect(application.status).toBe('pending_review');
      expect(application.scopes).toEqual([]);
      expect(application.requested_scopes).toEqual(['applications:read']);
    });

    it('grants live operational scopes without review', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'live',
          scopes: ['usage:read'],
        },
      );
      expect(application.status).toBe('active');
    });

    it('refuses a live application from an unapproved partner', async () => {
      await service.register('admin-1', 'org-1', {
        legalName: 'Acme',
        contactEmail: 'dev@acme.test',
      });
      await expect(
        service.createApplication('admin-1', 'org-1', {
          name: 'Integration',
          environment: 'live',
          scopes: ['usage:read'],
        }),
      ).rejects.toThrow(/approved/i);
    });

    it('returns the client secret once and stores only its hash', async () => {
      await registerApproved();
      const { application, clientSecret } = await service.createApplication(
        'admin-1',
        'org-1',
        { name: 'Integration', environment: 'sandbox', scopes: ['usage:read'] },
      );
      const stored = await repo.getApplication(null, application.id);
      expect(stored?.client_secret_hash).toBe(sha256(clientSecret));
      expect(stored?.client_secret_hash).not.toBe(clientSecret);
    });

    it('requires a redirect URI for the authorization_code grant', async () => {
      await registerApproved();
      await expect(
        service.createApplication('admin-1', 'org-1', {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
          grantTypes: ['authorization_code'],
        }),
      ).rejects.toThrow(/redirect URI/i);
    });

    it('refuses an http redirect URI in live', async () => {
      await registerApproved();
      await expect(
        service.createApplication('admin-1', 'org-1', {
          name: 'Integration',
          environment: 'live',
          scopes: ['usage:read'],
          grantTypes: ['authorization_code'],
          redirectUris: ['http://acme.test/cb'],
        }),
      ).rejects.toThrow(/https/i);
    });

    it('permits http://localhost in sandbox', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
          grantTypes: ['authorization_code'],
          redirectUris: ['http://localhost:3000/cb'],
        },
      );
      expect(application.redirect_uris).toEqual(['http://localhost:3000/cb']);
    });

    it('refuses a redirect URI containing a fragment', async () => {
      await registerApproved();
      await expect(
        service.createApplication('admin-1', 'org-1', {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
          grantTypes: ['authorization_code'],
          redirectUris: ['https://acme.test/cb#token'],
        }),
      ).rejects.toThrow(/fragment/i);
    });
  });

  describe('approval', () => {
    it('grants the reviewed scopes and activates', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'live',
          scopes: ['applications:read', 'documents:read'],
        },
      );
      const approved = await service.approveApplication(
        'staff-1',
        application.id,
        ['applications:read'],
      );
      expect(approved.status).toBe('active');
      expect(approved.scopes).toEqual(['applications:read']);
    });

    // An approver may narrow, never widen: granting something never requested
    // is how scope creep becomes a breach.
    it('refuses to grant a scope the partner never requested', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'live',
          scopes: ['applications:read'],
        },
      );
      await expect(
        service.approveApplication('staff-1', application.id, [
          'applications:read',
          'documents:read',
        ]),
      ).rejects.toThrow(/subset/i);
    });
  });

  describe('API keys', () => {
    async function activeApp() {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['applications:read', 'usage:read'],
        },
      );
      return application;
    }

    it('issues a key whose plaintext is returned once and stored hashed', async () => {
      const application = await activeApp();
      const issued = await service.createKey(
        'admin-1',
        'org-1',
        application.id,
        {
          name: 'primary',
        },
      );
      const stored = (await repo.listApiKeys(null, application.id))[0];
      expect(stored.key_hash).toBe(sha256(issued.key));
      expect(JSON.stringify(stored)).not.toContain(issued.key);
    });

    it('marks the key as belonging to the sandbox environment', async () => {
      const application = await activeApp();
      const issued = await service.createKey(
        'admin-1',
        'org-1',
        application.id,
        {
          name: 'primary',
        },
      );
      expect(parseApiKey(issued.key)?.environment).toBe('sandbox');
    });

    it('narrows key scopes to the application', async () => {
      const application = await activeApp();
      const issued = await service.createKey(
        'admin-1',
        'org-1',
        application.id,
        {
          name: 'read-only',
          scopes: ['usage:read', 'documents:read'],
        },
      );
      expect(issued.scopes).toEqual(['usage:read']);
    });

    it('refuses a key for an application holding no scopes', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'live',
          scopes: ['applications:read'],
        },
      );
      await expect(
        service.createKey('admin-1', 'org-1', application.id, { name: 'x' }),
      ).rejects.toThrow(/no granted scopes/i);
    });

    // Rotation that causes an outage is rotation nobody performs.
    it('keeps the old key usable during the grace window', async () => {
      const application = await activeApp();
      const original = await service.createKey(
        'admin-1',
        'org-1',
        application.id,
        {
          name: 'primary',
        },
      );
      await service.rotateKey('admin-1', 'org-1', application.id, original.id);

      const stored = await repo.getApiKey(null, original.id);
      expect(stored?.status).toBe('rotating');
      expect(isCredentialUsable(stored, new Date())).toBe(true);
    });

    it('expires the old key at the end of the grace window', async () => {
      const application = await activeApp();
      const original = await service.createKey(
        'admin-1',
        'org-1',
        application.id,
        {
          name: 'primary',
        },
      );
      await service.rotateKey('admin-1', 'org-1', application.id, original.id);
      const stored = await repo.getApiKey(null, original.id);
      const past = new Date(Date.now() + 1000 * 3600 * 24 * 30);
      expect(isCredentialUsable(stored, past)).toBe(false);
    });

    it('carries the scopes across a rotation', async () => {
      const application = await activeApp();
      const original = await service.createKey(
        'admin-1',
        'org-1',
        application.id,
        {
          name: 'primary',
          scopes: ['usage:read'],
        },
      );
      const replacement = await service.rotateKey(
        'admin-1',
        'org-1',
        application.id,
        original.id,
      );
      expect(replacement.scopes).toEqual(['usage:read']);
      expect(replacement.key).not.toBe(original.key);
    });

    it('refuses to rotate a revoked key', async () => {
      const application = await activeApp();
      const key = await service.createKey('admin-1', 'org-1', application.id, {
        name: 'primary',
      });
      await service.revokeKey(
        'admin-1',
        'org-1',
        application.id,
        key.id,
        'leaked',
      );
      await expect(
        service.rotateKey('admin-1', 'org-1', application.id, key.id),
      ).rejects.toThrow(/revoked/i);
    });

    it('revokes immediately, with no grace period', async () => {
      const application = await activeApp();
      const key = await service.createKey('admin-1', 'org-1', application.id, {
        name: 'primary',
      });
      await service.revokeKey(
        'admin-1',
        'org-1',
        application.id,
        key.id,
        'leaked',
      );
      const stored = await repo.getApiKey(null, key.id);
      expect(isCredentialUsable(stored, new Date())).toBe(false);
    });

    it('never returns a key hash in the portal summary', async () => {
      const application = await activeApp();
      await service.createKey('admin-1', 'org-1', application.id, {
        name: 'primary',
      });
      const summaries = await service.listKeys(
        'admin-1',
        'org-1',
        application.id,
      );
      expect(JSON.stringify(summaries)).not.toContain('key_hash');
      expect(summaries[0].last_four).toHaveLength(4);
    });
  });

  describe('tenant isolation', () => {
    it("refuses to list another organization's applications", async () => {
      await registerApproved();
      await expect(
        service.listApplications('admin-2', 'org-1'),
      ).rejects.toThrow(/not a member/i);
    });

    // The IDOR: a valid org admin of org-2 naming their own org but another
    // org's application id.
    it("refuses to read another organization's application by id", async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
        },
      );
      await service.register('admin-2', 'org-2', {
        legalName: 'Rival',
        contactEmail: 'dev@rival.test',
      });
      await expect(
        service.requireApplication('admin-2', 'org-2', application.id),
      ).rejects.toThrow(/not found/i);
    });

    it("refuses to mint a key against another organization's application", async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
        },
      );
      await service.register('admin-2', 'org-2', {
        legalName: 'Rival',
        contactEmail: 'dev@rival.test',
      });
      await expect(
        service.createKey('admin-2', 'org-2', application.id, {
          name: 'stolen',
        }),
      ).rejects.toThrow(/not found/i);
    });

    it('refuses key management by a non-admin member of the right organization', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
        },
      );
      await expect(
        service.createKey('member-1', 'org-1', application.id, { name: 'x' }),
      ).rejects.toThrow(/administrator/i);
    });

    it('lets a plain member read, but not mutate', async () => {
      await registerApproved();
      await expect(
        service.listApplications('member-1', 'org-1'),
      ).resolves.toBeDefined();
    });

    it('refuses a suspended member', async () => {
      supabase.members.push({
        organization_id: 'org-1',
        user_id: 'suspended-1',
        role: 'org_admin',
        status: 'suspended',
      });
      await expect(
        service.listApplications('suspended-1', 'org-1'),
      ).rejects.toThrow(/not a member/i);
    });
  });

  describe('suspension', () => {
    // Suspension that leaves tokens working for an hour is not suspension.
    it('revokes live tokens when a partner is suspended', async () => {
      const partner = await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
        },
      );
      await repo.createAccessToken(null, {
        application_id: application.id,
        token_hash: 'hash-1',
        scopes: ['usage:read'],
        grant_type: 'client_credentials',
        subject_user_id: null,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });

      await service.setStatus('staff-1', partner.id, 'suspended', 'abuse');
      expect(repo.tokens[0].revoked_at).not.toBeNull();
    });

    it('revokes tokens when a single application is suspended', async () => {
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
        },
      );
      await repo.createAccessToken(null, {
        application_id: application.id,
        token_hash: 'hash-1',
        scopes: ['usage:read'],
        grant_type: 'client_credentials',
        subject_user_id: null,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await service.suspendApplication(
        'admin-1',
        'org-1',
        application.id,
        'abuse',
      );
      expect(repo.tokens[0].revoked_at).not.toBeNull();
    });

    it("refuses to suspend ANOTHER organization's application", async () => {
      // `partner.manage` is granted to org_admin platform-wide and orgs are
      // self-serve, so without a tenancy check any user could create an org,
      // inherit the permission, and revoke an unrelated organization's live
      // production API tokens by passing its application UUID.
      await registerApproved();
      const { application } = await service.createApplication(
        'admin-1',
        'org-1',
        {
          name: 'Integration',
          environment: 'sandbox',
          scopes: ['usage:read'],
        },
      );

      // A different user, acting for a different organization they DO
      // administer, naming someone else's application id.
      await expect(
        service.suspendApplication('admin-2', 'org-2', application.id, 'abuse'),
      ).rejects.toThrow();
    });
  });
});
