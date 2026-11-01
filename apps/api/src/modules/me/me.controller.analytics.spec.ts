import { MeController } from './me.controller';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import type { AuthUser } from '../auth/jwt.guard';

/**
 * ARCH-005: the `created_at` freshness check moved out of the controller into
 * UserProfileRepository, so the fake query-builder this file used to carry is
 * gone. The stub now states the test's actual intent — "this user was created
 * at T" — instead of impersonating a Supabase builder chain.
 */
function makeSupabase() {
  return { forUser: jest.fn(() => ({})) } as unknown as SupabaseService;
}

function makeUsers(createdAt: string | null) {
  return {
    getCreatedAt: jest.fn().mockResolvedValue(createdAt),
    getPreferredLanguage: jest.fn().mockResolvedValue(null),
    setPreferredLanguage: jest.fn().mockResolvedValue(true),
    disableEmailReminders: jest.fn().mockResolvedValue(undefined),
  } as never;
}

function makeUser(overrides: Partial<AuthUser> = {}): AuthUser {
  return {
    id: 'user-1',
    email: 'a@example.com',
    role: 'authenticated',
    appRole: 'user',
    isAnonymous: false,
    ...overrides,
  };
}

/** trackIdentity is fire-and-forget from `me()`; flush the microtask queue
 * (the mocked DB round-trip is a resolved promise, no real timers involved). */
async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
}

describe('MeController — analytics emission', () => {
  it('emits user.registered on the first sync for a just-created user, then user.active on the next sync', async () => {
    const bus = new AnalyticsEventBus();
    const seen: string[] = [];
    bus.events$.subscribe((e) => seen.push(e.name));
    const supabase = makeSupabase();
    const controller = new MeController(
      supabase,
      makeUsers(new Date().toISOString()),
      bus,
    );

    controller.me(makeUser(), 'Bearer token-1');
    await flush();
    expect(seen).toEqual(['user.registered']);

    controller.me(makeUser(), 'Bearer token-1');
    await flush();
    expect(seen).toEqual(['user.registered', 'user.active']);
  });

  it('emits user.signed_in on the first sync for a pre-existing user (created well outside the fresh-signup window)', async () => {
    const bus = new AnalyticsEventBus();
    const seen: string[] = [];
    bus.events$.subscribe((e) => seen.push(e.name));
    const oldCreatedAt = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const supabase = makeSupabase();
    const controller = new MeController(supabase, makeUsers(oldCreatedAt), bus);

    controller.me(makeUser({ id: 'user-2' }), 'Bearer token-2');
    await flush();
    expect(seen).toEqual(['user.signed_in']);
  });

  it('never emits identity analytics for anonymous callers', async () => {
    const bus = new AnalyticsEventBus();
    const seen: string[] = [];
    bus.events$.subscribe((e) => seen.push(e.name));
    const supabase = makeSupabase();
    const controller = new MeController(supabase, makeUsers(null), bus);

    controller.me(makeUser({ id: 'guest-1', isAnonymous: true }));
    await flush();
    expect(seen).toEqual([]);
  });

  it('never throws when constructed without an analytics bus (Optional, additive)', async () => {
    const supabase = makeSupabase();
    const controller = new MeController(supabase, makeUsers(null));
    expect(() => controller.me(makeUser())).not.toThrow();
    await flush();
  });
});
