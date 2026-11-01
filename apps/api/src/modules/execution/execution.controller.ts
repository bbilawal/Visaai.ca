import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { ExecutionResult } from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import { ExecutionService } from './execution.service';
import { z } from 'zod';
import { parseBody } from '../../common/zod-body';

const ExecuteDto = z.object({
  applicationId: z.string().uuid(),
  readbackToken: z.string().min(1),
});

interface ExecuteBody {
  applicationId: string;
  readbackToken: string;
}

/**
 * Phase 3G — the ONLY HTTP path to execution. Thin forwarder: it carries no
 * business logic; ExecutionService.execute() performs all revalidation. The
 * readback token (not a session token) is the sole execution credential, and it
 * is validated inside the choke point.
 */
@UseGuards(JwtGuard)
@Controller('execution')
export class ExecutionController {
  constructor(private readonly execution: ExecutionService) {}

  @Post('execute')
  execute(@Body() rawBody: unknown): Promise<ExecutionResult> {
    const body: ExecuteBody = parseBody(ExecuteDto, rawBody);
    return this.execution.execute(body.applicationId, body.readbackToken);
  }
}
