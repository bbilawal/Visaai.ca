import { Global, Module } from '@nestjs/common';
import { UserProfileRepository } from './user-profile.repository';

/**
 * ARCH-005: @Global so the handful of consumers (visa, me, reminders) inject the
 * repository without importing another module — matching SupabaseModule,
 * AuthModule and EventBusModule, which are @Global for the same reason.
 */
@Global()
@Module({
  providers: [UserProfileRepository],
  exports: [UserProfileRepository],
})
export class UserProfileModule {}
