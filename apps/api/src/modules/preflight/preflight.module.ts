import { Module } from '@nestjs/common';
import { PreflightService } from './preflight.service';
import { PreflightMappingService } from './preflight-mapping.service';
import { PrefillFormStore } from './prefill-form.store';
import { PreflightFieldEditService } from './preflight-field-edit.service';
import { PreflightController } from './preflight.controller';
import { PREFLIGHT_REPOSITORY } from './preflight.repository';
import { PreflightRepository } from './preflight.repository.impl';
import { ProvenanceModule } from '../provenance/provenance.module';
import { VerificationModule } from '../verification/verification.module';
import { ConsultantModule } from '../consultant/consultant.module';

/**
 * PreflightModule — concrete repository bound; imports Provenance (source
 * value hashes + provenance-change detection), Verification (drift), and
 * Consultant (stale approvals + active assignment + reassignment). AuditService
 * via @Global AuditModule.
 */
@Module({
  imports: [ProvenanceModule, VerificationModule, ConsultantModule],
  controllers: [PreflightController],
  providers: [
    PreflightService,
    PreflightMappingService,
    PrefillFormStore,
    PreflightFieldEditService,
    { provide: PREFLIGHT_REPOSITORY, useClass: PreflightRepository },
  ],
  exports: [
    PreflightService,
    PreflightMappingService,
    PreflightFieldEditService,
  ],
})
export class PreflightModule {}
