import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { RECONCILE_QUEUE } from '../shared/queue/queue.constants';
import { ReconciliationService } from './reconciliation.service';

@Injectable()
@Processor(RECONCILE_QUEUE)
export class ReconciliationProcessor extends WorkerHost {
  private readonly log = new Logger(ReconciliationProcessor.name);

  constructor(private readonly reconciliation: ReconciliationService) {
    super();
  }

  async process(): Promise<void> {
    // Reconcile the prior UTC day: [yesterday 00:00, today 00:00).
    const now = new Date();
    const end = new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate(),
        0,
        0,
        0,
      ),
    );
    const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
    const res = await this.reconciliation.reconcile({ start, end });
    this.log.log(
      `reconciliation ${res.runId}: ${res.matched} matched / ${res.exceptions.length} exceptions`,
    );
  }
}
