import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { PartnerPrincipal, PartnerScope } from '@visaai/types';
import { PartnerAuthService } from './partner-auth.service';
import { PartnerErrors } from './partner-errors';
import { hasScope } from './partner-scopes';
import { PartnerUsageService } from './partner-usage.service';

/**
 * Declares the scope a route requires. A partner route with no
 * `@RequireScopes` is a bug, and the guard treats it as one: no declared
 * scope means no access, rather than open access.
 */
export const PARTNER_SCOPES_KEY = 'partnerScopes';
export const RequireScopes = (...scopes: PartnerScope[]) =>
  SetMetadata(PARTNER_SCOPES_KEY, scopes);

export interface PartnerRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  partner?: PartnerPrincipal;
  partnerRateLimit?: { limit: number; remaining: number; resetAt: string };
}

/** Injects the resolved principal into a handler. */
export const Partner = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PartnerPrincipal =>
    ctx.switchToHttp().getRequest<PartnerRequest>().partner as PartnerPrincipal,
);

/**
 * Authenticate → authorize → meter, in that order, for every partner request.
 *
 * Rate limiting runs INSIDE the guard rather than as a separate global
 * throttler because the bucket is the authenticated application, which does
 * not exist until authentication has happened. A per-IP throttler in front
 * would punish every partner sharing a cloud egress address.
 */
@Injectable()
export class PartnerAuthGuard implements CanActivate {
  constructor(
    private readonly auth: PartnerAuthService,
    private readonly usage: PartnerUsageService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PartnerRequest>();

    const presented = bearerToken(request.headers.authorization);
    if (!presented) throw PartnerErrors.missingCredential();

    const principal = await this.auth.authenticate(presented, request.ip ?? '');
    request.partner = principal;

    const required =
      this.reflector.getAllAndOverride<PartnerScope[]>(PARTNER_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    // Fail closed on an undeclared route. Forgetting the decorator must not
    // silently publish an endpoint to every credential on the platform.
    if (required.length === 0)
      throw PartnerErrors.insufficientScope('(undeclared)');

    for (const scope of required) {
      if (!hasScope(principal.scopes, scope)) {
        throw PartnerErrors.insufficientScope(scope);
      }
    }

    // Metering last: an unauthenticated or unauthorized request should not
    // consume the partner's quota.
    const decision = await this.usage.consume(principal);
    request.partnerRateLimit = decision.headers;
    if (!decision.allowed) {
      throw decision.exceededWindow === 'minute'
        ? PartnerErrors.rateLimited(decision.retryAfterSeconds)
        : PartnerErrors.quotaExceeded(
            decision.exceededWindow ?? 'request',
            decision.retryAfterSeconds,
          );
    }

    return true;
  }
}

function bearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  if (!value.startsWith('Bearer ')) return null;
  const token = value.slice(7).trim();
  return token.length > 0 ? token : null;
}
