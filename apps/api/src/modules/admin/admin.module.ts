import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminDashboardService } from './admin-dashboard.service';
import { AdminUsersService } from './admin-users.service';
import { RegistryOpsService } from './registry-ops.service';
import { ConsultantModule } from '../consultant/consultant.module';

/**
 * Admin API. SupabaseService is @Global. Imports ConsultantModule for the
 * AssignmentService (admin assign/reassign/unassign of applications).
 */
@Module({
  imports: [ConsultantModule],
  controllers: [AdminController],
  providers: [
    AdminService,
    AdminDashboardService,
    AdminUsersService,
    RegistryOpsService,
  ],
})
export class AdminModule {}
