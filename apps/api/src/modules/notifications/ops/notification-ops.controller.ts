import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../../auth/roles.guard';
import { NotificationOpsService } from './notification-ops.service';

/**
 * Admin operations view over notification delivery. Class-gated (JwtGuard
 * resolves appRole; RolesGuard + @RequireRole enforce platform admin — now
 * honored at the class level). Read-only metrics/failed + a guarded retry.
 */
@Controller('admin/notification-ops')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class NotificationOpsController {
  constructor(private readonly ops: NotificationOpsService) {}

  @Get('metrics')
  metrics(@Query('range') range?: string) {
    return this.ops.metrics(NotificationOpsService.coerceRange(range));
  }

  @Get('failed')
  failed(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const lim = limit ? Number(limit) : 25;
    return this.ops.failed(cursor ?? null, Number.isFinite(lim) ? lim : 25);
  }

  @Post('deliveries/:id/retry')
  retry(@Param('id') id: string) {
    return this.ops.retry(id);
  }
}
