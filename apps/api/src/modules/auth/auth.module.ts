import { Module } from '@nestjs/common';
import { JwtGuard } from './jwt.guard';
import { PlanGuard } from './plan.guard';

@Module({
  providers: [JwtGuard, PlanGuard],
  exports: [JwtGuard, PlanGuard],
})
export class AuthModule {}
