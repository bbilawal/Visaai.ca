import { Controller, Get, UseGuards } from '@nestjs/common';
import type { ApplicantApplicationView } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AssignmentService } from './assignment.service';

/**
 * Applicant portal read API. Any authenticated user; STRICTLY scoped to the
 * caller's own applications (user.id). Surfaces the derived assignment status
 * and the assigned consultant so the applicant sees who is handling their case.
 */
@Controller('applicant')
@UseGuards(JwtGuard)
export class ApplicantController {
  constructor(private readonly assignment: AssignmentService) {}

  @Get('applications')
  applications(
    @CurrentUser() user: AuthUser,
  ): Promise<ApplicantApplicationView[]> {
    return this.assignment.getApplicantView(user.id);
  }
}
