import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { PLAN_CREDIT_CAP, type SubPlan } from './subscription.constants';

@Injectable()
export class SubscriptionCreditsService {
  private readonly log = new Logger(SubscriptionCreditsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // Grant the plan's cap for a period. Idempotent: ignore duplicate
  // (subscription_id, period_start) so a re-delivered invoice.paid does not
  // double-grant, and no rollover (a new period is a new row).
  async grantForPeriod(input: {
    subscriptionId: string;
    userId: string;
    plan: SubPlan;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<void> {
    const { error } = await this.supabase.admin
      .from('subscription_credits')
      .upsert(
        {
          subscription_id: input.subscriptionId,
          user_id: input.userId,
          period_start: input.periodStart.toISOString(),
          period_end: input.periodEnd.toISOString(),
          granted: PLAN_CREDIT_CAP[input.plan],
          consumed: 0,
        },
        { onConflict: 'subscription_id,period_start', ignoreDuplicates: true },
      );
    if (error) {
      throw new Error(
        (error as { message?: string }).message ?? 'credit grant failed',
      );
    }
  }

  // Atomic consume via the SECURITY DEFINER fn. Fail-closed: any error => no credit.
  async tryConsume(
    userId: string,
    applicationId: string | null,
  ): Promise<boolean> {
    const { data, error } = await this.supabase.admin.rpc(
      'consume_review_credit',
      {
        p_user_id: userId,
        p_application_id: applicationId,
      },
    );
    if (error) {
      this.log.warn(
        `consume_review_credit error — routing to paid: ${(error as { message?: string }).message}`,
      );
      return false;
    }
    return data === true;
  }
}
