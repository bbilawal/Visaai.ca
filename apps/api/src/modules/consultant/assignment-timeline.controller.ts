import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import type { AssignmentTimelineEvent } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AssignmentTimelineService } from './assignment-timeline.service';

/**
 * Read-only assignment lifecycle timeline. Any authenticated user may call;
 * the service authorizes (admin | owner | active assignee) and returns the
 * normalized, chronologically-ordered audit events for the application.
 */
@Controller('applications/:applicationId')
@UseGuards(JwtGuard)
export class AssignmentTimelineController {
  constructor(private readonly timeline: AssignmentTimelineService) {}

  @Get('assignment-timeline')
  get(
    @Param('applicationId') applicationId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<AssignmentTimelineEvent[]> {
    return this.timeline.getTimeline(applicationId, {
      id: user.id,
      appRole: user.appRole,
    });
  }
}
