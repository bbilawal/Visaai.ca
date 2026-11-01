import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { Env } from '../../../config/configuration';

/**
 * Provider-agnostic transactional email over SMTP (nodemailer). Works with any
 * SMTP provider (Resend, Brevo, SES, ...) configured via SMTP_* env. Never
 * throws; returns false when unconfigured or on failure — callers (reminders,
 * P3b notifications) treat false as "skipped".
 */
@Injectable()
export class EmailService {
  private readonly log = new Logger(EmailService.name);
  private readonly transport: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService<Env>) {
    const host = config.get('SMTP_HOST', { infer: true });
    const port = config.get('SMTP_PORT', { infer: true }) ?? 587;
    const user = config.get('SMTP_USER', { infer: true });
    const pass = config.get('SMTP_PASS', { infer: true });
    this.from =
      config.get('SMTP_FROM', { infer: true }) ?? 'no-reply@visaai.co';
    if (host && user && pass) {
      this.transport = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
    } else {
      this.transport = null;
    }
  }

  /** Returns true if sent, false if skipped/failed. Never throws. */
  async send(
    to: string,
    subject: string,
    htmlBody: string,
    attachments?: { filename: string; content: Buffer }[],
  ): Promise<boolean> {
    if (!this.transport) {
      this.log.warn('SMTP not configured — email skipped');
      return false;
    }
    try {
      await this.transport.sendMail({
        from: this.from,
        to,
        subject,
        html: htmlBody,
        ...(attachments?.length ? { attachments } : {}),
      });
      return true;
    } catch (err) {
      this.log.error(`Email send failed: ${(err as Error).message}`);
      return false;
    }
  }
}
