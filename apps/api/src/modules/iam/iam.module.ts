import { Module } from '@nestjs/common';
import { IamController } from './iam.controller';
import { OrganizationsController } from './organizations.controller';
import { ProfileController } from './profile.controller';
import { SecurityController } from './security.controller';
import { MfaController } from './mfa.controller';
import { RolesService } from './roles.service';
import { OrganizationsService } from './organizations.service';
import { ProfileService } from './profile.service';
import { SecurityService } from './security.service';
import { PermissionsGuard } from './permissions.guard';
import { IAM_REPOSITORY } from './iam.repository';
import { IamRepository } from './iam.repository.impl';

/**
 * Auth & User Management — IAM foundation (Phase A). 6-role RBAC catalog +
 * organizations/teams/invitations + expanded profile + security/audit
 * (login history, brute-force lockout). SupabaseService + auth guards resolve
 * from @Global scope (mirrors Marketplace/Commission/Matching/Payouts).
 * EmailService is @Global. Exports RolesService (PermissionsGuard consumer) +
 * SecurityService (auth event recorder for other modules).
 */
@Module({
  controllers: [
    IamController,
    OrganizationsController,
    ProfileController,
    SecurityController,
    MfaController,
  ],
  providers: [
    RolesService,
    OrganizationsService,
    ProfileService,
    SecurityService,
    PermissionsGuard,
    { provide: IAM_REPOSITORY, useClass: IamRepository },
  ],
  exports: [RolesService, SecurityService],
})
export class IamModule {}
