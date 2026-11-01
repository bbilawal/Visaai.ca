import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { safeLog } from '../shared/log/redact';
import { readAccessTokenClaims } from './jwt-claims';
import type { Env } from '../../config/configuration';
import { TokenCache } from './token-cache';

/**
 * Marks a controller or handler as reachable by anonymous (guest) Supabase
 * identities. Without it, JwtGuard rejects anonymous users with 403 — the
 * fail-closed default that gates every post-intake feature. Apply ONLY to the
 * public intake surface (intake, me).
 */
export const ALLOW_ANONYMOUS_KEY = 'allowAnonymous';
export const AllowAnonymous = () => SetMetadata(ALLOW_ANONYMOUS_KEY, true);

/**
 * Makes authentication OPTIONAL for a handler: the request proceeds with
 * `request.user = null` when no usable credential is present, and is attributed
 * normally when a valid token IS present.
 *
 * This is distinct from @AllowAnonymous, and the difference caused a real
 * outage of the analytics funnel (ANALYTICS-001). @AllowAnonymous admits a
 * *guest Supabase identity* — a caller who still holds a JWT. It does nothing
 * for a caller with no token at all, because this guard rejects a missing
 * Authorization header before any metadata is read. `/analytics/collect` was
 * marked @AllowAnonymous and still 401'd every beacon, because
 * `navigator.sendBeacon` cannot set an Authorization header at all.
 *
 * On an opt-in route a token that is absent, malformed or expired degrades to
 * unauthenticated rather than 401 — for telemetry, dropping an event because a
 * session lapsed is the worse failure. A handler under this decorator MUST
 * therefore treat `user` as untrusted and optional, and must not expose
 * anything a logged-out caller may not see.
 *
 * Apply ONLY to write-only, non-readback ingest endpoints.
 */
export const ALLOW_UNAUTHENTICATED_KEY = 'allowUnauthenticated';
export const AllowUnauthenticated = () =>
  SetMetadata(ALLOW_UNAUTHENTICATED_KEY, true);

export interface AuthUser {
  id: string;
  email: string;
  /**
   * Supabase auth role (usually 'authenticated'). INFORMATIONAL / debug ONLY —
   * never use in authorization logic. All RBAC decisions use `appRole`.
   */
  role: string;
  /**
   * App RBAC role. Single source of truth for authorization. Optional only so
   * test fixtures need not set it; JwtGuard always resolves it at runtime.
   */
  appRole?: 'admin' | 'consultant' | 'user';
  /**
   * True when the Supabase identity is anonymous (a guest, is_anonymous=true).
   * Optional only so test fixtures need not set it; JwtGuard always sets it.
   * NEVER grant gated access to an anonymous user — see the @AllowAnonymous gate.
   */
  isAnonymous?: boolean;
  /**
   * Authenticator Assurance Level from the access token: 'aal1' (password only)
   * or 'aal2' (a second factor was satisfied this session). Drives @RequireMfa
   * step-up. Optional so fixtures need not set it; JwtGuard always sets it.
   */
  aal?: string | null;
  /** True when the user has at least one verified MFA factor enrolled. */
  mfaEnabled?: boolean;
}

type AppRole = NonNullable<AuthUser['appRole']>;

/**
 * The subset of the request this guard writes. Typed because `getRequest()`
 * returns `any`, and every property access on it was an eslint
 * `no-unsafe-member-access` — which then hides a real typo behind fifteen
 * identical warnings.
 */
interface AuthedRequest {
  headers: { authorization?: string };
  user: AuthUser | null;
  accessToken?: string;
  supabaseUser?: unknown;
}

@Injectable()
export class JwtGuard implements CanActivate {
  private readonly adminEmails: Set<string>;
  /**
   * PERF-003: ~29 ms of every ~35 ms authenticated request was a GoTrue
   * round-trip. See token-cache.ts for the measurements and the revocation
   * trade-off this accepts.
   */
  private readonly tokenCache: TokenCache;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly reflector: Reflector,
    config: ConfigService<Env>,
  ) {
    this.adminEmails = new Set(
      config.get('ADMIN_EMAILS', { infer: true }) ?? [],
    );
    this.tokenCache = new TokenCache(
      config.get('TOKEN_CACHE_TTL_MS', { infer: true }) ?? 30_000,
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const authHeader = request.headers.authorization;

    // Optional-auth routes (see @AllowUnauthenticated). Resolved before the
    // header check, because the whole point is that there may be no header.
    const allowUnauthenticated =
      this.reflector.getAllAndOverride<boolean>(ALLOW_UNAUTHENTICATED_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? false;

    if (!authHeader?.startsWith('Bearer ')) {
      if (allowUnauthenticated) {
        request.user = null;
        return true;
      }
      safeLog.error('jwt', 'Missing authorization header');
      throw new UnauthorizedException('Missing authorization token');
    }

    const token = authHeader.slice(7);

    // Cache hit: skip the GoTrue round-trip AND the appRole resolution, both of
    // which are pure functions of this token for the cache's lifetime.
    const cached = this.tokenCache.get(token);
    if (cached) {
      request.user = cached.user;
      request.accessToken = token;
      request.supabaseUser = this.supabase.forUser(token);
      return true;
    }

    try {
      const { data, error } = await this.supabase.admin.auth.getUser(token);
      if (error || !data?.user) {
        safeLog.error(
          'jwt',
          `Supabase token validation failed: ${error?.message ?? 'no user returned'}`,
        );
        throw new UnauthorizedException('Invalid or expired token');
      }

      const appRole = await this.resolveAppRole(
        data.user.id,
        data.user.email ?? '',
        data.user.app_metadata,
      );

      const isAnonymous =
        (data.user as { is_anonymous?: boolean }).is_anonymous === true;

      // MFA awareness (Phase C): `aal` from the token drives @RequireMfa step-up;
      // `mfaEnabled` reflects an enrolled+verified factor on the user. Both are
      // informational here — enforcement is opt-in via MfaGuard.
      const { aal } = readAccessTokenClaims(token);
      const factors =
        (data.user as { factors?: { status?: string }[] }).factors ?? [];
      const mfaEnabled = factors.some((f) => f.status === 'verified');

      // Fail-closed anonymous gate: a guest (anonymous identity) holds a valid
      // JWT and would otherwise pass this guard. Reject unless the route opts in
      // via @AllowAnonymous(). Checked at handler then class level. This is the
      // backend enforcement that holds even if the UI blur is bypassed.
      const allowAnonymous =
        this.reflector.getAllAndOverride<boolean>(ALLOW_ANONYMOUS_KEY, [
          context.getHandler(),
          context.getClass(),
        ]) ?? false;
      if (isAnonymous && !allowAnonymous) {
        safeLog.error(
          'jwt',
          `anonymous user ${data.user.id} blocked from gated route`,
        );
        throw new ForbiddenException(
          'This feature requires a VisaAI account. Please sign in or create one.',
        );
      }

      request.user = {
        id: data.user.id,
        email: data.user.email || '',
        role: (data.user.role as string) || 'authenticated',
        appRole,
        isAnonymous,
        aal,
        mfaEnabled,
      } satisfies AuthUser;

      // Cache NON-ANONYMOUS identities only.
      //
      // This is a security constraint, not an optimisation. The @AllowAnonymous
      // gate above is per-ROUTE, but the cache key is only the token. Caching a
      // guest after they legitimately hit an @AllowAnonymous route would let the
      // next request reuse that entry on a GATED route and skip the gate
      // entirely — an anonymous user walking into authenticated-only features.
      // A cache hit is therefore, by construction, always a caller for whom the
      // gate is irrelevant.
      if (!isAnonymous) {
        this.tokenCache.set(token, { user: request.user, token });
      }

      // F1: expose the caller's token + an RLS-scoped client to handlers so
      // request-path queries run under Row-Level Security, not service-role.
      request.accessToken = token;
      request.supabaseUser = this.supabase.forUser(token);

      return true;
    } catch (error) {
      safeLog.error('jwt', 'Token validation error', error);
      // Preserve explicit authorization failures — the anonymous gate raises 403,
      // which must not be downgraded to 401 by the catch-all below.
      if (error instanceof ForbiddenException) throw error;
      // On an optional-auth route a bad or expired token degrades to
      // unauthenticated instead of failing the request. Deliberate: dropping a
      // telemetry event because a session lapsed loses data for no security
      // gain, and these handlers return nothing to the caller.
      if (allowUnauthenticated) {
        request.user = null;
        return true;
      }
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Deterministic RBAC role resolution (lockout-safe, no feature flag):
   *   1. app_metadata.role (signed, server-only) — used if a valid value
   *   2. DB fallback when (1) is absent/invalid:
   *        a. admin email registry (server config) -> 'admin'
   *        b. active consultant_assignments row     -> 'consultant'
   *   3. default 'user' (logged)
   *
   * NEVER reads user_metadata (user-editable) or the Supabase auth role.
   * Pure function of (userId, email, app_metadata, DB state) — no side effects,
   * no request-order dependence.
   */
  private async resolveAppRole(
    userId: string,
    email: string,
    appMetadata: unknown,
  ): Promise<AppRole> {
    // 1. primary: signed app_metadata.role
    const raw = (appMetadata as { role?: unknown } | undefined)?.role;
    if (raw === 'admin' || raw === 'consultant' || raw === 'user') return raw;
    if (raw !== undefined) {
      safeLog.error(
        'jwt',
        `unexpected app_metadata.role '${String(raw)}' for user ${userId}; using fallback resolution`,
      );
    }

    // 2a. admin registry (server-config allow-list; not user-controllable)
    if (email && this.adminEmails.has(email.toLowerCase())) return 'admin';

    // 2b. RBAC grants (user_roles → roles): the 6-role model mapped onto the
    // legacy claim. platform_admin/super_admin -> admin; consultant -> consultant.
    // applicant/support_agent/org_admin carry no elevated legacy reach (their
    // power is enforced by PermissionsGuard), so they fall through to 'user'.
    const granted = await this.grantedRoleKeys(userId);
    if (granted.includes('platform_admin') || granted.includes('super_admin')) {
      return 'admin';
    }
    if (granted.includes('consultant')) return 'consultant';

    // 2c. DB truth: an active consultant assignment makes them a consultant
    if (await this.hasActiveConsultantAssignment(userId)) return 'consultant';

    // 3. last resort
    safeLog.error(
      'jwt',
      `no RBAC role for user ${userId}; defaulting to 'user'`,
    );
    return 'user';
  }

  /** Role keys granted via user_roles (RBAC). Fail-safe: [] on any error. */
  private async grantedRoleKeys(userId: string): Promise<string[]> {
    try {
      const { data } = await this.supabase.admin
        .from('user_roles')
        .select('roles(key)')
        .eq('user_id', userId);
      const keys: string[] = [];
      for (const row of data ?? []) {
        const embed = (row as { roles?: unknown }).roles;
        const role = Array.isArray(embed) ? embed[0] : embed;
        const key = (role as { key?: string } | null)?.key;
        if (key) keys.push(key);
      }
      return keys;
    } catch {
      return [];
    }
  }

  private async hasActiveConsultantAssignment(
    userId: string,
  ): Promise<boolean> {
    try {
      const { data } = await this.supabase.admin
        .from('consultant_assignments')
        .select('id')
        .eq('consultant_id', userId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();
      return !!data;
    } catch {
      // Fail safe: never grant a role on a lookup error.
      return false;
    }
  }
}
