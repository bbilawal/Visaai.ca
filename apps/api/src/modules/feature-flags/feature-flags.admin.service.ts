import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { FeatureFlagsService, type FlagRow } from './feature-flags.service';
import { FLAG_DEFINITIONS, isRegisteredFlag } from './flag-registry';

export interface FlagPatch {
  enabled?: boolean;
  rollout_percentage?: number;
  allowed_roles?: string[];
  allowed_cohorts?: string[];
  allowed_user_ids?: string[];
  environments?: string[];
  description?: string;
}

export interface Actor {
  id: string;
  email: string;
}

/**
 * Write path for flag state.
 *
 * Separate from `FeatureFlagsService` on purpose: evaluation is on every
 * request path and must stay allocation-light and impossible to accidentally
 * make writable, while this runs a handful of times a week behind an admin
 * permission. Nothing here is called during normal traffic.
 *
 * Every mutation is recorded in `feature_flag_audit` with before/after state
 * and an actor, because "who turned payments off at 02:14, and why" is the
 * first question a post-incident review asks (Task 16 §4, decision log).
 */
@Injectable()
export class FeatureFlagsAdminService {
  private readonly logger = new Logger('FeatureFlagsAdmin');

  constructor(
    private readonly supabase: SupabaseService,
    private readonly flags: FeatureFlagsService,
  ) {}

  /**
   * Every registered flag joined with its stored state. Registry-driven, so a
   * flag that has no row yet still appears — with `row: null` — instead of
   * vanishing from the admin UI until someone happens to write to it.
   */
  async list(): Promise<
    Array<{
      key: string;
      description: string;
      defaultValue: boolean;
      killSwitch: boolean;
      clientExposed: boolean;
      owner: string;
      row: FlagRow | null;
    }>
  > {
    const rows = await this.flags.allRows();
    return FLAG_DEFINITIONS.map((def) => ({
      key: def.key,
      description: def.description,
      defaultValue: def.defaultValue,
      killSwitch: def.killSwitch,
      clientExposed: def.clientExposed,
      owner: def.owner,
      row: rows?.get(def.key) ?? null,
    }));
  }

  /**
   * Upsert state for a registered key.
   *
   * `reason` is required for a kill-switch flag. Being made to type why you are
   * disabling payments is a two-second cost that produces the one artefact an
   * incident review always wants and never has.
   */
  async set(key: string, patch: FlagPatch, actor: Actor, reason?: string) {
    if (!isRegisteredFlag(key)) {
      // The registry is the allowlist. Without this, a typo creates a row that
      // looks live in the admin UI and controls nothing.
      throw new BadRequestException(
        `Unknown flag '${key}'. Flags are declared in feature-flags/flag-registry.ts.`,
      );
    }

    const def = FLAG_DEFINITIONS.find((d) => d.key === key)!;
    if (def.killSwitch && !reason?.trim()) {
      throw new BadRequestException(
        `'${key}' is a kill switch; a reason is required so the change is reviewable.`,
      );
    }

    if (
      patch.rollout_percentage !== undefined &&
      (!Number.isInteger(patch.rollout_percentage) ||
        patch.rollout_percentage < 0 ||
        patch.rollout_percentage > 100)
    ) {
      throw new BadRequestException(
        'rollout_percentage must be an integer 0–100.',
      );
    }

    const before = (await this.flags.allRows())?.get(key) ?? null;

    const { data, error } = await this.supabase.admin
      .from('feature_flags')
      .upsert(
        {
          key,
          // Defaults only apply on INSERT; on UPDATE the spread of `patch`
          // leaves untouched columns alone because PostgREST ignores absent keys.
          description:
            patch.description ?? before?.description ?? def.description,
          ...patch,
          updated_by: actor.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' },
      )
      .select()
      .single();

    if (error)
      throw new BadRequestException(`Flag update failed: ${error.message}`);

    await this.audit(
      key,
      before ? 'updated' : 'created',
      before,
      data,
      actor,
      reason,
    );

    // Drop the cache so the operator's next read reflects the write. Other
    // instances still converge within FEATURE_FLAGS_CACHE_TTL_MS — this process
    // is simply the one that gets it immediately.
    this.flags.refresh();

    this.logger.warn(
      `flag ${key} ${before ? 'updated' : 'created'} by ${actor.email}` +
        (reason ? `: ${reason}` : ''),
    );
    return data as FlagRow;
  }

  /**
   * Kill-switch shorthand. Exists as its own method because during an incident
   * the operator should not have to compose a patch body correctly.
   */
  async kill(key: string, actor: Actor, reason: string) {
    return this.set(key, { enabled: false }, actor, reason);
  }

  /** Recent audit trail, newest first. */
  async history(key?: string, limit = 100) {
    let q = this.supabase.admin
      .from('feature_flag_audit')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 500));
    if (key) q = q.eq('flag_key', key);
    const { data, error } = await q;
    if (error)
      throw new BadRequestException(`Audit read failed: ${error.message}`);
    return data ?? [];
  }

  private async audit(
    flagKey: string,
    action: 'created' | 'updated' | 'deleted',
    before: unknown,
    after: unknown,
    actor: Actor,
    reason?: string,
  ): Promise<void> {
    const { error } = await this.supabase.admin
      .from('feature_flag_audit')
      .insert({
        flag_key: flagKey,
        action,
        before,
        after,
        actor_id: actor.id,
        actor_email: actor.email,
        reason: reason ?? null,
      });
    // A failed audit write must not roll back a kill switch: during an incident
    // the flip is what matters and the log is reconstructible from the row's
    // updated_by/updated_at. Logged loudly so it is not lost.
    if (error)
      this.logger.error(`audit insert failed for ${flagKey}: ${error.message}`);
  }
}
