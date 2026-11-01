import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import {
  FeedbackController,
  FeedbackAdminController,
} from './feedback.controller';
import { FeedbackService } from './feedback.service';

/**
 * Beta feedback (Task 15 §6). SupabaseService resolves from @Global scope;
 * IamModule is imported because PermissionsGuard on the triage controller
 * resolves the caller's permission union via RolesService.
 */
@Module({
  imports: [IamModule],
  controllers: [FeedbackController, FeedbackAdminController],
  providers: [FeedbackService],
  exports: [FeedbackService],
})
export class FeedbackModule {}
