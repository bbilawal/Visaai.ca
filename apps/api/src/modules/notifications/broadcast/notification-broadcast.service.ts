import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type {
  BroadcastInput,
  NotificationBroadcast,
  NotificationBroadcastPage,
} from '@visaai/types';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import { BROADCAST_QUEUE } from '../../shared/queue/queue.constants';
import {
  NOTIFICATION_BROADCAST_REPOSITORY,
  type INotificationBroadcastRepository,
} from './notification-broadcast.repository';

@Injectable()
export class NotificationBroadcastService {
  constructor(
    private readonly supabase: SupabaseService,
    @Inject(NOTIFICATION_BROADCAST_REPOSITORY)
    private readonly repo: INotificationBroadcastRepository,
    @InjectQueue(BROADCAST_QUEUE) private readonly queue: Queue,
  ) {}

  /** Record the broadcast (status 'sending') and enqueue the background fan-out. */
  async create(
    input: BroadcastInput,
    actorId: string,
  ): Promise<NotificationBroadcast> {
    const row = await this.repo.create(this.supabase.admin, {
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      category: input.category ?? 'system',
      audience: input.audience,
      created_by: actorId,
    });
    await this.queue.add(
      'fanout',
      { broadcastId: row.id },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      },
    );
    return row;
  }

  list(cursor: string | null, limit = 25): Promise<NotificationBroadcastPage> {
    return this.repo.list(this.supabase.admin, cursor, limit);
  }

  async get(id: string): Promise<NotificationBroadcast> {
    const b = await this.repo.getById(this.supabase.admin, id);
    if (!b) throw new NotFoundException('broadcast not found');
    return b;
  }
}
