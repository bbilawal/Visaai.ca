import { Module } from '@nestjs/common';
import { CommissionController } from './commission.controller';
import { CommissionService } from './commission.service';
import { COMMISSION_REPOSITORY } from './commission.repository';
import { CommissionRepository } from './commission.repository.impl';

/**
 * CommissionModule — marketplace revenue-split authority (consultant-marketplace
 * M2 / COM-1..4). SupabaseService is @Global; auth guards resolve from global
 * scope (no AuthModule import, mirroring MarketplaceModule). Exports
 * CommissionService so billing (service-order checkout) and payouts can call
 * splitFor.
 */
@Module({
  controllers: [CommissionController],
  providers: [
    CommissionService,
    { provide: COMMISSION_REPOSITORY, useClass: CommissionRepository },
  ],
  exports: [CommissionService],
})
export class CommissionModule {}
