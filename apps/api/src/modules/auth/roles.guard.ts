import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from './jwt.guard';

export type AppRole = 'admin' | 'consultant' | 'user';

export const REQUIRED_ROLES_KEY = 'requiredRoles';
/** Restrict a handler to the given app roles. `admin` always passes. */
export const RequireRole = (...roles: AppRole[]) =>
  SetMetadata(REQUIRED_ROLES_KEY, roles);

/**
 * RBAC guard — authorizes STRICTLY on `req.user.appRole` (the tamper-proof
 * app_metadata role). It never reads `AuthUser.role`. Must run after JwtGuard.
 * Fails closed: a missing/undefined appRole is rejected.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // Read from BOTH the handler and the class — `@RequireRole` is applied at the
    // CLASS level on admin controllers, which `reflector.get(getHandler())` alone
    // would miss (falling open). getAllAndOverride merges/overrides handler>class.
    const required = this.reflector.getAllAndOverride<AppRole[]>(
      REQUIRED_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true; // no @RequireRole → open

    const user = context.switchToHttp().getRequest().user as
      | AuthUser
      | undefined;
    if (!user?.id) throw new ForbiddenException('User not authenticated');

    // Defensive: appRole must be present (JwtGuard always sets it). Absence is a
    // misconfiguration / bypass attempt → deny.
    if (!user.appRole) throw new ForbiddenException('Missing role claim');

    if (user.appRole === 'admin') return true; // admin override
    if (required.includes(user.appRole)) return true;

    throw new ForbiddenException(`Requires role: ${required.join(' or ')}`);
  }
}
