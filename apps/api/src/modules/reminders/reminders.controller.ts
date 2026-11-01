import { Controller, Get, Param, Res } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { unsubToken, resolveUnsubSecret } from './unsub';
import type { Env } from '../../config/configuration';
import { UserProfileRepository } from '../shared/users/user-profile.repository';

@Controller('reminders')
export class RemindersController {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env>,
    private readonly users: UserProfileRepository,
  ) {}

  @Get('unsubscribe/:userId/:token')
  async unsubscribe(
    @Param('userId') userId: string,
    @Param('token') token: string,
    @Res() res: Response,
  ) {
    const expected = unsubToken(userId, resolveUnsubSecret(this.config));
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(400).send('Invalid unsubscribe link');
      return;
    }
    await this.users.disableEmailReminders(userId);
    res.status(200).send('You have been unsubscribed from reminder emails.');
  }
}
