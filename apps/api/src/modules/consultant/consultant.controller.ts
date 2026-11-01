import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type {
  ConsultantApprovalScope,
  ConsultantApprovalRollup,
  ConsultantApproval,
  ConsultantAssignment,
  ConsultantReviewData,
  ValueHash,
} from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import { OwnerOrAdminGuard } from '../auth/owner-or-admin.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.guard';
import { ConsultantApprovalService } from './consultant-approval.service';
import { AssignmentService } from './assignment.service';
import { ConsultantReviewService } from './consultant-review.service';
import { AiReviewAssistantService } from './ai-review-assistant.service';

// Request DTOs (plain shapes; the service performs all validation).
interface AssignBody {
  consultantId: string;
}
interface ValueHashBody {
  valueHash: ValueHash;
}
interface ReasonBody {
  reason: string;
}
interface OptionalReasonBody {
  reason?: string;
}
interface RevokeBody {
  scope: ConsultantApprovalScope;
  fieldKey?: string;
  section?: string;
  reason: string;
}

/**
 * Phase 3C — Consultant API exposure layer.
 *
 * THIN orchestration only: every handler delegates straight to
 * ConsultantApprovalService. No business logic, no verification/readiness/drift
 * evaluation, no preflight/eligibility interaction, no audit emission (the
 * service owns audit). Decision endpoints act as the authenticated consultant
 * (user.id); assignment is service-authorized via assertAssigned downstream.
 */
@UseGuards(JwtGuard)
@Controller('applications/:applicationId/consultant')
export class ConsultantController {
  constructor(
    private readonly consultant: ConsultantApprovalService,
    private readonly assignment: AssignmentService,
    private readonly review: ConsultantReviewService,
    private readonly aiReview: AiReviewAssistantService,
  ) {}

  // ---- review data (assigned consultant or admin) ----
  @Get('review')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  getReview(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantReviewData> {
    return this.review.getReview(applicationId, {
      id: user.id,
      appRole: user.appRole,
    });
  }

  // ---- AI review assistant (Phase 9: advisory only; assigned consultant or admin) ----
  @Get('ai-review')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  getAiReview(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.aiReview.getReview(applicationId, {
      id: user.id,
      appRole: user.appRole,
    });
  }

  // ---- A0. self-assign (consultant claims an eligible UNASSIGNED app) ----
  @Post('self-assign')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  selfAssign(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantAssignment> {
    return this.assignment.selfAssign(applicationId, user.id);
  }

  // ---- A. assignment (owner or admin ONLY) ----
  @Post('assignments')
  @UseGuards(JwtGuard, OwnerOrAdminGuard)
  assign(
    @Param('applicationId') applicationId: string,
    @Body() body: AssignBody,
  ): Promise<ConsultantAssignment> {
    return this.consultant.assign(applicationId, body.consultantId);
  }

  @Post('reassign')
  @UseGuards(JwtGuard, OwnerOrAdminGuard)
  reassign(
    @Param('applicationId') applicationId: string,
    @Body() body: AssignBody,
  ): Promise<ConsultantAssignment> {
    return this.consultant.reassign(applicationId, body.consultantId);
  }

  @Get('assignment')
  @UseGuards(JwtGuard, ApplicationAccessGuard)
  getAssignment(
    @Param('applicationId') applicationId: string,
  ): Promise<ConsultantAssignment | null> {
    return this.consultant.getAssignment(applicationId);
  }

  @Get('assignments')
  @UseGuards(JwtGuard, ApplicationAccessGuard)
  getAssignmentHistory(
    @Param('applicationId') applicationId: string,
  ): Promise<ConsultantAssignment[]> {
    return this.consultant.getAssignmentHistory(applicationId);
  }

  // ---- B. decisions (consultant role + assigned; act as the authenticated consultant) ----
  @Post('fields/:fieldKey/review')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  reviewField(
    @Param('applicationId') applicationId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: ValueHashBody,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.reviewField(
      applicationId,
      user.id,
      fieldKey,
      body.valueHash,
    );
  }

  @Post('fields/:fieldKey/approve')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  approveField(
    @Param('applicationId') applicationId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: ValueHashBody,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.approveField(
      applicationId,
      user.id,
      fieldKey,
      body.valueHash,
    );
  }

  @Post('fields/:fieldKey/reject')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  rejectField(
    @Param('applicationId') applicationId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: ReasonBody,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.rejectField(
      applicationId,
      user.id,
      fieldKey,
      body.reason,
    );
  }

  /**
   * Mark a field 'not applicable': excluded from auto-fill, does NOT block it
   * (reject does). Reason optional.
   */
  @Post('fields/:fieldKey/not-applicable')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  markFieldNotApplicable(
    @Param('applicationId') applicationId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() body: OptionalReasonBody,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.markFieldNotApplicable(
      applicationId,
      user.id,
      fieldKey,
      typeof body?.reason === 'string' ? body.reason : undefined,
    );
  }

  // ---- B2. application-level decisions (consultant role + assigned) ----
  @Post('approve')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  approveApplication(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.approveApplication(applicationId, user.id);
  }

  @Post('reject')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  rejectApplication(
    @Param('applicationId') applicationId: string,
    @Body() body: ReasonBody,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.rejectApplication(
      applicationId,
      user.id,
      body.reason,
    );
  }

  @Post('revoke')
  @UseGuards(JwtGuard, RolesGuard)
  @RequireRole('consultant')
  revoke(
    @Param('applicationId') applicationId: string,
    @Body() body: RevokeBody,
    @CurrentUser() user: AuthUser,
  ): Promise<ConsultantApproval> {
    return this.consultant.revoke(
      applicationId,
      user.id,
      { scope: body.scope, fieldKey: body.fieldKey, section: body.section },
      body.reason,
    );
  }

  // ---- read-only rollup passthrough ----
  @Get('approval')
  @UseGuards(JwtGuard, ApplicationAccessGuard)
  getApplicationApproval(
    @Param('applicationId') applicationId: string,
  ): Promise<ConsultantApprovalRollup> {
    return this.consultant.getApplicationApproval(applicationId);
  }
}
