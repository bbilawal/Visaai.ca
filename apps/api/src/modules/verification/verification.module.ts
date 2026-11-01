import { Module } from '@nestjs/common';
import { VerificationService } from './verification.service';
import { VERIFICATION_REPOSITORY } from './verification.repository';
import { VerificationRepository } from './verification.repository.impl';
import { ProvenanceModule } from '../provenance/provenance.module';

/**
 * VerificationModule — Phase 2C: concrete repository bound; imports
 * ProvenanceModule (ProvenanceService dep). AuditService via @Global AuditModule.
 * Service logic remains a skeleton.
 */
@Module({
  imports: [ProvenanceModule],
  providers: [
    VerificationService,
    { provide: VERIFICATION_REPOSITORY, useClass: VerificationRepository },
  ],
  exports: [VerificationService],
})
export class VerificationModule {}
