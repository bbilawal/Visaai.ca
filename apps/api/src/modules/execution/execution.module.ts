import { Module } from '@nestjs/common';
import { ExecutionService } from './execution.service';
import { ExecutionController } from './execution.controller';
import { ReadbackTokenService } from './readback-token.service';
import { EXECUTION_TOKEN_STORE } from './execution-token.store';
import { ExecutionTokenStore } from './execution-token.store.impl';
import { PreflightModule } from '../preflight/preflight.module';
import { ConsultantModule } from '../consultant/consultant.module';
import { VerificationModule } from '../verification/verification.module';
import { EligibilityModule } from '../eligibility/eligibility.module';

/**
 * ExecutionModule — Phase 3G. Hosts the single execution choke point
 * (ExecutionService) + the readback-token signer. Imports every revalidation
 * source so execute() can recompute live. Exports ReadbackTokenService so the
 * readback-confirm step can mint bound tokens. AuditService via @Global.
 */
@Module({
  imports: [
    PreflightModule,
    ConsultantModule,
    VerificationModule,
    EligibilityModule,
  ],
  controllers: [ExecutionController],
  providers: [
    ExecutionService,
    ReadbackTokenService,
    { provide: EXECUTION_TOKEN_STORE, useClass: ExecutionTokenStore },
  ],
  exports: [ReadbackTokenService],
})
export class ExecutionModule {}
