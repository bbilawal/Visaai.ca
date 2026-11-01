import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  DevicePushTokenRecord,
  NotificationFeedPage,
  NotificationPreferences,
  PushSubscriptionRecord,
} from '@visaai/types';
import { JwtGuard } from '../auth/jwt.guard';
import type { AuthUser } from '../auth/jwt.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { DeviceTokenService } from './device-token.service';
import { PushSubscriptionService } from './push-subscription.service';
import { NotificationPreferenceService } from './notification-preference.service';
import type { NotificationPreferencePatch } from './notification-preference.repository';
import { NotificationFeedService } from './notification-feed.service';

function bearer(authHeader: string | undefined): string {
  if (!authHeader?.startsWith('Bearer '))
    throw new BadRequestException('Missing authorization token');
  return authHeader.slice(7);
}

/** Clamp the ?limit query param to [1..50], default 20. */
function clampLimit(raw: string | undefined): number {
  if (raw === undefined) return 20;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? Math.max(1, Math.min(50, n)) : 20;
}

@Controller('notifications')
@UseGuards(JwtGuard)
export class NotificationsController {
  constructor(
    private readonly push: PushSubscriptionService,
    private readonly devices: DeviceTokenService,
    private readonly prefs: NotificationPreferenceService,
    private readonly feed: NotificationFeedService,
  ) {}

  // ── Native device push (iOS/Android) ───────────────────────────────────
  // Web Push registers an endpoint + ECDH keys above; a mobile device presents
  // a single opaque APNs/FCM token, so it gets its own pair of routes rather
  // than nullable columns on push_subscriptions.

  @Post('devices')
  registerDevice(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      token?: string;
      platform?: string;
      deviceName?: string;
      appVersion?: string;
    },
    @Headers('authorization') auth?: string,
  ): Promise<DevicePushTokenRecord> {
    if (!body?.token || !body?.platform) {
      throw new BadRequestException('token and platform are required');
    }
    if (body.platform !== 'ios' && body.platform !== 'android') {
      throw new BadRequestException("platform must be 'ios' or 'android'");
    }
    return this.devices.register(bearer(auth), user, {
      token: body.token,
      platform: body.platform,
      deviceName: body.deviceName ?? null,
      appVersion: body.appVersion ?? null,
    });
  }

  @Delete('devices')
  async unregisterDevice(
    @CurrentUser() user: AuthUser,
    @Body() body: { token?: string },
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    if (!body?.token) throw new BadRequestException('token is required');
    await this.devices.unregister(bearer(auth), user, body.token);
    return { ok: true };
  }

  @Post('push/subscribe')
  subscribe(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      endpoint?: string;
      p256dh?: string;
      auth?: string;
      userAgent?: string;
    },
    @Headers('authorization') auth?: string,
  ): Promise<PushSubscriptionRecord> {
    if (!body?.endpoint || !body?.p256dh || !body?.auth) {
      throw new BadRequestException('endpoint, p256dh and auth are required');
    }
    return this.push.subscribe(bearer(auth), user, {
      endpoint: body.endpoint,
      p256dh: body.p256dh,
      auth: body.auth,
      userAgent: body.userAgent ?? null,
    });
  }

  @Delete('push/subscribe')
  async unsubscribe(
    @CurrentUser() user: AuthUser,
    @Body() body: { endpoint?: string },
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    if (!body?.endpoint) throw new BadRequestException('endpoint is required');
    await this.push.unsubscribe(bearer(auth), user, body.endpoint);
    return { ok: true };
  }

  @Get('preferences')
  getPreferences(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<NotificationPreferences> {
    return this.prefs.get(bearer(auth), user);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      email_enabled?: boolean;
      push_enabled?: boolean;
      sms_enabled?: boolean;
      categories?: unknown;
      quiet_hours_start?: unknown;
      quiet_hours_end?: unknown;
      timezone?: unknown;
      language?: unknown;
    },
    @Headers('authorization') auth?: string,
  ): Promise<NotificationPreferences> {
    const patch: NotificationPreferencePatch = {};
    if (typeof body?.email_enabled === 'boolean')
      patch.email_enabled = body.email_enabled;
    if (typeof body?.push_enabled === 'boolean')
      patch.push_enabled = body.push_enabled;
    if (typeof body?.sms_enabled === 'boolean')
      patch.sms_enabled = body.sms_enabled;

    if (body?.categories !== undefined) {
      const c = body.categories;
      if (
        c === null ||
        typeof c !== 'object' ||
        Array.isArray(c) ||
        Object.values(c).some((v) => typeof v !== 'boolean')
      ) {
        throw new BadRequestException(
          'categories must be an object of booleans',
        );
      }
      patch.categories = c as Record<string, boolean>;
    }

    const hour = (v: unknown, name: string): number | null => {
      if (v === null) return null;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 23) {
        throw new BadRequestException(
          `${name} must be an integer 0..23 or null`,
        );
      }
      return v;
    };
    if (body?.quiet_hours_start !== undefined)
      patch.quiet_hours_start = hour(
        body.quiet_hours_start,
        'quiet_hours_start',
      );
    if (body?.quiet_hours_end !== undefined)
      patch.quiet_hours_end = hour(body.quiet_hours_end, 'quiet_hours_end');
    if (body?.timezone !== undefined) {
      if (body.timezone !== null && typeof body.timezone !== 'string')
        throw new BadRequestException('timezone must be a string or null');
      patch.timezone = body.timezone;
    }
    if (body?.language !== undefined) {
      if (body.language !== null && typeof body.language !== 'string')
        throw new BadRequestException('language must be a string or null');
      patch.language = body.language;
    }

    if (Object.keys(patch).length === 0)
      throw new BadRequestException('No preference fields to update');
    return this.prefs.update(bearer(auth), user, patch);
  }

  // ── Feed routes ─────────────────────────────────────────────────────────────
  // Static paths are declared before param routes to guarantee correct matching.

  /** GET /notifications/unread-count → { unread: number } */
  @Get('unread-count')
  async getUnreadCount(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<{ unread: number }> {
    const unread = await this.feed.unreadCount(bearer(auth), user.id);
    return { unread };
  }

  /** POST /notifications/read-all — mark every unread notification as read. */
  @Post('read-all')
  markAllRead(
    @CurrentUser() user: AuthUser,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    return this.feed.markAllRead(bearer(auth), user.id);
  }

  /**
   * GET /notifications?cursor=<ISO>&limit=<1..50>
   *
   * Returns a cursor-paginated feed page for the caller.  `cursor` is the
   * `createdAt` of the last item on the previous page (keyset pagination).
   */
  @Get()
  listFeed(
    @CurrentUser() user: AuthUser,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
    @Headers('authorization') auth?: string,
  ): Promise<NotificationFeedPage> {
    return this.feed.list(
      bearer(auth),
      user.id,
      cursor ?? null,
      clampLimit(limit),
    );
  }

  /** POST /notifications/:id/read — mark a single notification as read. */
  @Post(':id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Headers('authorization') auth?: string,
  ): Promise<{ ok: true }> {
    return this.feed.markRead(bearer(auth), user.id, id);
  }
}
