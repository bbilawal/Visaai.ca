import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { TEMPLATE_SWEEP_QUEUE } from '../../shared/queue/queue.constants';
import { TemplateSweepService } from './sweep.service';

@Injectable()
@Processor(TEMPLATE_SWEEP_QUEUE)
export class TemplateSweepProcessor extends WorkerHost {
  private readonly log = new Logger(TemplateSweepProcessor.name);

  constructor(private readonly sweep: TemplateSweepService) {
    super();
  }

  async process(): Promise<void> {
    const results = await this.sweep.sweepAll();
    for (const r of results) {
      this.log.log(
        `${r.authority}: indexed=${r.indexed} known=${r.known} recorded=${r.recorded}` +
          (r.message ? ` — ${r.message}` : ''),
      );
    }
  }
}
