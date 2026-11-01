import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import type { AuthUser } from './jwt.guard';

export const REQUIRE_MFA_KEY = 'requireMfa';

/**
 * Require a second factor (aal2) on a handler/controller — step-up auth for
 * sensitive actions (e.g. role grants, payouts, destructive ops). Opt-in: routes
 * without @RequireMfa are unaffected, so this is additive/non-breaking.
 */
export const RequireMfa = () => SetMetadata(REQUIRE_MFA_KEY, true);

/**
 * MfaGuard — enforces that the caller's session reached aal2 (a TOTP factor was
 * satisfied this session). Runs AFTER JwtGuard (reads req.user.aal). A user with
 * MFA enrolled but only aal1 this session is rejected with a 403 carrying a
 * `mfa_required` code so the client can prompt for step-up. Fails closed.
 */
@Injectable()
export class MfaGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<Env>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_MFA_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // no @RequireMfa → open

    // SEC-1004: enforcement is opt-in via MFA_ENFORCE_ADMIN so that wiring the
    // guard onto admin mutations cannot lock out an admin who has not yet
    // enrolled a second factor. Until the operator confirms enrollment and sets
    // the flag, @RequireMfa is inert (the route stays reachable at aal1).
    const enforce = this.config.get('MFA_ENFORCE_ADMIN', { infer: true });
    if (!enforce) return true;

    const user = context.switchToHttp().getRequest<{ user?: AuthUser }>().user;
    if (!user?.id) throw new ForbiddenException('User not authenticated');
    if (user.aal === 'aal2') return true;

    throw new ForbiddenException({
      code: 'mfa_required',
      message: 'This action requires two-factor authentication.',
    });
  }
}
