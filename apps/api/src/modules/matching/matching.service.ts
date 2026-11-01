import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ConsultantMatch, MatchRequest } from '@visaai/types';
import { rankCandidates } from './matching.engine';
import {
  MATCHING_REPOSITORY,
  type IMatchingRepository,
} from './matching.repository';

export interface MatchCaller {
  id: string;
  appRole?: 'admin' | 'consultant' | 'user';
}

export interface MatchResult {
  request: MatchRequest;
  candidates: ConsultantMatch[];
}

/**
 * MatchingService — ranks consultant candidates for an application (M3).
 * PROPOSES ONLY: never creates/changes a consultant_assignments row. Auto-routing
 * (optional, future) would take candidates[0] and call AssignmentService.
 */
@Injectable()
export class MatchingService {
  constructor(
    @Inject(MATCHING_REPOSITORY)
    private readonly repo: IMatchingRepository,
  ) {}

  async rank(
    applicationId: string,
    caller: MatchCaller,
    limit = 10,
  ): Promise<MatchResult> {
    const ctx = await this.repo.getMatchContext(applicationId);
    if (!ctx) throw new NotFoundException('application not found');

    // Staff (admin/consultant) may match any application; applicants only their own.
    const isStaff =
      caller.appRole === 'admin' || caller.appRole === 'consultant';
    if (!isStaff && ctx.ownerUserId !== caller.id) {
      throw new ForbiddenException('not your application');
    }

    const [candidates, lawyerFlag] = await Promise.all([
      this.repo.listActiveCandidates(),
      this.repo.getVisaLawyerFlag(ctx.request.visa_type),
    ]);

    const ranked = rankCandidates(candidates, ctx.request, { lawyerFlag });
    return {
      request: ctx.request,
      candidates: ranked.slice(0, Math.max(1, limit)),
    };
  }
}
