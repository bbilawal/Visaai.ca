import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  EntitlementService,
  PLAN_RANK,
} from '../entitlement/entitlement.service';
import type { AuthUser } from './jwt.guard';
import type { PlanTier } from '@visaai/types';

export const REQUIRED_PLAN_KEY = 'requiredPlan';
export const RequirePlan = (plan: PlanTier) =>
  SetMetadata(REQUIRED_PLAN_KEY, plan);

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private supabase: SupabaseService,
    private entitlement: EntitlementService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPlan = this.reflector.get<PlanTier>(
      REQUIRED_PLAN_KEY,
      context.getHandler(),
    );
    if (!requiredPlan) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;
    if (!user?.id) throw new ForbiddenException('User not authenticated');

    const applicationId =
      request.params.applicationId || request.body.applicationId;
    if (!applicationId) throw new ForbiddenException('Application ID required');

    let app: { plan_tier: string } | null = null;
    try {
      const { data } = await this.supabase.admin
        .from('applications')
        .select('plan_tier, user_id')
        .eq('id', applicationId)
        .eq('user_id', user.id)
        .single();
      app = data;
    } catch {
      throw new ForbiddenException('Unable to verify plan status');
    }

    if (!app)
      throw new ForbiddenException('Application not found or access denied');

    const userRank = await this.entitlement.effectiveRank(
      user.id,
      app.plan_tier as PlanTier,
    );
    const requiredRank = PLAN_RANK[requiredPlan];

    if (userRank < requiredRank) {
      throw new ForbiddenException(
        `Plan '${requiredPlan}' required for this feature`,
      );
    }

    return true;
  }
}
