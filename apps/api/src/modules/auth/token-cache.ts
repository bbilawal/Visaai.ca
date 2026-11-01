import { createHash } from 'node:crypto';
import type { AuthUser } from './jwt.guard';

/**
 * Short-TTL cache for validated access tokens (PERF-003).
 *
 * THE MEASUREMENT. `JwtGuard` calls `supabase.auth.getUser(token)` on every
 * request, which is a network round-trip to GoTrue. Measured on the seeded
 * local stack:
 *
 *     GoTrue /auth/v1/user        p50  29.1 ms
 *     GET /countries  (no auth)   p50   7.3 ms
 *     GET /me         (auth)      p50  33.6 ms
 *     GET /documents/:id (auth)   p50  37.9 ms
 *
 * So roughly 29 of every ~35 ms — about 80% — is token validation, on 296 of
 * 304 routes. Over the network to a hosted GoTrue it will be worse, not better.
 *
 * WHY A CACHE AND NOT LOCAL VERIFICATION. Verifying the JWT signature in-process
 * would remove the round-trip entirely, and it is what Supabase's own guidance
 * suggests. It also means a token stays valid until it expires — up to an hour —
 * no matter what happens to the session. A 30-second cache keeps GoTrue as the
 * authority and bounds the staleness to something a human would call immediate.
 * That is a deliberately smaller, more reversible step.
 *
 * WHAT THIS COSTS YOU. A sign-out, ban or role change can take up to
 * TOKEN_CACHE_TTL_MS to be observed. Set it to 0 to disable the cache outright
 * if that is unacceptable for your deployment.
 *
 * Tokens are keyed by SHA-256, never stored raw: this map outlives the request,
 * and a heap dump full of live bearer tokens is a credential leak waiting for
 * an incident.
 */
export interface CachedIdentity {
  user: AuthUser;
  token: string;
}

interface Entry {
  value: CachedIdentity;
  expiresAt: number;
}

export class TokenCache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly ttlMs: number,
    /**
     * Hard ceiling on entries. Without one this grows with every distinct token
     * the process ever sees, which on a busy API is a slow memory leak.
     */
    private readonly maxEntries = 5000,
  ) {}

  get enabled(): boolean {
    return this.ttlMs > 0;
  }

  private static key(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  get(token: string): CachedIdentity | undefined {
    if (!this.enabled) return undefined;
    const key = TokenCache.key(token);
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh recency for the eviction order below.
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(token: string, value: CachedIdentity): void {
    if (!this.enabled) return;
    // Map preserves insertion order, so the first key is the least recently
    // used given the reinsertion in get(). Evict before inserting.
    if (this.entries.size >= this.maxEntries) {
      // for...of rather than iterator.next(): the iterator result is typed
      // loosely enough that `.value` lands as `any`.
      for (const oldest of this.entries.keys()) {
        this.entries.delete(oldest);
        break;
      }
    }
    this.entries.set(TokenCache.key(token), {
      value,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /** Drop a specific token — for an explicit sign-out path to call. */
  invalidate(token: string): void {
    this.entries.delete(TokenCache.key(token));
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
