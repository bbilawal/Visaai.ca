import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { isInRollout } from './bucketing';
import {
  FLAG_DEFINITIONS,
  getFlagDefinition,
  type FlagDefinition,
} from './flag-registry';

/** Stored state for one flag. Mirrors `public.feature_flags`. */
export interface FlagRow {
  key: string;
  description: string;
  enabled: boolean;
  rollout_percentage: number;
  allowed_roles: string[];
  allowed_cohorts: string[];
  allowed_user_ids: string[];
  environments: string[];
  updated_at?: string;
  updated_by?: string | null;
}

/**
 * Who a flag is being evaluated for. `userId` is the bucketing subject; when it
 * is absent (a logged-out visitor) percentage rollout cannot be stable, so it
 * is skipped entirely rather than randomised — see `evaluate`.
 */
export interface FlagSubject {
  userId?: string | null;
  appRole?: 'admin' | 'consultant' | 'user';
  /** Active beta-cohort slugs. Resolved by `subjectFor`. */
  cohorts?: string[];
}

/** Why a flag evaluated the way it did. Surfaced by the admin API only. */
export type FlagReason =
  | 'env_force_off'
  | 'env_force_on'
  | 'unregistered'
  | 'no_row'
  | 'store_error'
  | 'environment_mismatch'
  | 'kill_switch'
  | 'allow_user'
  | 'allow_role'
  | 'allow_cohort'
  | 'rollout_in'
  | 'rollout_out'
  | 'no_subject';

export interface FlagEvaluation {
  key: string;
  value: boolean;
  reason: FlagReason;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Feature-flag evaluation.
 *
 * PRECEDENCE — the whole contract, in order. Each step that decides stops.
 *
 *   1. `FEATURE_FLAGS_FORCE_OFF` contains the key            → false
 *   2. `FEATURE_FLAGS_FORCE_ON` contains the key             → true
 *   3. key is not in the code registry                        → false
 *   4. flag store unreadable, or no row for the key           → registry default
 *   5. `environments` is set and excludes this deployment     → registry default
 *   6. `enabled = false`                                      → false  (kill switch)
 *   7. subject is in `allowed_user_ids`                       → true
 *   8. subject's role is in `allowed_roles`                   → true
 *   9. subject is in a cohort listed in `allowed_cohorts`     → true
 *  10. deterministic bucket < `rollout_percentage`            → true / false
 *
 * Steps 1–2 run before any I/O deliberately: the escape hatch has to work when
 * the database is the thing that is down, which is precisely when someone
 * reaches for it. Step 6 sitting above every allow rule is what makes `enabled`
 * a real kill switch — an operator flipping one boolean during an incident must
 * not have to also check whether an allow-list still lets traffic through.
 *
 * CACHING. Rows are cached in-process for `FEATURE_FLAGS_CACHE_TTL_MS` (default
 * 30s), so a flip propagates within that bound on every already-running
 * instance without a restart or a rebuild. That number is the one quoted in the
 * rollback runbook; `refresh()` clears it for the "right now" case.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger('FeatureFlags');

  private readonly forceOff: ReadonlySet<string>;
  private readonly forceOn: ReadonlySet<string>;
  private readonly ttlMs: number;
  private readonly deployEnv: 'development' | 'staging' | 'production';

  private rowCache: CacheEntry<Map<string, FlagRow>> | null = null;
  private inflight: Promise<Map<string, FlagRow>> | null = null;
  private readonly cohortCache = new Map<string, CacheEntry<string[]>>();
  /** Guards against a per-request log flood when the flag store is down. */
  private lastStoreErrorAt = 0;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env>,
  ) {
    this.forceOff = parseKeyList(
      this.config.get('FEATURE_FLAGS_FORCE_OFF', { infer: true }),
    );
    this.forceOn = parseKeyList(
      this.config.get('FEATURE_FLAGS_FORCE_ON', { infer: true }),
    );
    this.ttlMs =
      this.config.get('FEATURE_FLAGS_CACHE_TTL_MS', { infer: true }) ?? 30_000;

    // NODE_ENV has no 'staging'; the beta box runs a production build against
    // beta infrastructure. DEPLOY_ENV is how an operator says so.
    const explicit = this.config.get('DEPLOY_ENV', { infer: true });
    const nodeEnv = this.config.get('NODE_ENV', { infer: true });
    this.deployEnv =
      explicit ?? (nodeEnv === 'production' ? 'production' : 'development');

    const overridden = [...this.forceOff, ...this.forceOn];
    if (overridden.length) {
      // Loud on purpose. An env override silently disagreeing with the admin UI
      // is a genuinely confusing failure to debug, so it announces itself once
      // at boot and is echoed in every admin evaluation's `reason`.
      this.logger.warn(
        `env overrides active — off:[${[...this.forceOff].join(',')}] on:[${[...this.forceOn].join(',')}]`,
      );
    }
  }

  /** Evaluate one flag. Never throws; unknown state degrades to the default. */
  async isEnabled(key: string, subject: FlagSubject = {}): Promise<boolean> {
    return (await this.evaluate(key, subject)).value;
  }

  /** Evaluate one flag, with the reason. */
  async evaluate(
    key: string,
    subject: FlagSubject = {},
  ): Promise<FlagEvaluation> {
    if (this.forceOff.has(key))
      return { key, value: false, reason: 'env_force_off' };
    if (this.forceOn.has(key))
      return { key, value: true, reason: 'env_force_on' };

    const def = getFlagDefinition(key);
    // An unregistered key is not a flag. Returning false rather than throwing
    // keeps a stale client asking about a removed flag from erroring out.
    if (!def) return { key, value: false, reason: 'unregistered' };

    const rows = await this.rows();
    if (!rows) return { key, value: def.defaultValue, reason: 'store_error' };

    const row = rows.get(key);
    if (!row) return { key, value: def.defaultValue, reason: 'no_row' };

    return this.decide(def, row, subject);
  }

  /**
   * Evaluate every client-exposed flag for a subject. One store read, so the
   * client endpoint costs the same as a single evaluation.
   */
  async evaluateAllForClient(
    subject: FlagSubject = {},
  ): Promise<Record<string, boolean>> {
    return this.evaluateSet(
      FLAG_DEFINITIONS.filter((d) => d.clientExposed),
      subject,
    );
  }

  /** Evaluate every registered flag. Admin/debug surfaces only. */
  async evaluateAll(
    subject: FlagSubject = {},
  ): Promise<Record<string, boolean>> {
    return this.evaluateSet(FLAG_DEFINITIONS, subject);
  }

  private async evaluateSet(
    defs: readonly FlagDefinition[],
    subject: FlagSubject,
  ): Promise<Record<string, boolean>> {
    const rows = await this.rows();
    const out: Record<string, boolean> = {};
    for (const def of defs) {
      if (this.forceOff.has(def.key)) {
        out[def.key] = false;
        continue;
      }
      if (this.forceOn.has(def.key)) {
        out[def.key] = true;
        continue;
      }
      const row = rows?.get(def.key);
      out[def.key] = row
        ? this.decide(def, row, subject).value
        : def.defaultValue;
    }
    return out;
  }

  /** Steps 5–10 of the precedence table. Pure — no I/O, fully unit-testable. */
  private decide(
    def: FlagDefinition,
    row: FlagRow,
    subject: FlagSubject,
  ): FlagEvaluation {
    const key = def.key;

    // An environment-scoped flag that does not name this deployment is not
    // "off" — it is *not applicable here*, so it answers with the code default
    // rather than silently disabling a live subsystem in the wrong environment.
    if (
      row.environments?.length &&
      !row.environments.includes(this.deployEnv)
    ) {
      return { key, value: def.defaultValue, reason: 'environment_mismatch' };
    }

    if (!row.enabled) return { key, value: false, reason: 'kill_switch' };

    const userId = subject.userId ?? null;

    if (userId && row.allowed_user_ids?.includes(userId)) {
      return { key, value: true, reason: 'allow_user' };
    }
    if (subject.appRole && row.allowed_roles?.includes(subject.appRole)) {
      return { key, value: true, reason: 'allow_role' };
    }
    if (
      row.allowed_cohorts?.length &&
      subject.cohorts?.some((c) => row.allowed_cohorts.includes(c))
    ) {
      return { key, value: true, reason: 'allow_cohort' };
    }

    if (row.rollout_percentage >= 100)
      return { key, value: true, reason: 'rollout_in' };

    // Without a stable subject id there is no stable bucket. Randomising would
    // give a logged-out visitor a different answer on every page load, so a
    // partial rollout simply does not apply to anonymous traffic. 100% is
    // handled above, which is the only way anonymous users get a rolling-out
    // feature — and that is the correct semantics for "fully released".
    if (!userId) return { key, value: false, reason: 'no_subject' };

    const inRollout = isInRollout(key, userId, row.rollout_percentage);
    return {
      key,
      value: inRollout,
      reason: inRollout ? 'rollout_in' : 'rollout_out',
    };
  }

  /**
   * Build a subject from an authenticated user, resolving cohort membership.
   * Cohorts are cached per user for the same TTL as the rows.
   */
  async subjectFor(user: {
    id: string;
    appRole?: 'admin' | 'consultant' | 'user';
  }): Promise<FlagSubject> {
    return {
      userId: user.id,
      appRole: user.appRole,
      cohorts: await this.cohortsFor(user.id),
    };
  }

  /** Active (non-exited) cohort slugs for a user. `[]` on any failure. */
  async cohortsFor(userId: string): Promise<string[]> {
    const hit = this.cohortCache.get(userId);
    if (hit && hit.expiresAt > Date.now()) return hit.value;

    const { data, error } = await this.supabase.admin
      .from('beta_cohort_members')
      .select('beta_cohorts(slug)')
      .eq('user_id', userId)
      .is('exited_at', null);

    if (error) {
      this.noteStoreError('cohort read', error.message);
      return [];
    }

    const slugs = (data ?? [])
      .map((r) => {
        // PostgREST returns an embedded row as an object, or an array when it
        // cannot prove the relationship is to-one. Handle both rather than
        // depending on which shape today's schema cache produces.
        const embedded = (r as { beta_cohorts?: unknown }).beta_cohorts;
        const one = Array.isArray(embedded) ? embedded[0] : embedded;
        return (one as { slug?: string } | undefined)?.slug;
      })
      .filter((s): s is string => typeof s === 'string');

    this.cohortCache.set(userId, {
      value: slugs,
      expiresAt: Date.now() + this.ttlMs,
    });
    return slugs;
  }

  /** Drop every cache. Called after an admin write so a flip lands at once. */
  refresh(): void {
    this.rowCache = null;
    this.cohortCache.clear();
  }

  /** Raw rows for the admin API. `null` when the store is unreadable. */
  async allRows(): Promise<Map<string, FlagRow> | null> {
    return this.rows();
  }

  /** Cached read of every flag row. `null` signals "could not read". */
  private async rows(): Promise<Map<string, FlagRow> | null> {
    const now = Date.now();
    if (this.rowCache && this.rowCache.expiresAt > now)
      return this.rowCache.value;

    // Collapse concurrent misses onto one query. Without this a cold cache
    // under load fires one Supabase read per in-flight request.
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      const { data, error } = await this.supabase.admin
        .from('feature_flags')
        .select(
          'key, description, enabled, rollout_percentage, allowed_roles, ' +
            'allowed_cohorts, allowed_user_ids, environments, updated_at, updated_by',
        );

      if (error) {
        this.noteStoreError('flag read', error.message);
        // Deliberately does NOT poison the cache with an empty map: the next
        // request should retry, not serve defaults for the whole TTL.
        throw new Error(error.message);
      }

      const map = new Map<string, FlagRow>();
      // Double cast: the generated Supabase types do not know this table yet,
      // so the select() return widens to GenericStringError[].
      for (const r of (data ?? []) as unknown as FlagRow[]) map.set(r.key, r);
      this.rowCache = { value: map, expiresAt: Date.now() + this.ttlMs };
      return map;
    })().finally(() => {
      this.inflight = null;
    });

    try {
      return await this.inflight;
    } catch {
      return null;
    }
  }

  /** Rate-limited error logging — one line a minute, not one per request. */
  private noteStoreError(what: string, message: string): void {
    const now = Date.now();
    if (now - this.lastStoreErrorAt < 60_000) return;
    this.lastStoreErrorAt = now;
    this.logger.error(`${what} failed, serving registry defaults: ${message}`);
  }
}

/** `"a, b ,,c"` → `Set{a,b,c}`. Tolerant of operator whitespace. */
function parseKeyList(raw: string | undefined): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );
}
