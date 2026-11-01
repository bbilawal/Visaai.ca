import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { Response } from 'express';
import { SupabaseService } from './modules/shared/supabase/supabase.service';
import { DOCUMENT_QUEUE } from './modules/shared/queue/queue.constants';

interface DepCheck {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

/**
 * Readiness probe — can this instance actually serve traffic? Pings Postgres
 * (Supabase) and Redis so it can never report "ready" while a dependency is
 * down. Returns 503 when degraded so uptime monitors (and a future k8s readiness
 * probe) pull the instance out of rotation. Liveness stays in AppController at
 * GET /health (cheap, dependency-free).
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly supabase: SupabaseService,
    @InjectQueue(DOCUMENT_QUEUE) private readonly queue: Queue,
  ) {}

  @SkipThrottle()
  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) res: Response): Promise<{
    status: string;
    checks: Record<string, DepCheck>;
    timestamp: string;
  }> {
    const [database, redis] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
    ]);
    const ok = database.ok && redis.ok;
    res.status(ok ? 200 : 503);
    return {
      status: ok ? 'ok' : 'degraded',
      checks: { database, redis },
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<DepCheck> {
    const start = Date.now();
    try {
      const { error } = await this.supabase.admin
        .from('users')
        .select('id', { head: true })
        .limit(1);
      if (error) throw new Error(error.message);
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  private async checkRedis(): Promise<DepCheck> {
    const start = Date.now();
    try {
      // BullMQ's typed IRedisClient omits `ping`; the concrete client is an
      // ioredis connection which has it. Narrow structurally.
      const client = (await this.queue.client) as unknown as {
        ping(): Promise<string>;
      };
      const pong = await client.ping();
      return { ok: pong === 'PONG', latencyMs: Date.now() - start };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
