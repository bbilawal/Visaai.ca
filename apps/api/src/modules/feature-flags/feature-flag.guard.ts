import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/jwt.guard';
import { FeatureFlagsService } from './feature-flags.service';

export const REQUIRED_FLAG_KEY = 'requiredFeatureFlag';

/**
 * Gate a route on a feature flag.
 *
 *   @UseGuards(JwtGuard, FeatureFlagGuard)
 *   @RequireFlag('payments_enabled')
 *   @Post('checkout') ...
 *
 * Order matters: this guard reads `req.user` to evaluate cohort/role/percentage
 * targeting, so it must run AFTER JwtGuard. On an unauthenticated route it
 * still works — it evaluates with an empty subject, which means a partial
 * rollout does not apply (see FeatureFlagsService.decide).
 */
export const RequireFlag = (key: string) => SetMetadata(REQUIRED_FLAG_KEY, key);

/**
 * Refuses the request with **503 + `feature_disabled`** when the flag is off.
 *
 * 503 rather than 404: the route exists and the client's request was
 * well-formed — the capability is administratively unavailable and may come
 * back. That distinction is what lets a client show "payments are temporarily
 * paused" instead of "this page is gone", and it keeps a kill switch from
 * looking like a deploy that deleted an endpoint. `Retry-After` is deliberately
 * omitted: nobody can honestly predict when an operator will flip it back.
 */
@Injectable()
export class FeatureFlagGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly flags: FeatureFlagsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const key = this.reflector.getAllAndOverride<string>(REQUIRED_FLAG_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // No @RequireFlag on this route → nothing to enforce.
    if (!key) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user as AuthUser | undefined;

    const subject = user?.id
      ? await this.flags.subjectFor({ id: user.id, appRole: user.appRole })
      : {};

    if (await this.flags.isEnabled(key, subject)) return true;

    throw new ServiceUnavailableException({
      statusCode: 503,
      code: 'feature_disabled',
      flag: key,
      message: 'This feature is temporarily unavailable.',
    });
  }
}
