import { Reflector } from '@nestjs/core';
import { JwtGuard, ALLOW_ANONYMOUS_KEY } from '../src/modules/auth/jwt.guard';
import { TokenCache } from '../src/modules/auth/token-cache';

/**
 * PERF-003 cover, and the security constraint that came with it.
 *
 * The cache exists because `supabase.auth.getUser()` is a network call on every
 * request: measured at p50 29.1 ms against a local GoTrue, roughly 80% of a
 * ~35 ms authenticated request, on 296 of 304 routes.
 *
 * The dangerous part is not the caching, it is WHAT gets cached. The
 * @AllowAnonymous gate is evaluated per ROUTE, but the cache key is only the
 * token. Cache a guest after they legitimately call an @AllowAnonymous endpoint
 * and the next request reuses that entry on a GATED endpoint, skipping the gate
 * — an anonymous user walking into authenticated-only features. The guard
 * therefore refuses to cache anonymous identities at all, and this test is what
 * stops that being "simplified" away later.
 */
function makeGuard(opts: {
  user: Record<string, unknown> | null;
  ttlMs?: number;
  allowAnonymous?: boolean;
}) {
  const getUser = jest
    .fn()
    .mockResolvedValue({ data: { user: opts.user }, error: null });
  const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
  const from = jest.fn().mockReturnValue({
    select: () => ({
      eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle }) }) }),
    }),
  });
  const supabase = {
    admin: { auth: { getUser }, from },
    forUser: jest.fn(() => ({ scoped: true })),
  } as never;
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ALLOW_ANONYMOUS_KEY ? (opts.allowAnonymous ?? false) : undefined,
    ),
  } as unknown as Reflector;
  const config = {
    get: (k: string) =>
      k === 'TOKEN_CACHE_TTL_MS' ? (opts.ttlMs ?? 30_000) : [],
  } as never;
  return { guard: new JwtGuard(supabase, reflector, config), getUser };
}

const ctx = (req: Record<string, unknown>) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => 'h',
    getClass: () => 'c',
  }) as never;

const REAL_USER = {
  id: 'user-1',
  email: 'a@b.test',
  role: 'authenticated',
  app_metadata: { role: 'user' },
};
const GUEST = { ...REAL_USER, id: 'guest-1', is_anonymous: true };

describe('PERF-003 — validated tokens are cached', () => {
  it('calls GoTrue once for repeated requests with the same token', async () => {
    const { guard, getUser } = makeGuard({ user: REAL_USER });
    for (let i = 0; i < 5; i += 1) {
      await guard.canActivate(ctx({ headers: { authorization: 'Bearer t1' } }));
    }
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('still populates the request identically on a cache hit', async () => {
    const { guard } = makeGuard({ user: REAL_USER });
    const first: Record<string, unknown> = {
      headers: { authorization: 'Bearer t1' },
    };
    const second: Record<string, unknown> = {
      headers: { authorization: 'Bearer t1' },
    };
    await guard.canActivate(ctx(first));
    await guard.canActivate(ctx(second));
    expect(second.user).toEqual(first.user);
    expect(second.accessToken).toBe('t1');
    expect(second.supabaseUser).toBeDefined();
  });

  it('does not confuse two different tokens', async () => {
    const { guard, getUser } = makeGuard({ user: REAL_USER });
    await guard.canActivate(ctx({ headers: { authorization: 'Bearer t1' } }));
    await guard.canActivate(ctx({ headers: { authorization: 'Bearer t2' } }));
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('is disabled entirely at TTL 0', async () => {
    const { guard, getUser } = makeGuard({ user: REAL_USER, ttlMs: 0 });
    await guard.canActivate(ctx({ headers: { authorization: 'Bearer t1' } }));
    await guard.canActivate(ctx({ headers: { authorization: 'Bearer t1' } }));
    expect(getUser).toHaveBeenCalledTimes(2);
  });
});

describe('PERF-003 — an anonymous identity is NEVER cached', () => {
  it('re-validates a guest on every request, even on an @AllowAnonymous route', async () => {
    // If this entry were cached, the next GATED route would get a cache hit and
    // never evaluate the anonymous gate.
    const { guard, getUser } = makeGuard({ user: GUEST, allowAnonymous: true });
    await guard.canActivate(
      ctx({ headers: { authorization: 'Bearer guest' } }),
    );
    await guard.canActivate(
      ctx({ headers: { authorization: 'Bearer guest' } }),
    );
    expect(getUser).toHaveBeenCalledTimes(2);
  });

  it('still blocks a guest on a gated route after an allowed one', async () => {
    const getUser = jest
      .fn()
      .mockResolvedValue({ data: { user: GUEST }, error: null });
    const supabase = {
      admin: { auth: { getUser }, from: jest.fn() },
      forUser: jest.fn(() => ({ scoped: true })),
    } as never;
    let allowAnonymous = true;
    const reflector = {
      getAllAndOverride: jest.fn((key: string) =>
        key === ALLOW_ANONYMOUS_KEY ? allowAnonymous : undefined,
      ),
    } as unknown as Reflector;
    const config = {
      get: (k: string) => (k === 'TOKEN_CACHE_TTL_MS' ? 30_000 : []),
    } as never;
    const guard = new JwtGuard(supabase, reflector, config);

    // 1) allowed route — succeeds
    await expect(
      guard.canActivate(ctx({ headers: { authorization: 'Bearer guest' } })),
    ).resolves.toBe(true);

    // 2) gated route, same token — must still be refused
    allowAnonymous = false;
    await expect(
      guard.canActivate(ctx({ headers: { authorization: 'Bearer guest' } })),
    ).rejects.toThrow(/requires a VisaAI account/);
  });
});

describe('TokenCache', () => {
  it('expires entries after the TTL', async () => {
    const cache = new TokenCache(10);
    const user = { id: 'u', email: 'e', role: 'authenticated' };
    cache.set('tok', { user, token: 'tok' });
    expect(cache.get('tok')).toBeDefined();
    await new Promise((r) => setTimeout(r, 25));
    expect(cache.get('tok')).toBeUndefined();
  });

  it('evicts the least recently used entry at the size ceiling', () => {
    const cache = new TokenCache(60_000, 2);
    const user = { id: 'u', email: 'e', role: 'authenticated' };
    cache.set('a', { user, token: 'a' });
    cache.set('b', { user, token: 'b' });
    cache.get('a'); // 'a' becomes most recent, so 'b' is next out
    cache.set('c', { user, token: 'c' });
    expect(cache.size).toBe(2);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBeDefined();
  });

  it('never stores the raw token as a key', () => {
    const cache = new TokenCache(60_000);
    const user = { id: 'u', email: 'e', role: 'authenticated' };
    cache.set('super-secret-bearer', { user, token: 'super-secret-bearer' });
    // A heap dump of this map must not hand over live credentials.
    expect(
      JSON.stringify([
        ...(
          cache as unknown as { entries: Map<string, unknown> }
        ).entries.keys(),
      ]),
    ).not.toContain('super-secret-bearer');
  });
});
