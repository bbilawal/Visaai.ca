import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/configuration';
import { ANALYTICS_ALERTS_QUEUE } from '../shared/queue/queue.constants';

@Injectable()
export class AlertScheduler implements OnModuleInit {
  constructor(
    @InjectQueue(ANALYTICS_ALERTS_QUEUE) private readonly queue: Queue,
    private readonly config: ConfigService<Env>,
  ) {}
  async onModuleInit(): Promise<void> {
    const everyMin =
      this.config.get('ANALYTICS_ALERTS_TICK_MIN', { infer: true }) ?? 5;
    await this.queue.add(
      'tick',
      {},
      {
        repeat: { every: everyMin * 60_000 },
        jobId: 'analytics-alerts-tick',
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
  }
}
