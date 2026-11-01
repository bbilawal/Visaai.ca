import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NotificationsService } from '../../notifications/notifications.service';
import type { ReportNotifier } from './report-delivery.ports';

/**
 * Bridges report delivery to the notifications spine. Reuses the generic
 * `system.broadcast` event (title/body/link/category) so no new event type or
 * template is needed — NotificationsService.emit handles delivery-record
 * creation, preferences, and the in-app feed.
 */
@Injectable()
export class SpineReportNotifier implements ReportNotifier {
  private readonly log = new Logger(SpineReportNotifier.name);
  constructor(private readonly notifications: NotificationsService) {}

  async notify(input: {
    userIds: string[];
    title: string;
    body: string;
    link: string;
  }): Promise<void> {
    for (const userId of input.userIds) {
      try {
        await this.notifications.emit({
          type: 'system.broadcast',
          userId,
          broadcastId: randomUUID(),
          data: {
            title: input.title,
            body: input.body,
            link: input.link,
            category: 'system',
          },
        });
      } catch (e) {
        this.log.warn(
          `report notify failed for ${userId}: ${(e as Error).message}`,
        );
      }
    }
  }
}
