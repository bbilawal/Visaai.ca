import {
  TemplateHealthService,
  DEGRADED_ALERT_HOURS,
} from './template-health.service';
import { FRESHNESS_UNVERIFIED_DAYS } from './freshness';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import type { NotificationEventBus } from '../notifications/notification-event-bus';

const NOW = new Date('2026-08-13T12:00:00.000Z');
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();
const hoursAgo = (n: number) =>
  new Date(NOW.getTime() - n * 3_600_000).toISOString();

type Row = Record<string, unknown>;

/**
 * `user_roles` grants, keyed by user id. Admin recipients resolve from the same
 * three sources the login gate uses, so the fake has to answer the grant query
 * as well as the user list — an alert addressed to an RBAC admin is the case
 * this watchdog was missing entirely.
 */
function rolesQuery(grants: Record<string, string[]>) {
  let userId: string | null = null;
  let keys: string[] | null = null;
  const chain: any = {
    select: () => chain,
    eq: (_c: string, v: string) => {
      userId = v;
      return chain;
    },
    in: (_c: string, v: string[]) => {
      keys = v;
      return chain;
    },
    range: () => chain,
    then: (res: (v: unknown) => unknown) =>
      Promise.resolve({
        data: Object.entries(grants)
          .filter(([id]) => (userId ? id === userId : true))
          .flatMap(([id, ks]) =>
            ks
              .filter((k) => (keys ? keys.includes(k) : true))
              .map((key) => ({ user_id: id, roles: { key } })),
          ),
        error: null,
      }).then(res),
  };
  return chain;
}

function fakeSupabase(
  forms: Row[],
  documents: Row[],
  counts = { revisions: 0, findings: 0 },
  opts: { users?: Row[]; grants?: Record<string, string[]> } = {},
) {
  return {
    admin: {
      from: (table: string) => {
        if (table === 'user_roles') return rolesQuery(opts.grants ?? {});
        if (table === 'form_templates')
          return {
            select: () => Promise.resolve({ data: forms, error: null }),
          };
        if (table === 'document_templates')
          return {
            select: () => Promise.resolve({ data: documents, error: null }),
          };
        if (table === 'template_revisions')
          return {
            select: () => ({
              is: () =>
                Promise.resolve({ count: counts.revisions, error: null }),
            }),
          };
        return {
          select: () => ({
            in: () => Promise.resolve({ count: counts.findings, error: null }),
          }),
        };
      },
      auth: {
        admin: {
          listUsers: ({ page }: { page: number }) =>
            // GoTrue pages: everyone on page 1, page 2 empty.
            Promise.resolve(
              page === 1
                ? {
                    data: {
                      users: opts.users ?? [
                        { id: 'admin-1', app_metadata: { role: 'admin' } },
                        { id: 'user-1', app_metadata: { role: 'user' } },
                      ],
                    },
                    error: null,
                  }
                : { data: { users: [] }, error: null },
            ),
        },
      },
    },
  } as unknown as SupabaseService;
}

function fakeBus(emitted: Row[]) {
  return {
    emit: (e: Row) => emitted.push(e),
  } as unknown as NotificationEventBus;
}

const healthy = {
  country_code: 'CA',
  code: 'IMM 5257',
  status: 'ok',
  last_checked_at: hoursAgo(2),
  last_verified_at: hoursAgo(2),
};

describe('TemplateHealthService.check', () => {
  it('reports a healthy cache and does not alert', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase([healthy], []),
      fakeBus(emitted),
    );

    const report = await svc.check(NOW);

    expect(report).toMatchObject({ total: 1, ok: 1, alerted: false });
    expect(report.degraded).toHaveLength(0);
    expect(emitted).toHaveLength(0);
  });

  // One bad night is normal — the cached copy is still served and the portal is
  // probably just having an outage. Alerting on it trains people to ignore the
  // alert, so the threshold is two consecutive failures.
  it('does not flag a row that only started failing tonight', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [
          {
            ...healthy,
            status: 'stale',
            last_checked_at: hoursAgo(1),
            last_verified_at: hoursAgo(26),
          },
        ],
        [],
      ),
      fakeBus(emitted),
    );

    const report = await svc.check(NOW);

    expect(report.degraded).toHaveLength(0);
    expect(report.alerted).toBe(false);
  });

  it('flags a row that has been failing past the threshold', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [
          {
            ...healthy,
            status: 'stale',
            last_checked_at: hoursAgo(1),
            last_verified_at: hoursAgo(DEGRADED_ALERT_HOURS + 1),
          },
        ],
        [],
      ),
      fakeBus(emitted),
    );

    const report = await svc.check(NOW);

    expect(report.degraded).toHaveLength(1);
    expect(report.degraded[0]).toMatchObject({
      source: 'form',
      code: 'IMM 5257',
    });
    expect(report.alerted).toBe(true);
  });

  // The case the whole freshness work exists for: a row that still SAYS ok but
  // has not actually been confirmed against the government site in a month.
  it('flags an ok row nobody has confirmed in a month', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [],
        [
          {
            country_code: 'CA',
            code: 'IMM 5484',
            status: 'ok',
            last_checked_at: hoursAgo(1),
            last_verified_at: daysAgo(FRESHNESS_UNVERIFIED_DAYS + 1),
          },
        ],
      ),
      fakeBus(emitted),
    );

    const report = await svc.check(NOW);

    expect(report.unverified).toHaveLength(1);
    expect(report.unverified[0].source).toBe('document');
    expect(report.ok).toBe(0);
  });

  // 'link_only' is a healthy terminal state by design (web-page-only artifact,
  // or one robots.txt disallows) — paging someone about it would be noise.
  it('ignores link-only rows entirely', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [],
        [
          {
            country_code: 'CA',
            code: 'IMM 5476',
            status: 'link_only',
            last_checked_at: hoursAgo(1),
            last_verified_at: null,
          },
        ],
      ),
      fakeBus(emitted),
    );

    const report = await svc.check(NOW);

    expect(report.degraded).toHaveLength(0);
    expect(report.unverified).toHaveLength(0);
    expect(report.alerted).toBe(false);
  });

  it('broadcasts to admins only, once per day', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [
          {
            ...healthy,
            status: 'error',
            last_checked_at: hoursAgo(1),
            last_verified_at: null,
          },
        ],
        [],
      ),
      fakeBus(emitted),
    );

    await svc.check(NOW);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({
      type: 'system.broadcast',
      userId: 'admin-1',
      broadcastId: 'template-health:2026-08-13',
    });
  });

  /**
   * OPS-001. This watchdog resolved its recipients from `app_metadata.role`
   * alone. No production user carries that key with the admin role, so it found
   * real degradation, addressed the alert to an empty set, and logged
   * "emitted to 0 admin(s)". An admin created through the RBAC tables — no
   * metadata role, not necessarily on ADMIN_EMAILS — was invisible to it.
   */
  it('reaches an admin who exists only as an RBAC platform_admin grant', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [
          {
            ...healthy,
            status: 'error',
            last_checked_at: hoursAgo(1),
            last_verified_at: null,
          },
        ],
        [],
        { revisions: 0, findings: 0 },
        {
          users: [
            { id: 'rbac-1', email: 'rbac@x.com', app_metadata: {} },
            { id: 'plain-1', email: 'plain@x.com', app_metadata: {} },
          ],
          grants: { 'rbac-1': ['platform_admin'] },
        },
      ),
      fakeBus(emitted),
    );

    const report = await svc.check(NOW);

    expect(report.alerted).toBe(true);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ userId: 'rbac-1' });
  });

  it('reaches a super_admin grant holder too', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [
          {
            ...healthy,
            status: 'error',
            last_checked_at: hoursAgo(1),
            last_verified_at: null,
          },
        ],
        [],
        { revisions: 0, findings: 0 },
        {
          users: [{ id: 'su-1', email: 'su@x.com', app_metadata: {} }],
          grants: { 'su-1': ['super_admin'] },
        },
      ),
      fakeBus(emitted),
    );

    await svc.check(NOW);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]).toMatchObject({ userId: 'su-1' });
  });

  it('does not alert an org_admin, who cannot reach /admin', async () => {
    const emitted: Row[] = [];
    const svc = new TemplateHealthService(
      fakeSupabase(
        [
          {
            ...healthy,
            status: 'error',
            last_checked_at: hoursAgo(1),
            last_verified_at: null,
          },
        ],
        [],
        { revisions: 0, findings: 0 },
        {
          users: [{ id: 'org-1', email: 'org@x.com', app_metadata: {} }],
          grants: { 'org-1': ['org_admin'] },
        },
      ),
      fakeBus(emitted),
    );

    await svc.check(NOW);

    expect(emitted).toHaveLength(0);
  });

  // A watchdog that cannot alert must still report. Silence would be worse than
  // a missing broadcast, so the report still comes back with the findings.
  it('still reports when no notification bus is wired', async () => {
    const svc = new TemplateHealthService(
      fakeSupabase(
        [
          {
            ...healthy,
            status: 'error',
            last_checked_at: hoursAgo(1),
            last_verified_at: null,
          },
        ],
        [],
      ),
    );

    const report = await svc.check(NOW);

    expect(report.unverified).toHaveLength(1);
    expect(report.alerted).toBe(false);
  });
});
