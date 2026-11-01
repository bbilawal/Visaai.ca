/* eslint-disable @typescript-eslint/require-await --
 * Test doubles implement async interfaces over synchronous fixtures.
 */
import type { PartnerPrincipal } from '@visaai/types';
import { InMemoryPartnerRepository } from './in-memory-partner.repository';
import {
  PartnerSandboxService,
  SANDBOX_PERSONAS,
} from './partner-sandbox.service';

/**
 * Sandbox isolation.
 *
 * The guarantee under test is structural: sandbox data lives in its own table
 * and this service has no path to a production one. These tests assert both
 * halves — that sandbox works, and that a live credential cannot reach it.
 */
describe('PartnerSandboxService', () => {
  let repo: InMemoryPartnerRepository;
  let service: PartnerSandboxService;

  const supabase = { admin: {} } as never;

  const sandboxPrincipal: PartnerPrincipal = {
    partnerId: 'p1',
    organizationId: 'org-1',
    applicationId: 'app-sandbox',
    clientId: 'vac_test_1',
    environment: 'sandbox',
    scopes: ['partner:read', 'applications:read'],
    credentialKind: 'api_key',
    credentialId: 'k1',
    subjectUserId: null,
  };

  const livePrincipal: PartnerPrincipal = {
    ...sandboxPrincipal,
    applicationId: 'app-live',
    environment: 'live',
  };

  beforeEach(() => {
    repo = new InMemoryPartnerRepository();
    service = new PartnerSandboxService(supabase, repo);
  });

  it('seeds deterministic personas on first use', async () => {
    const applications = await service.listApplications(sandboxPrincipal);
    expect(applications).toHaveLength(SANDBOX_PERSONAS.length);
  });

  it('does not re-seed on a second call', async () => {
    await service.listApplications(sandboxPrincipal);
    const second = await service.listApplications(sandboxPrincipal);
    expect(second).toHaveLength(SANDBOX_PERSONAS.length);
  });

  it('covers the happy path and the unhappy ones', async () => {
    const applications = await service.listApplications(sandboxPrincipal);
    const outcomes = applications.map((a) => a.expected_outcome);
    expect(outcomes).toContain('ready');
    expect(outcomes).toContain('blocked_on_documents');
    expect(outcomes).toContain('processing');
    expect(outcomes).toContain('refused');
  });

  // Every persona is invented, so exercising the sandbox cannot leak anyone.
  it('uses only invalid, non-routable email addresses', async () => {
    for (const persona of SANDBOX_PERSONAS) {
      expect(persona.email.endsWith('@sandbox.visaai.invalid')).toBe(true);
    }
  });

  it('scopes data to the calling application', async () => {
    await service.listApplications(sandboxPrincipal);
    const other = await service.listApplications({
      ...sandboxPrincipal,
      applicationId: 'app-other-sandbox',
    });
    const mine = repo.sandbox.filter((r) => r.application_id === 'app-sandbox');
    const theirs = repo.sandbox.filter(
      (r) => r.application_id === 'app-other-sandbox',
    );
    expect(other).toHaveLength(SANDBOX_PERSONAS.length);
    // Two sandboxes, no shared rows.
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    expect(mine.some((r) => theirs.includes(r))).toBe(false);
  });

  it('returns documents belonging to the requested application only', async () => {
    const applications = await service.listApplications(sandboxPrincipal);
    const first = applications[0] as { id: string };
    const documents = await service.listDocuments(sandboxPrincipal, first.id);
    for (const doc of documents) {
      expect((doc as { application_id: string }).application_id).toBe(first.id);
    }
  });

  it('creates a new sandbox application', async () => {
    const created = await service.createApplication(sandboxPrincipal, {
      country: 'CA',
      visa_type: 'study',
    });
    expect(created.status).toBe('draft');
    expect(created.persona).toBe('partner-created');
  });

  it('resets and re-seeds', async () => {
    await service.createApplication(sandboxPrincipal, {
      country: 'CA',
      visa_type: 'study',
    });
    const before = (await service.listApplications(sandboxPrincipal)).length;
    const result = await service.reset(sandboxPrincipal);
    expect(result.deleted).toBeGreaterThan(0);
    const after = await service.listApplications(sandboxPrincipal);
    expect(after).toHaveLength(SANDBOX_PERSONAS.length);
    expect(after.length).toBeLessThan(before);
  });

  it('does not touch another application on reset', async () => {
    await service.listApplications(sandboxPrincipal);
    await service.listApplications({
      ...sandboxPrincipal,
      applicationId: 'app-other-sandbox',
    });
    await service.reset(sandboxPrincipal);
    expect(
      repo.sandbox.filter((r) => r.application_id === 'app-other-sandbox')
        .length,
    ).toBeGreaterThan(0);
  });

  describe('environment gate', () => {
    it.each([
      [
        'createApplication',
        () =>
          service.createApplication(livePrincipal, {
            country: 'CA',
            visa_type: 'x',
          }),
      ],
      ['reset', () => service.reset(livePrincipal)],
      ['ensureSeeded', () => service.ensureSeeded(livePrincipal)],
    ])('refuses %s from a live credential', async (_label, call) => {
      await expect(call()).rejects.toMatchObject({
        code: 'environment_mismatch',
      });
    });

    it('creates no rows when a live credential is refused', async () => {
      await service.reset(livePrincipal).catch(() => undefined);
      expect(repo.sandbox).toHaveLength(0);
    });
  });
});
