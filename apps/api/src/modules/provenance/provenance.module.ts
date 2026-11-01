import { Module } from '@nestjs/common';
import { ProvenanceService } from './provenance.service';
import { PROVENANCE_REPOSITORY } from './provenance.repository';
import { ProvenanceRepository } from './provenance.repository.impl';

/**
 * ProvenanceModule — Phase 2C: concrete Supabase repository bound.
 * AuditService is injected via the @Global AuditModule. Service logic remains
 * a skeleton (Phase 2B); only persistence + DI wiring land here.
 */
@Module({
  providers: [
    ProvenanceService,
    { provide: PROVENANCE_REPOSITORY, useClass: ProvenanceRepository },
  ],
  exports: [ProvenanceService],
})
export class ProvenanceModule {}
