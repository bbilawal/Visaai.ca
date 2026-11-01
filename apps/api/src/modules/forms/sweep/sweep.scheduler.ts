import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TEMPLATE_SWEEP_QUEUE } from '../../shared/queue/queue.constants';

@Injectable()
export class TemplateSweepScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(TEMPLATE_SWEEP_QUEUE) private readonly queue: Queue,
  ) {}

  async onModuleInit() {
    // Weekly, Mondays 03:15 UTC. Weekly rather than daily because the output is
    // a HUMAN review queue: a government adds a form a few times a year, and
    // re-crawling two large index pages nightly would be load on someone else's
    // server for a queue nobody reads more than once a week. 03:15 keeps it
    // clear of the 02:00 form refresh, the 02:30 document refresh and the 03:00
    // pricing recompute. Fixed jobId so repeated boots do not duplicate it.
    await this.queue.add(
      'weekly-template-sweep',
      {},
      {
        repeat: { pattern: '15 3 * * 1' },
        jobId: 'template-sweep-weekly',
        removeOnComplete: true,
        removeOnFail: 20,
      },
    );
  }
}
