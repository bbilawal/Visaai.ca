import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { AdminUsersService } from './admin-users.service';
import type { SupabaseService } from '../shared/supabase/supabase.service';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AnalyticsEvent } from '../analytics/events/catalog';

/**
 * Minimal chainable `.from(table)` stub covering the two shapes AdminUsersService
 * uses: a `.select(...).eq(...).single()` read and a bare-awaited `.update(...).eq(...)`
 * / `.insert(...)` write (supabase-js query builders are thenable).
 */
function makeFromStub() {
  return jest.fn().mockImplementation((table: string) => {
    // `adminCount` reads platform-admin RBAC grants; this fixture has none.
    if (table === 'user_roles') {
      const roles: Record<string, unknown> = {
        select: () => roles,
        eq: () => roles,
        in: () => roles,
        range: () => roles,
        then: (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      };
      return roles;
    }
    let op: 'select' | 'update' | 'insert' | null = null;
    const result = () =>
      op === 'select'
        ? { data: { status: 'suspended' }, error: null }
        : { data: null, error: null };
    const builder: Record<string, unknown> = {
      select: () => {
        op = 'select';
        return builder;
      },
      update: () => {
        op = 'update';
        return builder;
      },
      insert: () => {
        op = 'insert';
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      range: () => builder,
      single: () => Promise.resolve(result()),
      then: (resolve: (v: unknown) => void) => {
        resolve(result());
      },
    };
    return builder;
  });
}

function makeSupabase(): SupabaseService {
  const admin = {
    auth: {
      admin: {
        getUserById: jest.fn().mockResolvedValue({
          data: {
            user: {
              id: 'u-1',
              email: 'user@example.com',
              app_metadata: { role: 'user' },
            },
          },
          error: null,
        }),
        // No admin-role users in the auth list -> adminCount()'s fast path
        // returns 0 without a further users-table query.
        listUsers: jest
          .fn()
          .mockResolvedValue({ data: { users: [] }, error: null }),
        updateUserById: jest
          .fn()
          .mockResolvedValue({ data: { user: {} }, error: null }),
      },
    },
    from: makeFromStub(),
  };
  return { admin } as unknown as SupabaseService;
}

describe('AdminUsersService.reactivate (apply) — analytics emits', () => {
  it('emits admin.action with the action enum + target ids, no email/PII', async () => {
    const analytics = new AnalyticsEventBus();
    const events: AnalyticsEvent[] = [];
    analytics.events$.subscribe((e) => events.push(e));

    const service = new AdminUsersService(
      makeSupabase(),
      { get: () => [] } as unknown as ConfigService<Env>,
      analytics,
    );
    const result = await service.reactivate('u-1', 'admin-1');

    expect(result).toEqual({ id: 'u-1', status: 'active' });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'admin.action',
      user_id: 'admin-1',
      props: {
        action: 'reactivate',
        target_type: 'user',
        target_user_id: 'u-1',
      },
    });
    const propKeys = Object.keys(events[0].props);
    expect(propKeys.sort()).toEqual([
      'action',
      'target_type',
      'target_user_id',
    ]);
  });

  it('does not throw when the analytics bus is omitted (Optional-safety)', async () => {
    const service = new AdminUsersService(makeSupabase(), {
      get: () => [],
    } as unknown as ConfigService<Env>);
    await expect(service.reactivate('u-1', 'admin-1')).resolves.toEqual({
      id: 'u-1',
      status: 'active',
    });
  });
});
