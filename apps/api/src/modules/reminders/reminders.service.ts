import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../shared/supabase/supabase.service';
import { ProgressService } from '../progress/progress.service';
import { EmailService } from '../shared/email/email.service';
import { renderReminderEmail } from '../../i18n/email/render';
import { reminderKindFor } from './cadence';
import { unsubToken, resolveUnsubSecret } from './unsub';
import type { Env } from '../../config/configuration';

const DAY_MS = 24 * 60 * 60 * 1000;

interface ActivityRow {
  application_id: string;
  user_id: string;
  last_active_at: string;
}

@Injectable()
export class RemindersService {
  private readonly log = new Logger(RemindersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly progress: ProgressService,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env>,
  ) {}

  /** Scan stalled applications and send due reminders. Returns count sent. */
  async runScan(now = new Date()): Promise<number> {
    const db = this.supabase.admin;
    const webUrl =
      (this.config.get('WEB_URL', { infer: true }) as string) ??
      'http://localhost:3000';
    const apiUrl =
      (this.config.get('API_URL', { infer: true }) as string) ??
      'http://localhost:4000';
    const secret = resolveUnsubSecret(this.config);

    const threeDaysAgo = new Date(now.getTime() - 3 * DAY_MS).toISOString();
    const { data: rows, error } = await db
      .from('application_activity')
      .select('application_id, user_id, last_active_at')
      .lt('last_active_at', threeDaysAgo);
    if (error) {
      this.log.error(`Reminder scan: activity query failed — ${error.message}`);
      return 0;
    }
    if (!rows?.length) return 0;

    let sent = 0;
    for (const row of rows as ActivityRow[]) {
      const stalledDays = Math.floor(
        (now.getTime() - new Date(row.last_active_at).getTime()) / DAY_MS,
      );
      const kind = reminderKindFor(stalledDays);
      if (!kind) continue;

      const { data: app } = await db
        .from('applications')
        .select('status, destination_country')
        .eq('id', row.application_id)
        .maybeSingle<{ status: string; destination_country: string | null }>();
      if (!app || app.status === 'submitted' || app.status === 'decided')
        continue;

      const { data: user } = await db
        .from('users')
        .select('email, email_reminders, preferred_language')
        .eq('id', row.user_id)
        .maybeSingle<{
          email: string | null;
          email_reminders: boolean | null;
          preferred_language: string | null;
        }>();
      if (!user?.email || user.email_reminders === false) continue;

      const { data: already } = await db
        .from('reminder_log')
        .select('id')
        .eq('application_id', row.application_id)
        .eq('kind', kind)
        .maybeSingle();
      if (already) continue;

      // Background job (no request context): use the service-role client.
      const progress = await this.progress.forApplication(
        this.supabase.admin,
        row.application_id,
        row.user_id,
      );
      if (!progress || progress.overallPct >= 100) continue;

      const href = `${webUrl}${progress.nextAction.href}`;
      const unsubUrl = `${apiUrl}/reminders/unsubscribe/${row.user_id}/${unsubToken(row.user_id, secret)}`;
      const { subject, html } = renderReminderEmail(user.preferred_language, {
        country: app.destination_country,
        stage: progress.nextAction.stage,
        href,
        unsubUrl,
      });
      const ok = await this.email.send(user.email, subject, html);
      if (!ok) continue;

      await db.from('reminder_log').insert({
        application_id: row.application_id,
        user_id: row.user_id,
        stage: progress.currentStage,
        kind,
      });
      sent++;
    }

    this.log.log(`Reminder scan complete — ${sent} sent`);
    return sent;
  }
}
