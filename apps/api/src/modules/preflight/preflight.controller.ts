import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import type {
  ActorRef,
  PortalFillCoverage,
  PreflightLockValidation,
  PreflightMappingInput,
  PreflightReview,
} from '@visaai/types';
import { ApplicationAccessGuard } from '../auth/application-access.guard';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { RequireRole, RolesGuard } from '../auth/roles.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { PreflightService } from './preflight.service';
import { PreflightMappingService } from './preflight-mapping.service';
import {
  PreflightFieldEditService,
  type FieldEditResult,
} from './preflight-field-edit.service';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

/** Mirrors PreflightMappingInput. */
const MappingDto = z.object({
  fieldKey: z.string().min(1),
  targetField: z.string().min(1),
  mappedValue: z.union([z.string(), z.number(), z.null()]),
  category: z.enum([
    'passport',
    'dates',
    'travel_history',
    'addresses',
    'employment',
  ]),
  // Part of the lock hash (page) and of the display (label): stripping them
  // made every client-presented mapping set differ from the server's.
  page: z.string().min(1).max(200).optional(),
  label: z.string().max(200).optional(),
  // Part of the lock hash (op / reveal / dialog) and the readback display
  // (declaration). Stripping them would turn a radio click into a value write.
  op: z
    .enum(['radio', 'check', 'select_text', 'dialog_open', 'dialog_save'])
    .optional(),
  reveal: z.boolean().optional(),
  dialog: z.boolean().optional(),
  declaration: z.boolean().optional(),
});

const StartDto = z.object({
  mappings: z.array(MappingDto),
  submissionSessionId: z.string().optional(),
});
const CheckDto = z.object({
  check: z.enum([
    'passport_reviewed',
    'dates_reviewed',
    'travel_history_reviewed',
    'addresses_reviewed',
    'employment_reviewed',
    'final_approval',
  ]),
  value: z.boolean(),
});
const MappingsDto = z.object({ mappings: z.array(MappingDto) });
const FieldEditDto = z.object({
  value: z.string().max(2000),
  reason: z.string().max(500).optional(),
});

/**
 * The audit trail's actor role must be the caller's real role. `AuthUser.appRole`
 * is resolved by JwtGuard from the JWT plus `user_roles`.
 */
function actorRole(user: AuthUser): ActorRef['role'] {
  if (user.appRole === 'admin') return 'admin';
  if (user.appRole === 'consultant') return 'consultant';
  return 'applicant';
}

/**
 * Phase 3D — Preflight API exposure layer.
 *
 * THIN orchestration only: every handler delegates straight to PreflightService.
 * No business logic, no state evaluation, no verification/consultant/eligibility
 * interaction, no audit emission (the service owns audit). The reviewer is the
 * authenticated user; the preflight lock remains the canonical execution anchor.
 */
// ApplicationAccessGuard, not JwtGuard alone: every repository method in this
// module runs on the service-role client (which bypasses RLS) keyed on the path
// parameter, so proving a caller is merely logged in authorized nothing. Before
// this, any authenticated user could open, tick and complete the pre-submission
// review of any application UUID — and the review's locked_diff_hash is the
// intended execution trust anchor for portal auto-submission.
@UseGuards(JwtGuard, ApplicationAccessGuard)
@Controller('applications/:applicationId/preflight')
export class PreflightController {
  constructor(
    private readonly preflight: PreflightService,
    private readonly mappings: PreflightMappingService,
    private readonly edits: PreflightFieldEditService,
  ) {}

  /**
   * The server-derived mappings for this application. Every later step
   * (start / complete / validate / execution request) sends back exactly what
   * this returns, which is what lets the consultant's lock and the applicant's
   * execution request agree on a hash without either holding the other's state.
   */
  @Get('mappings')
  getMappings(
    @Param('applicationId') applicationId: string,
  ): Promise<PreflightMappingInput[]> {
    return this.mappings.forApplication(applicationId);
  }

  /**
   * Page-by-page coverage of the portal: how many values the assistant enters
   * on each page and what it leaves for the applicant (declarations without
   * an answer, data VisaAI does not hold, parts it never fills). Read-only;
   * not part of the lock.
   */
  @Get('coverage')
  getCoverage(
    @Param('applicationId') applicationId: string,
  ): Promise<PortalFillCoverage | null> {
    return this.mappings.coverage(applicationId);
  }

  // ---- A. start: open the review + build the diff ----
  // Consultant-only (admin passes RolesGuard); the service also requires the
  // ACTIVE assignment. ApplicationAccessGuard alone admitted the applicant,
  // who could then retire the consultant's lock by starting a new review.
  @Post('start')
  @UseGuards(RolesGuard)
  @RequireRole('consultant')
  async start(
    @Param('applicationId') applicationId: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<{
    reviewId: string;
    status: string;
    diff: Awaited<ReturnType<PreflightService['assembleDiff']>>;
  }> {
    const body = parseBody(StartDto, rawBody);
    // Record who the reviewer ACTUALLY is. This was hardcoded to 'consultant',
    // so an applicant opening their own preflight was written into the audit
    // trail as a consultant review — the one record meant to show who checked.
    const reviewer: ActorRef = { id: user.id, role: actorRole(user) };
    const review = await this.preflight.start(
      applicationId,
      reviewer,
      body.submissionSessionId,
    );
    const diff = await this.preflight.assembleDiff(
      applicationId,
      body.mappings ?? [],
    );
    return { reviewId: review.id, status: review.status, diff };
  }

  // ---- B. record a check (6-check enforcement lives in the service) ----
  @Post('reviews/:reviewId/checks')
  @UseGuards(RolesGuard)
  @RequireRole('consultant')
  recordCheck(
    @Param('applicationId') applicationId: string,
    @Param('reviewId') reviewId: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<PreflightReview> {
    const body = parseBody(CheckDto, rawBody);
    return this.preflight.recordCheck(
      reviewId,
      body.check,
      body.value,
      applicationId,
      { id: user.id, role: actorRole(user) },
    );
  }

  // ---- C. completion (returns locked_diff_hash; validated by the service) ----
  @Post('reviews/:reviewId/complete')
  @UseGuards(RolesGuard)
  @RequireRole('consultant')
  complete(
    @Param('applicationId') applicationId: string,
    @Param('reviewId') reviewId: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<PreflightReview> {
    const body = parseBody(MappingsDto, rawBody);
    return this.preflight.complete(
      reviewId,
      body.mappings,
      { id: user.id, role: actorRole(user) },
      applicationId,
    );
  }

  // ---- D. lock validation (read-only; returns reasons, no mutation) ----
  @Post('reviews/:reviewId/validate')
  validate(
    @Param('applicationId') applicationId: string,
    @Param('reviewId') reviewId: string,
    @Body() rawBody: unknown,
  ): Promise<PreflightLockValidation> {
    const body = parseBody(MappingsDto, rawBody);
    return this.preflight.validateLock(reviewId, body.mappings, applicationId);
  }

  @Get('active')
  getActive(
    @Param('applicationId') applicationId: string,
  ): Promise<PreflightReview | null> {
    return this.preflight.getActive(applicationId);
  }

  /**
   * The consultant corrects a value under review. Persists to the saved form
   * (the auto-fill source) and/or field provenance, resets the covering check,
   * and is refused while the review is locked. Consultant-only (admin passes
   * RolesGuard); the service additionally requires the ACTIVE assignment —
   * ApplicationAccessGuard alone would also admit the applicant, who edits on
   * the Forms page instead.
   */
  @Put('fields/:fieldKey')
  @UseGuards(RolesGuard)
  @RequireRole('consultant')
  async editField(
    @Param('applicationId') applicationId: string,
    @Param('fieldKey') fieldKey: string,
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<FieldEditResult> {
    const body = parseBody(FieldEditDto, rawBody);
    return this.edits.editField(
      applicationId,
      { id: user.id, appRole: user.appRole },
      fieldKey,
      body.value,
      body.reason,
    );
  }
}
