import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PAYOUTS_SWEEP_QUEUE } from '../shared/queue/queue.constants';
import { PayoutsService } from './payouts.service';

@Injectable()
@Processor(PAYOUTS_SWEEP_QUEUE)
export class PayoutsSweepProcessor extends WorkerHost {
  private readonly log = new Logger(PayoutsSweepProcessor.name);

  constructor(private readonly payouts: PayoutsService) {
    super();
  }

  async process(): Promise<void> {
    const s = await this.payouts.sweep();
    this.log.log(
      `payouts sweep job — ${s.orders_swept} orders / ${s.consultants} consultants / ${s.failed} failed`,
    );
  }
}
