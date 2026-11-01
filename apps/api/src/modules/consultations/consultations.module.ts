import { Module } from '@nestjs/common';
import { ConsultationsController } from './consultations.controller';
import { ConsultationsService } from './consultations.service';
import { CONSULTATIONS_REPOSITORY } from './consultations.repository';
import { ConsultationsRepository } from './consultations.repository.impl';

/**
 * Consultation scheduling (Task 9 / Phase 10). SupabaseService is @Global and
 * JwtGuard's dependencies resolve from global scope, mirroring MarketplaceModule.
 */
@Module({
  controllers: [ConsultationsController],
  providers: [
    ConsultationsService,
    { provide: CONSULTATIONS_REPOSITORY, useClass: ConsultationsRepository },
  ],
  exports: [ConsultationsService],
})
export class ConsultationsModule {}
