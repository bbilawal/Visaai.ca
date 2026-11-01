import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { PlanTier } from '@visaai/types';

/**
 * Rank an active/trialing subscription grants: the software layer (copilot).
 * It never grants expert(3)/consultant-review — that is credits or the
 * per-visa fee.
 *
 * ARCH-003: this lived in subscriptions/subscription.constants and was the ONLY
 * thing entitlement imported from subscriptions. That single constant closed
 * the auth -> entitlement -> subscriptions -> auth loop. It is an entitlement
 * concept with exactly one consumer (below), so it belongs here.
 */
export const SUB_PLAN_RANK = 2;

export const PLAN_RANK: Record<PlanTier, number> = {
  none: 0,
  self_service: 1,
  copilot: 2,
  expert: 3,
};

/**
 * Resolves a user's effective plan rank as the max of their per-application
 * plan_tier and the floor granted by an active subscription. A subscription
 * grants the software layer (copilot rank) only — never expert/consultant-review.
 */
@Injectable()
export class EntitlementService {
  /**
   * Ids from FREE_ACCESS_USER_IDS. Empty in normal operation.
   *
   * Read once at construction rather than per call: it is deployment config,
   * and a per-request env read would let it drift between two checks inside
   * one request.
   */
  private readonly freeAccessUserIds: ReadonlySet<string>;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env>,
  ) {
    const raw = this.config.get('FREE_ACCESS_USER_IDS', { infer: true }) ?? '';
    this.freeAccessUserIds = new Set(
      raw
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    );

    // Announced, never silent. An entitlement bypass that nobody can see in the
    // logs is one that outlives the test it was added for and quietly makes a
    // paid product free for whoever is on the list.
    if (this.freeAccessUserIds.size > 0) {
      new Logger(EntitlementService.name).warn(
        `FREE_ACCESS_USER_IDS active — ${this.freeAccessUserIds.size} user(s) bypass every plan gate: ` +
          [...this.freeAccessUserIds].join(', '),
      );
    }
  }

  async hasActiveSubscription(userId: string): Promise<boolean> {
    if (!this.config.get('SUBSCRIPTIONS_ENABLED', { infer: true }))
      return false;
    const { data } = await this.supabase.admin
      .from('subscriptions')
      .select('id, plan, status')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return !!data;
  }

  /** True when this user is on the FREE_ACCESS_USER_IDS list. */
  hasFreeAccess(userId: string): boolean {
    return this.freeAccessUserIds.has(userId);
  }

  async effectiveRank(userId: string, appPlanTier: PlanTier): Promise<number> {
    // Highest rank, so a tester is never stopped by a gate partway through a
    // journey they are meant to be walking end to end. It grants access; it
    // does not create a subscription, a payment, or an invoice — billing still
    // sees these users as having paid nothing, which is what makes it safe to
    // switch off and then test billing properly.
    if (this.hasFreeAccess(userId)) return PLAN_RANK.expert;

    const appRank = PLAN_RANK[appPlanTier] ?? 0;
    const subRank = (await this.hasActiveSubscription(userId))
      ? SUB_PLAN_RANK
      : 0;
    return Math.max(appRank, subRank);
  }
}
