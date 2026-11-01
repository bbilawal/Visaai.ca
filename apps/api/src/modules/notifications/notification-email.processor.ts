import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import type { Job } from 'bullmq';
import { NOTIFICATION_QUEUE } from '../shared/queue/queue.constants';
import {
  NotificationEmailService,
  type NotificationEmailJob,
} from './notification-email.service';

@Injectable()
@Processor(NOTIFICATION_QUEUE)
export class NotificationEmailProcessor extends WorkerHost {
  constructor(private readonly emails: NotificationEmailService) {
    super();
  }

  async process(job: Job<NotificationEmailJob>): Promise<void> {
    await this.emails.sendIfStillUnread(job.data);
  }
}
