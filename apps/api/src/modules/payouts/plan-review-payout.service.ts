import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { CommissionService } from '../commission/commission.service';
// Constants file, NOT billing.service — BillingModule imports PayoutsModule, so
// importing the service back here is a cycle that breaks Nest's DI metadata.
import { PLAN_PRICES } from '../billing/plan-prices';

/**
 * Credits the consultant who performs an Expert-plan review.
 *
 * The `expert` plan sells "Licensed Consultant Review", but that purchase writes
 * only a `payments` row and `applications.plan_tier` — it creates no marketplace
 * order, so the consultant who did the work was never credited and the payout
 * sweep (which reads `consultant_service_orders`) never saw it.
 *
 * This closes that gap: when an assigned consultant submits an application-scope
 * decision on an Expert-plan application, we record a `paid` service order for
 * the work. No Stripe charge is attached — the applicant already paid for the
 * plan — so it is flagged `credit_covered`, exactly like the subscription-credit
 * path. The sweep then transfers the consultant's share like any other order.
 *
 * The gross is the full plan price, split by the normal commission rule.
 *
 * NOTE ON IDS — two different id spaces share the name `consultant_id`:
 *   consultant_assignments.consultant_id  -> users(id)
 *   consultant_service_orders.consultant_id -> consultant_profiles(id)
 * The decision path hands us the USER id, so it must be mapped through
 * `consultant_profiles.user_id`. A consultant with no marketplace profile
 * cannot be credited; that is logged and skipped rather than thrown, because a
 * missing profile must never fail the consultant's decision.
 */
@Injectable()
export class PlanReviewPayoutService {
  private readonly log = new Logger(PlanReviewPayoutService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly commission: CommissionService,
  ) {}

  /**
   * Record the consultant as owed for an Expert-plan review. Best-effort and
   * idempotent: never throws, and a second decision on the same application
   * does not create a second order.
   */
  async creditExpertReview(
    applicationId: string,
    consultantUserId: string,
  ): Promise<{ recorded: boolean; reason?: string }> {
    try {
      const { data: app } = await this.supabase.admin
        .from('applications')
        .select('id, user_id, plan_tier, framework_id, destination_country')
        .eq('id', applicationId)
        .maybeSingle();
      if (!app) return { recorded: false, reason: 'application_not_found' };
      if (app.plan_tier !== 'expert') {
        return { recorded: false, reason: 'not_expert_plan' };
      }

      const { data: profile } = await this.supabase.admin
        .from('consultant_profiles')
        .select('id')
        .eq('user_id', consultantUserId)
        .maybeSingle();
      if (!profile) {
        this.log.warn(
          `consultant user ${consultantUserId} decided on expert application ${applicationId} but has no consultant_profiles row — cannot credit the review`,
        );
        return { recorded: false, reason: 'no_consultant_profile' };
      }
      const consultantProfileId = String(profile.id);

      // Idempotency: one plan-covered review order per application+consultant.
      const { data: existing } = await this.supabase.admin
        .from('consultant_service_orders')
        .select('id')
        .eq('application_id', applicationId)
        .eq('consultant_id', consultantProfileId)
        .eq('service_type', 'premium_review')
        .eq('credit_covered', true)
        .maybeSingle();
      if (existing) return { recorded: false, reason: 'already_credited' };

      // Corridor drives rule resolution, same as service-order checkout.
      let country = (app.destination_country as string | null) ?? null;
      let visa: string | null = null;
      if (app.framework_id) {
        const { data: fw } = await this.supabase.admin
          .from('country_frameworks')
          .select('visa_type, country_code')
          .eq('id', app.framework_id as string)
          .maybeSingle();
        if (fw) {
          visa = fw.visa_type as string;
          country = fw.country_code as string;
        }
      }

      const grossUsd = PLAN_PRICES.expert.amount / 100;
      const split = await this.commission.splitFor({
        gross: grossUsd,
        country,
        visa,
        consultantId: consultantProfileId,
      });

      const { error } = await this.supabase.admin
        .from('consultant_service_orders')
        .insert({
          user_id: app.user_id,
          consultant_id: consultantProfileId,
          application_id: applicationId,
          service_type: 'premium_review',
          currency: 'usd',
          amount_usd: split.gross_usd,
          platform_fee_usd: split.platform_fee_usd,
          consultant_payout_usd: split.consultant_payout_usd,
          commission_rule_id: split.rule_id,
          status: 'paid',
          paid_at: new Date().toISOString(),
          // No Stripe charge of its own — the plan purchase already collected.
          credit_covered: true,
        });
      if (error) throw error;

      this.log.log(
        `credited expert review: application ${applicationId} consultant ${consultantProfileId} owed ${split.consultant_payout_usd} usd of ${split.gross_usd}`,
      );
      return { recorded: true };
    } catch (err) {
      // A consultant's decision must never fail because crediting failed.
      this.log.error(
        `could not credit expert review for application ${applicationId}: ${(err as Error).message}`,
      );
      return { recorded: false, reason: 'error' };
    }
  }
}
