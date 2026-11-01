import { Controller, Get, Param, Res } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { unsubToken, resolveUnsubSecret } from '../reminders/unsub';
import { NotificationPreferenceService } from './notification-preference.service';
import type { Env } from '../../config/configuration';

/**
 * Public (unguarded) one-click email unsubscribe. Verifies the HMAC token
 * (same scheme as reminders) and disables the message-email preference for that
 * one user via the service-role client. Mirrors RemindersController.
 */
@Controller('notifications')
export class NotificationsUnsubscribeController {
  constructor(
    private readonly prefs: NotificationPreferenceService,
    private readonly config: ConfigService<Env>,
  ) {}

  @Get('unsubscribe/:userId/:token')
  async unsubscribe(
    @Param('userId') userId: string,
    @Param('token') token: string,
    @Res() res: Response,
  ): Promise<void> {
    const secret = resolveUnsubSecret(this.config);
    const expected = unsubToken(userId, secret);
    const a = Buffer.from(token);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      res.status(400).send('Invalid unsubscribe link');
      return;
    }
    await this.prefs.disableEmailByUser(userId);
    res.status(200).send('You have been unsubscribed from message emails.');
  }
}
