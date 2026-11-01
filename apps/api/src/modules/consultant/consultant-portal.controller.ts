import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { ConsultantDashboard, ConsultantQueueResult } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { ConsultantApprovalService } from './consultant-approval.service';
import { AssignmentService } from './assignment.service';
import { computeDashboard } from './dashboard';

/**
 * Consultant portal read API. Consultant-only. Country-scoped: returns the
 * eligible UNASSIGNED queue (destination_country ∈ the consultant's active
 * country map) plus the applications actively assigned to this consultant.
 */
@Controller('consultant')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('consultant')
export class ConsultantPortalController {
  constructor(
    private readonly consultant: ConsultantApprovalService,
    private readonly assignment: AssignmentService,
  ) {}

  /** Legacy: only applications actively assigned to this consultant. */
  @Get('assigned')
  assigned(@CurrentUser() user: AuthUser) {
    return this.consultant.listAssignedApplications(user.id);
  }

  /** Country-scoped portal: { queue (eligible unassigned), mine (assigned) }. */
  @Get('applications')
  applications(@CurrentUser() user: AuthUser): Promise<ConsultantQueueResult> {
    return this.assignment.getConsultantQueue(user.id);
  }

  /** Phase 1 dashboard aggregate: case counts + SLA buckets for this consultant. */
  @Get('dashboard')
  async dashboard(@CurrentUser() user: AuthUser): Promise<ConsultantDashboard> {
    const queue = await this.assignment.getConsultantQueue(user.id);
    return computeDashboard(queue, new Date());
  }

  /**
   * Mark my assigned application's review complete — stops the SLA clock so it
   * is not swept back to the queue. Must be an active assignee.
   */
  @Post('applications/:id/complete')
  complete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ): Promise<{ completed_at: string }> {
    return this.assignment.markComplete(id, user.id);
  }
}
