import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { PRICING_RECOMPUTE_QUEUE } from '../shared/queue/queue.constants';
import { PricingRecomputeService } from './pricing-recompute.service';

@Injectable()
@Processor(PRICING_RECOMPUTE_QUEUE)
export class PricingRecomputeProcessor extends WorkerHost {
  private readonly log = new Logger(PricingRecomputeProcessor.name);

  constructor(private readonly recompute: PricingRecomputeService) {
    super();
  }

  async process(): Promise<void> {
    const { quotes, computed } = await this.recompute.recomputeAll();
    this.log.log(`pricing recompute job — ${quotes}/${computed} quotes`);
  }
}
