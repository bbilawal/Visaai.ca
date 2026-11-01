import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { EmailService } from '../shared/email/email.service';
import { MessagingService } from '../messaging/messaging.service';
import { MessagingPresenceService } from '../messaging/messaging-presence.service';
import { unsubToken, resolveUnsubSecret } from '../reminders/unsub';
import { renderMessageNotificationEmail } from '../../i18n/email/render';
import {
  NOTIFICATION_PREFERENCE_REPOSITORY,
  type INotificationPreferenceRepository,
} from './notification-preference.repository';
import type { Env } from '../../config/configuration';

export interface NotificationEmailJob {
  conversationId: string;
  applicationId: string;
  recipientId: string;
}

/**
 * Body of the debounced/coalesced email job. Re-checks presence + unread + the
 * email preference at run time, so a burst that the recipient has since read (or
 * came online for, or opted out of) sends nothing. Never includes message text.
 */
@Injectable()
export class NotificationEmailService {
  private readonly log = new Logger(NotificationEmailService.name);

  constructor(
    private readonly presence: MessagingPresenceService,
    @Inject(NOTIFICATION_PREFERENCE_REPOSITORY)
    private readonly prefRepo: INotificationPreferenceRepository,
    private readonly messaging: MessagingService,
    private readonly email: EmailService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env>,
  ) {}

  async sendIfStillUnread(job: NotificationEmailJob): Promise<void> {
    if (this.presence.isOnline(job.recipientId)) return;

    const prefs = await this.prefRepo.getForUser(
      this.supabase.admin,
      job.recipientId,
    );
    if (!prefs.email_enabled) return;

    const unread = await this.messaging.unreadCountForRecipient(
      job.applicationId,
      job.recipientId,
    );
    if (unread <= 0) return;

    const db = this.supabase.admin;
    const { data: user } = await db
      .from('users')
      .select('email, preferred_language')
      .eq('id', job.recipientId)
      .maybeSingle<{
        email: string | null;
        preferred_language: string | null;
      }>();
    if (!user?.email) return;

    const { data: app } = await db
      .from('applications')
      .select('destination_country')
      .eq('id', job.applicationId)
      .maybeSingle<{ destination_country: string | null }>();

    const webUrl =
      (this.config.get('WEB_URL', { infer: true }) as string) ??
      'http://localhost:3000';
    const apiUrl =
      (this.config.get('API_URL', { infer: true }) as string) ??
      'http://localhost:4000';
    const secret = resolveUnsubSecret(this.config);

    const href = `${webUrl}/applications/${job.applicationId}/messages`;
    const unsubUrl = `${apiUrl}/notifications/unsubscribe/${job.recipientId}/${unsubToken(job.recipientId, secret)}`;
    const { subject, html } = renderMessageNotificationEmail(
      user.preferred_language,
      {
        count: unread,
        country: app?.destination_country ?? null,
        href,
        unsubUrl,
      },
    );
    const ok = await this.email.send(user.email, subject, html);
    if (!ok)
      this.log.warn(`notification email skipped/failed for ${job.recipientId}`);
  }
}
