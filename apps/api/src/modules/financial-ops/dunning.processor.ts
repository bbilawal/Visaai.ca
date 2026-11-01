import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { DUNNING_QUEUE } from '../shared/queue/queue.constants';
import { DunningService } from './dunning.service';

@Injectable()
@Processor(DUNNING_QUEUE)
export class DunningProcessor extends WorkerHost {
  private readonly log = new Logger(DunningProcessor.name);

  constructor(private readonly dunning: DunningService) {
    super();
  }

  async process(): Promise<void> {
    const r = await this.dunning.runDailyCycle();
    this.log.log(
      `dunning cycle — ${r.escalated} escalated / ${r.canceled} canceled`,
    );
  }
}
