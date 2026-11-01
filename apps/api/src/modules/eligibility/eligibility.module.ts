import { Module } from '@nestjs/common';
import { ExecutionEligibilityService } from './execution-eligibility.service';
import { PAYMENT_READ_MODEL, TOKEN_VALIDATOR } from './eligibility.repository';
import { PaymentReadModel } from './payment-read-model.adapter';
import { TokenValidator } from './token-validator.adapter';
import { ConsultantModule } from '../consultant/consultant.module';
import { PreflightModule } from '../preflight/preflight.module';

/**
 * EligibilityModule — final compliance gate. Imports Consultant (approval
 * validity) + Preflight (trust-anchor validation, which itself covers
 * verification drift + provenance). Payment + token ports are bound here.
 * AuditService via @Global AuditModule (EXECUTION_READY emission).
 */
@Module({
  imports: [ConsultantModule, PreflightModule],
  providers: [
    ExecutionEligibilityService,
    { provide: PAYMENT_READ_MODEL, useClass: PaymentReadModel },
    { provide: TOKEN_VALIDATOR, useClass: TokenValidator },
  ],
  // TOKEN_VALIDATOR is exported so session setup (AutomationService) mints the
  // execution token with the same key the gate validates it with.
  exports: [ExecutionEligibilityService, TOKEN_VALIDATOR],
})
export class EligibilityModule {}
