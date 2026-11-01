import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../shared/supabase/supabase.service';

export type FeedbackKind =
  | 'bug'
  | 'feature_request'
  | 'satisfaction'
  | 'ai_response'
  | 'consultant'
  | 'other';

export type FeedbackSurface = 'web' | 'ios' | 'android' | 'extension';

export type FeedbackStatus =
  | 'new'
  | 'triaged'
  | 'in_progress'
  | 'resolved'
  | 'wont_fix'
  | 'duplicate';

export interface SubmitFeedbackInput {
  kind: FeedbackKind;
  rating?: number | null;
  message?: string;
  surface: FeedbackSurface;
  appVersion?: string;
  applicationId?: string | null;
  diagnosticsConsent?: boolean;
  screenshotPath?: string | null;
  device?: Record<string, unknown>;
}

/**
 * Client-supplied device metadata is restricted to these keys. Anything else a
 * client sends is dropped silently rather than rejected — a mobile SDK version
 * that starts sending an extra field should not start failing every bug report,
 * and a client that can put arbitrary keys into a jsonb column is one careless
 * SDK release away from shipping PII into the support queue.
 *
 * Every key here is non-identifying on its own. Notably absent: any device
 * identifier, advertising id, IP address, locale-derived geolocation, or push
 * token — none of which are needed to reproduce a bug and all of which would
 * turn this table into a tracking surface requiring its own disclosure.
 */
export const FEEDBACK_DEVICE_KEYS = [
  'platform',
  'os_version',
  'device_model',
  'app_build',
  'screen_width',
  'screen_height',
  'locale',
  'network_type',
  'is_emulator',
] as const;

/**
 * Server-built context keys. The client never writes these; the service derives
 * them from the request so they can be trusted in triage.
 */
export const FEEDBACK_CONTEXT_KEYS = [
  'route',
  'referer',
  'user_agent',
] as const;

/** Truncation limits. Applied before insert so the DB constraint is never hit. */
const MAX_MESSAGE = 2000;
const MAX_VERSION = 64;
const MAX_DEVICE_VALUE = 120;

const RATING_KINDS: ReadonlySet<FeedbackKind> = new Set([
  'satisfaction',
  'ai_response',
  'consultant',
]);

/**
 * Beta feedback capture and triage (Task 15 §6).
 *
 * WRITE PATH runs on the caller's RLS-scoped client, so a user can only ever
 * file feedback as themselves — the `beta_feedback_self_insert` policy is the
 * boundary, not a `.eq()` the service might forget.
 *
 * TRIAGE PATH runs on the service-role client because support staff must read
 * across users; authorization for that is the `support.access` permission on
 * the controller, checked before anything here executes.
 *
 * The privacy posture is described in full in the migration
 * (`20260806140000_beta_feedback.sql`). The short version: `message` is the
 * only free-text field a client controls, `device` is allowlisted here, and
 * `application_id` is a reference rather than a copy of case data.
 */
@Injectable()
export class FeedbackService {
  /**
   * ERR-002: never interpolate a raw Supabase/Postgres error into a
   * `BadRequestException`.
   *
   * `AllExceptionsFilter` passes a 4xx `message` through to the client
   * verbatim — by design, so zod validation text reaches the caller. Wrapping a
   * DB error in one therefore hands the caller table, column and constraint
   * names. `listMine` is reachable by ANY authenticated user, so this was not
   * even admin-gated. The detail belongs in the log, not the response.
   */
  private logDbError(where: string, error: { message: string }): void {
    this.logger.error(`${where}: ${error.message}`);
  }
  private readonly logger = new Logger('Feedback');

  constructor(private readonly supabase: SupabaseService) {}

  /** File feedback as the authenticated caller. */
  async submit(
    db: SupabaseClient,
    userId: string,
    input: SubmitFeedbackInput,
    context: Partial<
      Record<(typeof FEEDBACK_CONTEXT_KEYS)[number], string>
    > = {},
  ) {
    this.assertRatingMatchesKind(input.kind, input.rating);

    const diagnosticsConsent = input.diagnosticsConsent === true;
    if (input.screenshotPath && !diagnosticsConsent) {
      // Mirrors the CHECK constraint so the caller gets a useful message rather
      // than a raw Postgres violation.
      throw new BadRequestException(
        'A screenshot may only be attached with diagnostics consent.',
      );
    }
    if (
      input.screenshotPath &&
      !input.screenshotPath.startsWith(`${userId}/`)
    ) {
      // Storage RLS already enforces the `<uid>/…` prefix; refusing here means a
      // mismatched path fails as a clear 400 instead of a dangling row pointing
      // at an object the user cannot read.
      throw new BadRequestException(
        "screenshotPath must live under the caller's own storage prefix.",
      );
    }

    const row = {
      user_id: userId,
      kind: input.kind,
      rating: RATING_KINDS.has(input.kind) ? input.rating : null,
      message: (input.message ?? '').slice(0, MAX_MESSAGE),
      surface: input.surface,
      app_version: (input.appVersion ?? '').slice(0, MAX_VERSION),
      context: pickAllowed(context, FEEDBACK_CONTEXT_KEYS),
      device: pickAllowed(input.device ?? {}, FEEDBACK_DEVICE_KEYS),
      application_id: input.applicationId ?? null,
      diagnostics_consent: diagnosticsConsent,
      screenshot_path: input.screenshotPath ?? null,
    };

    const { data, error } = await db
      .from('beta_feedback')
      .insert(row)
      .select('id, kind, status, created_at')
      .single();

    if (error) {
      this.logDbError('feedback submission failed', error);
      throw new BadRequestException('Feedback submission failed');
    }

    this.logger.log(
      `feedback ${data.id} (${input.kind}/${input.surface}) filed`,
    );
    return data;
  }

  /** The caller's own feedback, newest first (RLS-scoped). */
  async listMine(db: SupabaseClient, limit = 50) {
    const { data, error } = await db
      .from('beta_feedback')
      .select(
        'id, kind, rating, message, surface, status, resolution, created_at, resolved_at',
      )
      .order('created_at', { ascending: false })
      .limit(clamp(limit, 1, 200));
    if (error) {
      this.logDbError('feedback read failed', error);
      throw new BadRequestException('Feedback read failed');
    }
    return data ?? [];
  }

  /** Triage queue. Service-role — the controller gates this on `support.access`. */
  async listAll(filters: {
    status?: FeedbackStatus;
    kind?: FeedbackKind;
    surface?: FeedbackSurface;
    limit?: number;
  }) {
    let q = this.supabase.admin
      .from('beta_feedback')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(clamp(filters.limit ?? 100, 1, 500));

    if (filters.status) q = q.eq('status', filters.status);
    if (filters.kind) q = q.eq('kind', filters.kind);
    if (filters.surface) q = q.eq('surface', filters.surface);

    const { data, error } = await q;
    if (error) {
      this.logDbError('feedback triage read failed', error);
      throw new BadRequestException('Feedback read failed');
    }
    return data ?? [];
  }

  /** Update triage state. */
  async triage(
    id: string,
    patch: {
      status?: FeedbackStatus;
      severity?: 'critical' | 'high' | 'medium' | 'low';
      ownerId?: string | null;
      resolution?: string;
    },
  ) {
    const update: Record<string, unknown> = {};
    if (patch.status) update.status = patch.status;
    if (patch.severity) update.severity = patch.severity;
    if (patch.ownerId !== undefined) update.owner_id = patch.ownerId;
    if (patch.resolution !== undefined)
      update.resolution = patch.resolution.slice(0, 2000);
    // `resolved_at` is derived, never client-supplied, so the resolution
    // timestamp cannot be backdated to flatter a response-time metric.
    if (patch.status === 'resolved' || patch.status === 'wont_fix') {
      update.resolved_at = new Date().toISOString();
    }

    if (Object.keys(update).length === 0) {
      throw new BadRequestException('No triage changes supplied.');
    }

    const { data, error } = await this.supabase.admin
      .from('beta_feedback')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      this.logDbError('feedback triage update failed', error);
      throw new BadRequestException('Triage update failed');
    }
    return data;
  }

  /**
   * Counts for the beta metrics dashboard. Aggregated in-process over the
   * window rather than in SQL: beta volume is small by construction (a capped
   * cohort), and a view would have to be `security_invoker` to be safe — the
   * exact defect Task 14 found in production (SEC-22).
   */
  async summary(sinceIso: string) {
    const { data, error } = await this.supabase.admin
      .from('beta_feedback')
      .select('kind, surface, status, rating')
      .gte('created_at', sinceIso);

    if (error) {
      this.logDbError('feedback summary failed', error);
      throw new BadRequestException('Feedback summary failed');
    }

    const rows = (data ?? []) as Array<{
      kind: FeedbackKind;
      surface: FeedbackSurface;
      status: FeedbackStatus;
      rating: number | null;
    }>;

    const byKind: Record<string, number> = {};
    const bySurface: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    let ratingSum = 0;
    let ratingCount = 0;

    for (const r of rows) {
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
      bySurface[r.surface] = (bySurface[r.surface] ?? 0) + 1;
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      if (typeof r.rating === 'number') {
        ratingSum += r.rating;
        ratingCount++;
      }
    }

    return {
      since: sinceIso,
      total: rows.length,
      byKind,
      bySurface,
      byStatus,
      // null, not 0, when nothing has been rated. A satisfaction score of 0 is
      // not a possible rating (the scale is 1–5), so reporting 0 for "no data"
      // would be indistinguishable from catastrophically bad — and would flow
      // straight into an exit-criteria check.
      averageRating: ratingCount
        ? Number((ratingSum / ratingCount).toFixed(2))
        : null,
      ratingCount,
    };
  }

  private assertRatingMatchesKind(
    kind: FeedbackKind,
    rating: number | null | undefined,
  ) {
    const needsRating = RATING_KINDS.has(kind);
    if (needsRating && (rating === null || rating === undefined)) {
      throw new BadRequestException(
        `'${kind}' feedback requires a rating of 1–5.`,
      );
    }
    if (
      needsRating &&
      (!Number.isInteger(rating) || rating! < 1 || rating! > 5)
    ) {
      throw new BadRequestException('rating must be an integer 1–5.');
    }
  }
}

/** Keep only allowlisted keys; stringify and truncate scalar values. */
function pickAllowed(
  source: Record<string, unknown>,
  allowed: readonly string[],
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of allowed) {
    const v = source[key];
    if (v === undefined || v === null) continue;
    if (typeof v === 'number' || typeof v === 'boolean') {
      out[key] = v;
    } else if (typeof v === 'string') {
      out[key] = v.slice(0, MAX_DEVICE_VALUE);
    }
    // Objects and arrays are dropped: nested structures are the easiest place
    // for unreviewed data to hide, and nothing in the allowlist needs one.
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.trunc(n)));
}
