import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import webpush from 'web-push';
import type { Env } from '../../../config/configuration';

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushResult = 'ok' | 'gone' | 'error';

/**
 * Thin web-push (VAPID) wrapper. Never throws. Returns 'gone' on 404/410 so the
 * caller prunes the dead subscription. No-ops (warn) when VAPID env is unset,
 * mirroring EmailService when POSTMARK is unset.
 */
@Injectable()
export class WebPushService {
  private readonly log = new Logger(WebPushService.name);
  private readonly configured: boolean;

  constructor(config: ConfigService<Env>) {
    const pub = config.get('VAPID_PUBLIC_KEY', { infer: true });
    const priv = config.get('VAPID_PRIVATE_KEY', { infer: true });
    const subject =
      config.get('VAPID_SUBJECT', { infer: true }) ??
      'mailto:no-reply@visaai.co';
    if (pub && priv) {
      webpush.setVapidDetails(subject, pub, priv);
      this.configured = true;
    } else {
      this.configured = false;
    }
  }

  async send(target: PushTarget, payload: object): Promise<PushResult> {
    if (!this.configured) {
      this.log.warn('VAPID keys not set — push skipped');
      return 'error';
    }
    try {
      await webpush.sendNotification(
        {
          endpoint: target.endpoint,
          keys: { p256dh: target.p256dh, auth: target.auth },
        },
        JSON.stringify(payload),
      );
      return 'ok';
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) return 'gone';
      this.log.error(`web push failed: ${(err as Error).message}`);
      return 'error';
    }
  }
}
