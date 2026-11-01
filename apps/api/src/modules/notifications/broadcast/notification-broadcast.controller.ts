import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../../auth/jwt.guard';
import type { AuthUser } from '../../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../../auth/roles.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { NotificationBroadcastService } from './notification-broadcast.service';
import {
  BroadcastInputDto,
  BroadcastListQueryDto,
} from './notification-broadcast.dto';

/**
 * Admin broadcast announcements. Class-gated (JwtGuard resolves appRole;
 * RolesGuard + @RequireRole enforce platform admin). Every broadcast is
 * recorded (created_by) — an audit trail for a platform-wide send.
 */
@Controller('admin/broadcasts')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class NotificationBroadcastController {
  constructor(private readonly broadcasts: NotificationBroadcastService) {}

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = BroadcastInputDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.broadcasts.create(parsed.data, user.id);
  }

  @Get()
  list(@Query() query: unknown) {
    const parsed = BroadcastListQueryDto.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.broadcasts.list(
      parsed.data.cursor ?? null,
      parsed.data.limit ?? 25,
    );
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.broadcasts.get(id);
  }
}
