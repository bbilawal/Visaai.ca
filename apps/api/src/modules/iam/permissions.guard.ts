import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../auth/jwt.guard';
import { hasPermission } from './iam.engine';
import { RolesService } from './roles.service';

export const REQUIRED_PERMISSION_KEY = 'requiredPermission';

/** Require a fine-grained permission (from the RBAC catalog) on a handler. */
export const RequirePermission = (permission: string) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);

/**
 * PermissionsGuard — fine-grained RBAC. Runs AFTER JwtGuard (needs req.user).
 * Resolves the caller's permission union from user_roles and checks the required
 * permission. Platform admins (legacy appRole='admin', i.e. platform_admin/
 * super_admin) bypass — mirrors RolesGuard's admin override and keeps the legacy
 * signed claim authoritative. Fails closed.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly roles: RolesService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string>(
      REQUIRED_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true; // no @RequirePermission → open

    const request = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = request.user;
    if (!user?.id) throw new ForbiddenException('User not authenticated');
    if (user.appRole === 'admin') return true; // platform admin override

    const access = await this.roles.getAccess(user.id);
    if (!hasPermission(access.permissions, required)) {
      throw new ForbiddenException(`Requires permission: ${required}`);
    }
    return true;
  }
}
