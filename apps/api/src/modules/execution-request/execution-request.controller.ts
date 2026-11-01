import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type {
  ExecutionRequestDecision,
  ExecutionRequestInput,
} from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthUser } from '../auth/jwt.guard';
import { ExecutionRequestService } from './execution-request.service';
import { z } from 'zod';
import { PORTAL_FILL_OPS } from '@visaai/types';
import { parseBody } from '../../common/zod-body';

/** Mirrors PreflightMappingInput. */
export const MappingDto = z.object({
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
  op: z.enum(PORTAL_FILL_OPS).optional(),
  reveal: z.boolean().optional(),
  dialog: z.boolean().optional(),
  awaitOptions: z.boolean().optional(),
  declaration: z.boolean().optional(),
});

const RequestDto = z.object({
  applicationId: z.string().uuid(),
  preflightReviewId: z.string().uuid(),
  mappings: z.array(MappingDto),
  token: z.string().min(1),
  sessionId: z.string().min(1),
  userConfirmationFlag: z.boolean(),
});

/**
 * Phase 3F — the ONLY path by which an extension/UI may request execution.
 * Thin: delegates to ExecutionRequestService, which revalidates everything
 * server-side. The userId is taken from the authenticated session, never the
 * body. Returns a decision; never starts execution.
 */
@UseGuards(JwtGuard)
@Controller('execution')
export class ExecutionRequestController {
  constructor(private readonly executionRequest: ExecutionRequestService) {}

  @Post('request')
  request(
    @Body() rawBody: unknown,
    @CurrentUser() user: AuthUser,
  ): Promise<ExecutionRequestDecision> {
    const body = parseBody(RequestDto, rawBody);
    const input: ExecutionRequestInput = {
      applicationId: body.applicationId,
      preflightReviewId: body.preflightReviewId,
      mappings: body.mappings,
      token: body.token,
      sessionId: body.sessionId,
      userId: user.id,
      userConfirmationFlag: body.userConfirmationFlag,
    };
    return this.executionRequest.request(input);
  }
}
