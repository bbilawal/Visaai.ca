import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Permission, Role, RoleKey, UserAccess } from '@visaai/types';
import { IAM_REPOSITORY, type IIamRepository } from './iam.repository';
import { canRemoveAdmin } from '../admin/user-admin-guards';

const PLATFORM_ADMIN_ROLES: RoleKey[] = ['platform_admin', 'super_admin'];

/**
 * RolesService — the 6-role RBAC catalog + per-user role grants. Resolves a
 * caller's effective access (role keys + permission union) consumed by
 * PermissionsGuard. Authorization of grant/revoke is enforced at the controller
 * (@RequirePermission('iam.roles.manage')); the service records the audit event.
 */
@Injectable()
export class RolesService {
  private readonly log = new Logger(RolesService.name);

  constructor(@Inject(IAM_REPOSITORY) private readonly repo: IIamRepository) {}

  listRoles(): Promise<Role[]> {
    return this.repo.listRoles();
  }

  listPermissions(): Promise<Permission[]> {
    return this.repo.listPermissions();
  }

  async getAccess(userId: string): Promise<UserAccess> {
    const { roles, permissions } = await this.repo.getUserAccess(userId);
    return { user_id: userId, roles, permissions };
  }

  async grant(
    actorId: string,
    targetUserId: string,
    roleKey: RoleKey,
    organizationId: string | null = null,
  ): Promise<{ granted: true; role: RoleKey }> {
    const role = await this.repo.getRoleByKey(roleKey);
    if (!role) throw new NotFoundException(`Unknown role: ${roleKey}`);

    await this.repo.grantRole({
      userId: targetUserId,
      roleId: role.id,
      organizationId,
      grantedBy: actorId,
    });
    await this.repo.recordAuthEvent({
      userId: targetUserId,
      actorId,
      eventType: 'role_granted',
      metadata: { role: roleKey, organization_id: organizationId },
    });
    this.log.log(
      `role ${roleKey} granted to ${targetUserId} by ${actorId} (org=${organizationId ?? '-'})`,
    );
    return { granted: true, role: roleKey };
  }

  async revoke(
    actorId: string,
    targetUserId: string,
    roleKey: RoleKey,
    organizationId: string | null = null,
  ): Promise<{ revoked: true; role: RoleKey }> {
    // Block revoking a platform-admin role if it would orphan the platform
    // (no remaining platform admins) or demote the actor themselves.
    if (organizationId === null && PLATFORM_ADMIN_ROLES.includes(roleKey)) {
      const adminCount = await this.repo.countPlatformAdmins();
      const decision = canRemoveAdmin({
        actorId,
        targetId: targetUserId,
        targetIsAdmin: true,
        adminCount,
      });
      if (!decision.allowed) throw new ForbiddenException(decision.reason);
    }
    const ok = await this.repo.revokeRole(
      targetUserId,
      roleKey,
      organizationId,
    );
    if (!ok) throw new NotFoundException('Role grant not found');
    await this.repo.recordAuthEvent({
      userId: targetUserId,
      actorId,
      eventType: 'role_revoked',
      metadata: { role: roleKey, organization_id: organizationId },
    });
    this.log.log(`role ${roleKey} revoked from ${targetUserId} by ${actorId}`);
    return { revoked: true, role: roleKey };
  }
}
