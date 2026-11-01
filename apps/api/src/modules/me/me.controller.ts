import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Optional,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AllowAnonymous, JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { AnalyticsEventBus } from '../analytics/analytics-event-bus';
import { makeServerEvent } from '../analytics/events/catalog';
import { LANGUAGE_NAMES } from '../../i18n/language';
import { UserProfileRepository } from '../shared/users/user-profile.repository';

const SUPPORTED_LANGUAGES = new Set(Object.keys(LANGUAGE_NAMES));

// A `users` row created more recently than this, on the first `/me` sync this
// process has observed for that user, is treated as a fresh signup rather
// than a returning sign-in (see MeController.trackIdentity below).
const FRESH_SIGNUP_WINDOW_MS = 2 * 60 * 1000;

// Bound on the process-local `seenUsers` dedup set (unbounded growth otherwise
// over the process lifetime). Oldest-first eviction may cause a rare duplicate
// registered/signed_in re-emit for a long-idle user who returns after eviction
// — acceptable for a best-effort signal.
const MAX_TRACKED_USERS = 50_000;

function bearer(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith('Bearer ')) return null;
  return authHeader.slice(7);
}

/**
 * GET /me — the authoritative identity + RBAC role for the current caller.
 * appRole is resolved by JwtGuard (app_metadata -> admin registry -> active
 * assignment -> 'user'); no DB lookup here. The frontend uses this as the single
 * source of truth for role-based routing/UI (never client-decoded).
 *
 * GET/PATCH /me/language — the user's preferred UI language (cross-device).
 * The web app mirrors this into the NEXT_LOCALE cookie; the AI pipeline reads
 * users.preferred_language to localise responses.
 *
 * @AllowAnonymous: guests need their identity (and isAnonymous flag) to drive the
 * gated-UI state. Returning identity for an anonymous user leaks nothing — RLS
 * still scopes all data, and appRole is always 'user' for a guest.
 *
 * Analytics: registration/sign-in have no dedicated server hook — Supabase's
 * `on_auth_user_created` trigger (supabase/migrations/20260531000000_initial_
 * schema.sql `handle_new_user`) inserts the `users` row directly in Postgres,
 * with no API call the backend ever sees. This `/me` GET is the first request
 * the frontend makes after any auth-state change, so it stands in as the
 * touch point: see `trackIdentity` below for how registered/signed_in/active
 * are approximated from it (process-local dedupe; see task-12 report).
 */
@Controller('me')
@UseGuards(JwtGuard)
@AllowAnonymous()
export class MeController {
  // Users we've already emitted a registered/signed_in event for during this
  // process's lifetime (see trackIdentity). Process-local — not a source of
  // truth. Same per-worker limitation as ProgressService's dedup maps: a
  // restart, an eviction, or a second instance (cluster/pm2 mode) re-observes a
  // user's next call as "first sync", so user.registered/signed_in can fire
  // once per worker. Bounded by MAX_TRACKED_USERS (oldest-first eviction).
  private readonly seenUsers = new Set<string>();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly users: UserProfileRepository,
    @Optional() private readonly analytics?: AnalyticsEventBus,
  ) {}

  @Get()
  me(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authHeader?: string,
  ): {
    id: string;
    email: string;
    appRole: 'admin' | 'consultant' | 'user';
    isAnonymous: boolean;
  } {
    // Fire-and-forget: never let analytics add latency or failure risk to the
    // identity response. Anonymous guests are excluded — they're covered by
    // the client SDK's anonymous_id session tracking instead (Task 15).
    if (!user.isAnonymous) {
      this.trackIdentity(user, authHeader).catch(() => {});
    }
    return {
      id: user.id,
      email: user.email,
      appRole: user.appRole ?? 'user',
      isAnonymous: user.isAnonymous ?? false,
    };
  }

  /** First `/me` sync this process has observed for the user → approximate
   * `user.registered` (users row created within FRESH_SIGNUP_WINDOW_MS) or
   * `user.signed_in` (older row). Every subsequent call → `user.active`. */
  private async trackIdentity(
    user: AuthUser,
    authHeader: string | undefined,
  ): Promise<void> {
    if (!this.analytics) return;

    if (this.seenUsers.has(user.id)) {
      this.analytics.emitSafe(
        makeServerEvent('user.active', { user_id: user.id }),
      );
      return;
    }
    this.seenUsers.add(user.id);
    // Oldest-first eviction (Set preserves insertion order) to bound growth.
    while (this.seenUsers.size > MAX_TRACKED_USERS) {
      const oldest = this.seenUsers.keys().next().value;
      if (oldest === undefined) break;
      this.seenUsers.delete(oldest);
    }

    const token = bearer(authHeader);
    let createdAt: string | null = null;
    if (token) {
      createdAt = await this.users.getCreatedAt(
        this.supabase.forUser(token),
        user.id,
      );
    }

    const isFreshSignup =
      !!createdAt &&
      Date.now() - new Date(createdAt).getTime() < FRESH_SIGNUP_WINDOW_MS;

    this.analytics.emitSafe(
      makeServerEvent(isFreshSignup ? 'user.registered' : 'user.signed_in', {
        user_id: user.id,
      }),
    );
  }

  /** Read the stored language preference (used on login to seed the cookie). */
  @Get('language')
  async getLanguage(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') authHeader?: string,
  ): Promise<{ language: string | null }> {
    const token = bearer(authHeader);
    if (!token) return { language: null };
    const language = await this.users.getPreferredLanguage(
      this.supabase.forUser(token),
      user.id,
    );
    return { language };
  }

  /** Persist the language preference (cross-device). RLS scopes it to own row. */
  @Patch('language')
  async setLanguage(
    @CurrentUser() user: AuthUser,
    @Body() body: { language?: string },
    @Headers('authorization') authHeader?: string,
  ): Promise<{ language: string }> {
    const language = body?.language;
    if (!language || !SUPPORTED_LANGUAGES.has(language)) {
      throw new BadRequestException(`Unsupported language: ${language ?? ''}`);
    }
    const token = bearer(authHeader);
    if (!token) throw new BadRequestException('Missing authorization token');
    const ok = await this.users.setPreferredLanguage(
      this.supabase.forUser(token),
      user.id,
      language,
    );
    if (!ok) throw new BadRequestException('Failed to save language');
    return { language };
  }
}
