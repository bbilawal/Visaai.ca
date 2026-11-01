import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RolesService } from './roles.service';
import { PermissionsGuard, RequirePermission } from './permissions.guard';
import { MfaGuard, RequireMfa } from '../auth/mfa.guard';
import { GrantRoleDto } from './iam.dto';

/**
 * IAM API — RBAC catalog + per-user role grants. Catalog is readable by any
 * authenticated user; grant/revoke require the `iam.roles.manage` permission
 * (platform_admin/super_admin), and reading another user's access requires
 * `iam.users.read`.
 */
@Controller('iam')
@UseGuards(JwtGuard, PermissionsGuard, MfaGuard)
export class IamController {
  constructor(private readonly roles: RolesService) {}

  @Get('roles')
  listRoles() {
    return this.roles.listRoles();
  }

  @Get('permissions')
  listPermissions() {
    return this.roles.listPermissions();
  }

  /** The caller's own effective access (roles + permissions). */
  @Get('access')
  myAccess(@CurrentUser() user: AuthUser) {
    return this.roles.getAccess(user.id);
  }

  @Get('users/:id/access')
  @RequirePermission('iam.users.read')
  userAccess(@Param('id') id: string) {
    return this.roles.getAccess(id);
  }

  // SEC-1004: step-up MFA on privileged role grants (enforced only when
  // MFA_ENFORCE_ADMIN=true; inert otherwise so it cannot lock out admins).
  @RequireMfa()
  @Post('users/:id/roles')
  @RequirePermission('iam.roles.manage')
  grant(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() actor: AuthUser,
  ) {
    const parsed = GrantRoleDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.roles.grant(
      actor.id,
      id,
      parsed.data.roleKey,
      parsed.data.organizationId ?? null,
    );
  }

  @RequireMfa()
  @Delete('users/:id/roles/:roleKey')
  @RequirePermission('iam.roles.manage')
  revoke(
    @Param('id') id: string,
    @Param('roleKey') roleKey: string,
    @CurrentUser() actor: AuthUser,
  ) {
    const parsed = GrantRoleDto.shape.roleKey.safeParse(roleKey);
    if (!parsed.success) throw new BadRequestException('Invalid role key');
    return this.roles.revoke(actor.id, id, parsed.data, null);
  }
}
