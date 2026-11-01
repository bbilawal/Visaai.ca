import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { SubscriptionsService } from './subscriptions.service';
import {
  SubCancelBodyDto,
  SubChangeBodyDto,
  SubCheckoutBodyDto,
} from './subscriptions.dto';
import type { z } from 'zod';

/** Parse an untrusted body against a zod schema or fail with a 400. */
function parse<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) throw new BadRequestException(result.error.flatten());
  return result.data;
}

@Controller('subscriptions')
@UseGuards(JwtGuard)
export class SubscriptionsController {
  constructor(
    private readonly subs: SubscriptionsService,
    private readonly config: ConfigService<Env>,
  ) {}

  private assertEnabled(): void {
    if (!this.config.get('SUBSCRIPTIONS_ENABLED', { infer: true })) {
      throw new ForbiddenException('Subscriptions are not enabled');
    }
  }

  @Post('checkout')
  async checkout(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    this.assertEnabled();
    return this.subs.startCheckout(
      user.id,
      user.email,
      parse(SubCheckoutBodyDto, body),
    );
  }

  @Post('change')
  async change(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    this.assertEnabled();
    return this.subs.change(user.id, parse(SubChangeBodyDto, body));
  }

  @Post('pause')
  async pause(@CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.subs.pause(user.id);
  }

  @Post('resume')
  async resume(@CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.subs.resume(user.id);
  }

  @Post('cancel')
  async cancel(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    this.assertEnabled();
    const dto = parse(SubCancelBodyDto, body);
    return this.subs.cancel(user.id, dto.immediate ?? false);
  }

  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    this.assertEnabled();
    return this.subs.getMine(user.id);
  }
}
