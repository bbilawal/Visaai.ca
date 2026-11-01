import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { TemplateHealthService } from './template-health.service';
import { TemplateRevisionStore } from './template-revision.store';
import { TemplateSweepService } from './sweep/sweep.service';

const RESOLUTIONS = ['acknowledged', 'added', 'ignored'] as const;
type Resolution = (typeof RESOLUTIONS)[number];

/**
 * Ops surface for the government-document caches: health, change history, and
 * the new-artifact review queue.
 *
 * Admin-only (JwtGuard resolves appRole, RolesGuard enforces 'admin'), matching
 * AdminController. These endpoints expose which government integrations are
 * broken and what changed under us — operational detail with no reason to be
 * visible to an applicant.
 */
@Controller('template-ops')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class TemplateOpsController {
  constructor(
    private readonly health: TemplateHealthService,
    private readonly revisions: TemplateRevisionStore,
    private readonly sweep: TemplateSweepService,
  ) {}

  /** Live health of both caches. Recomputed per call — it is a ~90-row scan. */
  @Get('health')
  async getHealth() {
    return this.health.check();
  }

  /** Change history. `?unreviewed=1` narrows to the review queue. */
  @Get('revisions')
  async getRevisions(@Query('unreviewed') unreviewed?: string) {
    return unreviewed === '1' || unreviewed === 'true'
      ? this.revisions.listUnreviewed()
      : this.revisions.listRecent();
  }

  @Post('revisions/:id/review')
  async reviewRevision(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    await this.revisions.markReviewed(id, user.id);
    return { ok: true };
  }

  /** Artifacts on a government index that our catalog does not carry. */
  @Get('findings')
  async getFindings(@Query('status') status?: string) {
    const statuses = status ? status.split(',') : undefined;
    return this.sweep.listFindings(statuses);
  }

  /**
   * Bulk resolve. The first sweep files a few hundred findings — every form the
   * authority publishes that we do not carry, most for routes we do not serve —
   * so clearing that backlog has to be one action, not one per row.
   *
   * Declared BEFORE the parameterised route below: Nest matches in declaration
   * order, and `findings/:id/resolve` would otherwise never see a conflict but
   * `findings/resolve` sitting after a `findings/:id` route is the classic way
   * a literal path gets swallowed by a parameter. Keeping the literal first is
   * the habit that prevents it.
   */
  @Post('findings/resolve')
  async resolveFindings(
    @CurrentUser() user: AuthUser,
    @Body() body: { ids?: string[]; status?: string; note?: string },
  ) {
    const status = body?.status;
    if (!status || !RESOLUTIONS.includes(status as Resolution)) {
      throw new BadRequestException(
        `status must be one of: ${RESOLUTIONS.join(', ')}`,
      );
    }
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      throw new BadRequestException('ids must be a non-empty array');
    }
    // Bounded so one call cannot become an unbounded UPDATE. 500 clears the
    // measured first-run backlog (~265) in a single request with room to spare.
    if (body.ids.length > 500) {
      throw new BadRequestException('ids: at most 500 per call');
    }
    const updated = await this.sweep.resolveFindings(
      body.ids,
      status as Resolution,
      user.id,
      body.note,
    );
    return { ok: true, updated };
  }

  /**
   * Resolve one finding. Note what this does NOT do: it never edits the
   * catalog. Marking a finding 'added' records that a human put it into the
   * strategy files through code review — the API cannot introduce a government
   * URL into an applicant's package on its own.
   */
  @Post('findings/:id/resolve')
  async resolveFinding(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: { status?: string; note?: string },
  ) {
    const status = body?.status;
    if (!status || !RESOLUTIONS.includes(status as Resolution)) {
      throw new BadRequestException(
        `status must be one of: ${RESOLUTIONS.join(', ')}`,
      );
    }
    await this.sweep.resolveFinding(
      id,
      status as Resolution,
      user.id,
      body.note,
    );
    return { ok: true };
  }
}
