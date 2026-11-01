import { Global, Module } from '@nestjs/common';
import { FeatureFlagsController } from './feature-flags.controller';
import { FeatureFlagsAdminController } from './feature-flags.admin.controller';
import { FeatureFlagsService } from './feature-flags.service';
import { FeatureFlagsAdminService } from './feature-flags.admin.service';
import { FeatureFlagGuard } from './feature-flag.guard';
import { IamModule } from '../iam/iam.module';

/**
 * `@Global` for the same reason the audit and event-bus modules are: a kill
 * switch is only useful if any module can consult it without the module graph
 * having to be rewired first, and `@RequireFlag` on a route in an unrelated
 * module must resolve `FeatureFlagGuard` without that module importing this one.
 *
 * The cache lives in the singleton service, so global registration also means
 * one cache per process rather than one per importing module.
 */
@Global()
@Module({
  // PermissionsGuard on the admin controller resolves the caller's permission
  // union via RolesService, which IamModule exports (same wiring as PartnerModule).
  imports: [IamModule],
  controllers: [FeatureFlagsController, FeatureFlagsAdminController],
  providers: [FeatureFlagsService, FeatureFlagsAdminService, FeatureFlagGuard],
  exports: [FeatureFlagsService, FeatureFlagGuard],
})
export class FeatureFlagsModule {}
