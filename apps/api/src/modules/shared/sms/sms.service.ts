import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../../config/configuration';

export type SmsResult = 'ok' | 'error' | 'unconfigured';

/** Single-segment SMS length; longer bodies are truncated with an ellipsis. */
const MAX_SMS = 160;

/**
 * Thin Twilio SMS sender. NEVER throws; no-ops (warn) when TWILIO_* env is unset,
 * mirroring EmailService (SMTP) / WebPushService (VAPID). Uses the Twilio REST
 * API via `fetch` — no SDK dependency.
 */
@Injectable()
export class SmsService {
  private readonly log = new Logger(SmsService.name);
  private readonly sid?: string;
  private readonly token?: string;
  private readonly from?: string;

  constructor(config: ConfigService<Env>) {
    this.sid = config.get('TWILIO_ACCOUNT_SID', { infer: true });
    this.token = config.get('TWILIO_AUTH_TOKEN', { infer: true });
    this.from = config.get('TWILIO_FROM_NUMBER', { infer: true });
  }

  private get configured(): boolean {
    return Boolean(this.sid && this.token && this.from);
  }

  async send(toE164: string, body: string): Promise<SmsResult> {
    if (!this.configured) {
      this.log.warn('TWILIO_* not set — SMS skipped');
      return 'unconfigured';
    }
    // ASCII ellipsis keeps the message in the GSM-7 charset (160-char segment);
    // U+2026 would force UCS-2 and halve the segment size.
    const text =
      body.length > MAX_SMS ? `${body.slice(0, MAX_SMS - 3)}...` : body;
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${this.sid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${this.sid}:${this.token}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: toE164,
            From: this.from as string,
            Body: text,
          }).toString(),
        },
      );
      if (!res.ok) {
        this.log.error(`SMS send failed: HTTP ${res.status}`);
        return 'error';
      }
      return 'ok';
    } catch (e) {
      this.log.error(`SMS error: ${(e as Error).message}`);
      return 'error';
    }
  }
}
