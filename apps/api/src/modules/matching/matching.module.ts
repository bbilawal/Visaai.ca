import { Module } from '@nestjs/common';
import { MatchingController } from './matching.controller';
import { MatchingService } from './matching.service';
import { MATCHING_REPOSITORY } from './matching.repository';
import { MatchingRepository } from './matching.repository.impl';

/**
 * MatchingService — consultant candidate ranking (M3). SupabaseService + auth
 * guards resolve from @Global scope (no AuthModule import, mirroring Marketplace/
 * Commission). Exports MatchingService for future auto-routing callers.
 */
@Module({
  controllers: [MatchingController],
  providers: [
    MatchingService,
    { provide: MATCHING_REPOSITORY, useClass: MatchingRepository },
  ],
  exports: [MatchingService],
})
export class MatchingModule {}
