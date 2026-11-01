import { Module } from '@nestjs/common';
import { ExecutionRequestService } from './execution-request.service';
import { ExecutionRequestController } from './execution-request.controller';
import { EligibilityModule } from '../eligibility/eligibility.module';
import { PreflightModule } from '../preflight/preflight.module';
import { ExecutionModule } from '../execution/execution.module';

/**
 * ExecutionRequestModule — Phase 3F readback-confirm step. Imports Eligibility
 * (revalidation snapshot), Preflight (current lock), and Execution (readback
 * token signer). Emits READBACK_CONFIRMED + EXECUTION_REQUESTED and mints the
 * bound readback token; never starts execution (that is ExecutionService only).
 */
@Module({
  imports: [EligibilityModule, PreflightModule, ExecutionModule],
  controllers: [ExecutionRequestController],
  providers: [ExecutionRequestService],
})
export class ExecutionRequestModule {}
