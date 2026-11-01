import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import {
  WAREHOUSE_PROVIDER,
  type IWarehouseProvider,
} from '../warehouse/warehouse.provider';
import { SERVER_EVENT_NAMES, CLIENT_EVENT_NAMES } from '../events/catalog';
import type { Env } from '../../../config/configuration';

const ALL_NAMES = [
  ...new Set<string>([...SERVER_EVENT_NAMES, ...CLIENT_EVENT_NAMES]),
];

/**
 * Reference rollup: recomputes per-name daily event counts from the warehouse
 * into `analytics_event_daily` on a repeatable BullMQ tick (see
 * AnalyticsRollupScheduler / AnalyticsRollupProcessor), and pre-creates next
 * month's raw partition via IWarehouseProvider.ensurePartition so ingest never
 * blocks on a missing partition at month boundaries.
 *
 * NOTE: DAU/WAU/MAU population (`analytics_daily_active`) is intentionally
 * NOT implemented here — deferred to SP-B, where the active-user definition
 * (distinct user_id with a qualifying event) is finalized. This service only
 * proves the per-name event-count rollup pattern (SP-A spec §3 D8).
 */
@Injectable()
export class AnalyticsRollupService {
  private readonly log = new Logger(AnalyticsRollupService.name);

  constructor(
    @Inject(WAREHOUSE_PROVIDER) private readonly wh: IWarehouseProvider,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService<Env>,
  ) {}

  async recompute(): Promise<void> {
    const lookback =
      this.config.get('ANALYTICS_ROLLUP_LOOKBACK_DAYS', { infer: true }) ?? 3;
    const now = new Date();
    const from = new Date(now.getTime() - lookback * 86_400_000);
    const fromIso = from.toISOString();
    const toIso = new Date(now.getTime() + 86_400_000).toISOString(); // include today

    const rows: { day: string; name: string; count: number }[] = [];
    for (const name of ALL_NAMES) {
      const r = await this.wh.queryRollup(name, fromIso, toIso);
      rows.push(...r);
    }
    if (rows.length) {
      await this.supabase.admin
        .from('analytics_event_daily')
        .upsert(rows, { onConflict: 'day,name' });
    }

    // Create next month's partition ahead of time.
    const nextMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      1,
    ).toISOString();
    await this.wh.ensurePartition(nextMonth);

    this.log.debug(`analytics rollup — ${rows.length} (day,name) rows`);
  }
}
