import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NotificationsService } from '../notifications/notifications.service';
import type { AlertNotifier } from './alert-notifier.ports';

// Reuses the generic system.broadcast event (SP-C SpineReportNotifier pattern) — no new template.
@Injectable()
export class SpineAlertNotifier implements AlertNotifier {
  private readonly log = new Logger(SpineAlertNotifier.name);
  constructor(private readonly notifications: NotificationsService) {}
  async fire(input: {
    ruleId: string;
    title: string;
    message: string;
    userIds: string[];
  }): Promise<void> {
    for (const userId of input.userIds) {
      try {
        await this.notifications.emit({
          type: 'system.broadcast',
          userId,
          broadcastId: randomUUID(),
          data: {
            title: input.title,
            body: input.message,
            link: `/analytics/alerts/${input.ruleId}`,
            category: 'system',
          },
        });
      } catch (e) {
        this.log.warn(
          `alert notify failed for ${userId}: ${(e as Error).message}`,
        );
      }
    }
  }
}
