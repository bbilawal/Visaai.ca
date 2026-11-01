import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';
import { DiscoveryService } from './discovery.service';
import { MARKETPLACE_REPOSITORY } from './marketplace.repository';
import { MarketplaceRepository } from './marketplace.repository.impl';
import { MarketplaceAdminController } from './marketplace-admin.controller';
import { MarketplaceAdminService } from './marketplace-admin.service';

/**
 * MarketplaceModule — public marketplace core (Phase 2/5): consultant self-serve
 * profile/skills/availability, public discovery, and reviews. SupabaseService is
 * @Global; JwtGuard's deps resolve from global scope (no AuthModule import
 * needed, mirroring MessagingModule). Concrete repository bound to its token.
 *
 * DiscoveryController is registered before ProfileController so the two distinct
 * prefixes (marketplace/consultants vs marketplace/profile) never contend.
 */
@Module({
  controllers: [
    // Admin first: 'admin/marketplace/consultants' must not be shadowed by the
    // public 'marketplace/consultants/:id' pattern.
    MarketplaceAdminController,
    DiscoveryController,
    ProfileController,
  ],
  providers: [
    ProfileService,
    DiscoveryService,
    MarketplaceAdminService,
    { provide: MARKETPLACE_REPOSITORY, useClass: MarketplaceRepository },
  ],
  exports: [ProfileService, DiscoveryService],
})
export class MarketplaceModule {}
