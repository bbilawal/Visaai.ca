import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { RolesGuard, RequireRole } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { NotificationTemplateService } from './notification-template.service';
import {
  TemplateInputDto,
  TemplateListQueryDto,
  TemplatePreviewDto,
} from './notification-template.dto';

/**
 * Admin-only management of notification templates. Every route inherits the
 * class guard stack (JwtGuard resolves appRole; RolesGuard + @RequireRole gate
 * to platform admins). The service uses the service-role client for writes.
 */
@Controller('admin/notification-templates')
@UseGuards(JwtGuard, RolesGuard)
@RequireRole('admin')
export class NotificationTemplatesController {
  constructor(private readonly templates: NotificationTemplateService) {}

  @Get()
  list(@Query() query: unknown) {
    const parsed = TemplateListQueryDto.safeParse(query ?? {});
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.templates.list({
      eventType: parsed.data.event_type,
      locale: parsed.data.locale,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.templates.get(id);
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: AuthUser) {
    const parsed = TemplateInputDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.templates.create(parsed.data, user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
  ) {
    const parsed = TemplateInputDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.templates.update(id, parsed.data, user.id);
  }

  @Post(':id/deactivate')
  deactivate(@Param('id') id: string) {
    return this.templates.deactivate(id);
  }

  @Post('preview')
  preview(@Body() body: unknown) {
    const parsed = TemplatePreviewDto.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    return this.templates.preview(
      { title: parsed.data.title, body: parsed.data.body },
      parsed.data.sampleVars,
    );
  }
}
