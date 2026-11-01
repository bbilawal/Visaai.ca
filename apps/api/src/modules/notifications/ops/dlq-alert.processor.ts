import { Injectable, Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { NOTIFICATION_DLQ_ALERT_QUEUE } from '../../shared/queue/queue.constants';
import { NotificationOpsService } from './notification-ops.service';

/** Hourly tick: run the dead-letter threshold check (see DlqAlertScheduler). */
@Injectable()
@Processor(NOTIFICATION_DLQ_ALERT_QUEUE)
export class DlqAlertProcessor extends WorkerHost {
  private readonly log = new Logger(DlqAlertProcessor.name);

  constructor(private readonly ops: NotificationOpsService) {
    super();
  }

  async process(): Promise<void> {
    const { alerted, dead } = await this.ops.checkDlqThreshold();
    if (alerted)
      this.log.warn(`DLQ alert emitted — ${dead} dead deliveries in 24h`);
  }
}
