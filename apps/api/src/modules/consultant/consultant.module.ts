import { Module } from '@nestjs/common';
import { ConsultantApprovalService } from './consultant-approval.service';
import { AssignmentService } from './assignment.service';
import { AssignmentTimelineService } from './assignment-timeline.service';
import { ConsultantReviewService } from './consultant-review.service';
import { AiReviewAssistantService } from './ai-review-assistant.service';
import { ConsultantController } from './consultant.controller';
import { ConsultantPortalController } from './consultant-portal.controller';
import { ApplicantController } from './applicant.controller';
import { AssignmentTimelineController } from './assignment-timeline.controller';
import { CONSULTANT_REPOSITORY } from './consultant.repository';
import { ASSIGNMENT_REPOSITORY } from './assignment.repository';
import { ConsultantRepository } from './consultant.repository.impl';
import { ConsultantWriteClient } from './consultant-write-client';
import { ProvenanceModule } from '../provenance/provenance.module';
import { AiModule } from '../shared/ai/ai.module';
import { PlanReviewPayoutModule } from '../payouts/plan-review-payout.module';

/**
 * ConsultantModule — concrete repository bound; imports ProvenanceModule
 * (ProvenanceService supplies the current value_hash for approval-staleness
 * checks). AuditService via @Global AuditModule. Adds the country-scoped
 * AssignmentService (self/admin assign + visibility) and exposes it so the
 * AdminModule can drive admin assign/reassign/unassign.
 */
@Module({
  // PlanReviewPayoutModule (NOT PayoutsModule) supplies PlanReviewPayoutService,
  // so an application-scope decision on an Expert-plan application credits the
  // consultant without pulling the Stripe gateway and sweep queue into every
  // graph that boots the review path.
  imports: [ProvenanceModule, AiModule, PlanReviewPayoutModule],
  controllers: [
    ConsultantController,
    ConsultantPortalController,
    ApplicantController,
    AssignmentTimelineController,
  ],
  providers: [
    ConsultantApprovalService,
    AssignmentService,
    AssignmentTimelineService,
    ConsultantReviewService,
    AiReviewAssistantService,
    ConsultantWriteClient,
    { provide: CONSULTANT_REPOSITORY, useClass: ConsultantRepository },
    // Same concrete repository instance also satisfies IAssignmentRepository.
    { provide: ASSIGNMENT_REPOSITORY, useExisting: CONSULTANT_REPOSITORY },
  ],
  exports: [
    ConsultantApprovalService,
    AssignmentService,
    AssignmentTimelineService,
  ],
})
export class ConsultantModule {}
