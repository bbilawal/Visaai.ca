/* eslint-disable @typescript-eslint/require-await --
 * Test doubles implement async interfaces over synchronous fixtures.
 */
import type { PartnerPrincipal } from '@visaai/types';
import { InMemoryPartnerRepository } from './in-memory-partner.repository';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerResourcesService } from './partner-resources.service';
import { PartnerSandboxService } from './partner-sandbox.service';

/**
 * What a partner can read, and — the part that matters — what they cannot.
 *
 * The production tables are behind a hand-rolled Supabase stub so the
 * projection is asserted against a row containing every internal column the
 * real table has. If a future migration adds a sensitive column, the
 * projection test still passes only because the mapper is an allow-list.
 */
class FakeSupabase {
  constructor(
    private readonly applications: Record<string, unknown>[],
    private readonly documents: Record<string, unknown>[],
  ) {}

  lastSelect: string | null = null;

  get admin() {
    return { from: (table: string) => this.builder(table) };
  }

  private builder(table: string) {
    const rows = table === 'applications' ? this.applications : this.documents;
    const state: { filters: Record<string, unknown> } = { filters: {} };
    const api: Record<string, unknown> = {
      select: (columns: string) => {
        this.lastSelect = columns;
        return api;
      },
      eq: (column: string, value: unknown) => {
        state.filters[column] = value;
        return api;
      },
      order: () => api,
      limit: () => api,
      insert: (values: Record<string, unknown>) => {
        const row = {
          id: 'new-app',
          created_at: '2026-08-06T00:00:00.000Z',
          ...values,
        };
        this.applications.push(row);
        state.filters.id = 'new-app';
        return api;
      },
      single: async () => ({
        data: filter(rows, state.filters)[0] ?? null,
        error: null,
      }),
      maybeSingle: async () => ({
        data: filter(rows, state.filters)[0] ?? null,
        error: null,
      }),
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: filter(rows, state.filters),
          error: null,
        }).then(resolve),
    };
    return api;
  }
}

function filter(
  rows: Record<string, unknown>[],
  filters: Record<string, unknown>,
): Record<string, unknown>[] {
  return rows.filter((row) =>
    Object.entries(filters).every(([key, value]) => row[key] === value),
  );
}

/** A row with every column the real `applications` table carries. */
const REAL_APPLICATION = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: 'user-1',
  framework_id: 'fw-1',
  status: 'ready',
  plan_tier: 'expert',
  vri_score: 88,
  submitted_at: null,
  decision_at: null,
  created_at: '2026-08-01T00:00:00.000Z',
};

const OTHER_USERS_APPLICATION = {
  ...REAL_APPLICATION,
  id: '22222222-2222-4222-8222-222222222222',
  user_id: 'user-2',
};

const REAL_DOCUMENT = {
  id: '33333333-3333-4333-8333-333333333333',
  application_id: REAL_APPLICATION.id,
  checklist_item_id: 'ci-1',
  storage_path: 'private/user-1/passport.pdf',
  mime_type: 'application/pdf',
  file_name: 'passport.pdf',
  encrypted: true,
  upload_status: 'complete',
  ocr_status: 'complete',
  created_at: '2026-08-01T00:00:00.000Z',
};

describe('PartnerResourcesService', () => {
  let repo: InMemoryPartnerRepository;
  let supabase: FakeSupabase;
  let service: PartnerResourcesService;

  const principal: PartnerPrincipal = {
    partnerId: 'p1',
    organizationId: 'org-1',
    applicationId: 'app-1',
    clientId: 'c1',
    environment: 'live',
    scopes: ['applications:read', 'applications:write', 'documents:read'],
    credentialKind: 'api_key',
    credentialId: 'k1',
    subjectUserId: null,
  };

  beforeEach(async () => {
    repo = new InMemoryPartnerRepository();
    supabase = new FakeSupabase(
      [{ ...REAL_APPLICATION }, { ...OTHER_USERS_APPLICATION }],
      [{ ...REAL_DOCUMENT }],
    );
    const auth = new PartnerAuthService(supabase as never, repo);
    const sandbox = new PartnerSandboxService(supabase as never, repo);
    service = new PartnerResourcesService(
      supabase as never,
      auth,
      sandbox,
      repo,
    );
    await repo.upsertConsent(null, 'app-1', 'user-1', [
      'applications:read',
      'applications:write',
      'documents:read',
    ]);
  });

  describe('consent gating', () => {
    it('returns applications for a consenting user', async () => {
      const rows = await service.listApplications(principal, 'user-1');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(REAL_APPLICATION.id);
    });

    it('refuses a user who has not consented', async () => {
      await expect(
        service.listApplications(principal, 'user-2'),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });

    it('refuses after consent is revoked', async () => {
      await repo.revokeConsent(
        null,
        'app-1',
        'user-1',
        new Date().toISOString(),
      );
      await expect(
        service.listApplications(principal, 'user-1'),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });

    it('requires a user_id when the credential names no subject', async () => {
      await expect(
        service.listApplications(principal, null),
      ).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });
  });

  describe('subject binding', () => {
    const bound: PartnerPrincipal = { ...principal, subjectUserId: 'user-1' };

    it('uses the token subject without needing a user_id', async () => {
      const rows = await service.listApplications(bound, null);
      expect(rows).toHaveLength(1);
    });

    // The escalation to prevent: one user's consent must not become a key to
    // another user's file.
    it('refuses to answer about a different user than the token subject', async () => {
      await repo.upsertConsent(null, 'app-1', 'user-2', ['applications:read']);
      await expect(
        service.listApplications(bound, 'user-2'),
      ).rejects.toMatchObject({
        code: 'consent_required',
      });
    });
  });

  describe('object-level authorization', () => {
    it('reads an application belonging to a consenting user', async () => {
      const row = await service.getApplication(principal, REAL_APPLICATION.id);
      expect(row.id).toBe(REAL_APPLICATION.id);
    });

    // IDOR: guessing another applicant's id must not work.
    it("refuses another user's application by id", async () => {
      await expect(
        service.getApplication(principal, OTHER_USERS_APPLICATION.id),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });

    it('returns 404 for an id that does not exist', async () => {
      await expect(
        service.getApplication(
          principal,
          '44444444-4444-4444-8444-444444444444',
        ),
      ).rejects.toMatchObject({ code: 'resource_not_found' });
    });
  });

  describe('field projection', () => {
    it('exposes only the documented application fields', async () => {
      const row = await service.getApplication(principal, REAL_APPLICATION.id);
      expect(Object.keys(row).sort()).toEqual([
        'created_at',
        'decided_at',
        'framework_id',
        'id',
        'readiness_score',
        'status',
        'submitted_at',
        'user_id',
      ]);
    });

    // Our commercial relationship with the applicant is not the partner's
    // business.
    it('never exposes plan_tier', async () => {
      const row = await service.getApplication(principal, REAL_APPLICATION.id);
      expect(row).not.toHaveProperty('plan_tier');
    });

    it('does not select columns it does not project', async () => {
      await service.getApplication(principal, REAL_APPLICATION.id);
      expect(supabase.lastSelect).not.toContain('*');
      expect(supabase.lastSelect).not.toContain('plan_tier');
    });

    it('exposes only document metadata', async () => {
      const rows = await service.listDocuments(principal, REAL_APPLICATION.id);
      expect(Object.keys(rows[0]).sort()).toEqual([
        'application_id',
        'created_at',
        'file_name',
        'id',
        'mime_type',
        'processing_status',
        'upload_status',
      ]);
    });

    // The handle to the file itself must never cross the boundary.
    it('never exposes storage_path', async () => {
      const rows = await service.listDocuments(principal, REAL_APPLICATION.id);
      expect(rows[0]).not.toHaveProperty('storage_path');
      expect(JSON.stringify(rows)).not.toContain('private/user-1');
    });

    it("refuses documents for another user's application", async () => {
      await expect(
        service.listDocuments(principal, OTHER_USERS_APPLICATION.id),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });
  });

  describe('writes', () => {
    it('creates an application for a consenting user', async () => {
      const created = await service.createApplication(principal, {
        user_id: 'user-1',
      });
      expect(created.user_id).toBe('user-1');
      expect(created.status).toBe('draft');
    });

    it('refuses to create for a user who consented only to reads', async () => {
      await repo.upsertConsent(null, 'app-1', 'user-3', ['applications:read']);
      await expect(
        service.createApplication(principal, { user_id: 'user-3' }),
      ).rejects.toMatchObject({ code: 'consent_required' });
    });
  });

  describe('sandbox routing', () => {
    const sandboxPrincipal: PartnerPrincipal = {
      ...principal,
      applicationId: 'app-sandbox',
      environment: 'sandbox',
    };

    // A sandbox credential must never reach a production table, consent or no
    // consent.
    it('serves synthetic data without touching production', async () => {
      const rows = await service.listApplications(sandboxPrincipal, null);
      expect(rows.length).toBeGreaterThan(0);
      expect(
        rows.every((r) => String(r.applicant_email).endsWith('.invalid')),
      ).toBe(true);
      expect(supabase.lastSelect).toBeNull();
    });

    it('does not require consent in sandbox', async () => {
      await expect(
        service.listApplications(sandboxPrincipal, null),
      ).resolves.toBeDefined();
    });
  });
});
