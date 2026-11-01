import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { REMINDER_QUEUE } from '../shared/queue/queue.constants';
import { RemindersService } from './reminders.service';

@Injectable()
@Processor(REMINDER_QUEUE)
export class RemindersProcessor extends WorkerHost {
  private readonly log = new Logger(RemindersProcessor.name);

  constructor(private readonly reminders: RemindersService) {
    super();
  }

  async process(): Promise<void> {
    const sent = await this.reminders.runScan();
    this.log.log(`Processed reminder job — ${sent} sent`);
  }
}
