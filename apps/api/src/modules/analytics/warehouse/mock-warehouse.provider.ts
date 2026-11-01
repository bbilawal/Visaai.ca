import { Injectable } from '@nestjs/common';
import type { AnalyticsEvent } from '../events/catalog';
import { IWarehouseProvider, RollupRow } from './warehouse.provider';

@Injectable()
export class MockWarehouseProvider implements IWarehouseProvider {
  readonly rows: AnalyticsEvent[] = [];
  private readonly seen = new Set<string>();
  readonly partitions = new Set<string>();

  async writeEvents(batch: AnalyticsEvent[]): Promise<{ inserted: number }> {
    let inserted = 0;
    for (const e of batch) {
      if (this.seen.has(e.event_id)) continue;
      this.seen.add(e.event_id);
      this.rows.push(e);
      inserted++;
    }
    return { inserted };
  }

  async queryRollup(
    name: string,
    fromIso: string,
    toIso: string,
  ): Promise<RollupRow[]> {
    const counts = new Map<string, number>();
    for (const e of this.rows) {
      if (e.name !== name) continue;
      if (e.occurred_at < fromIso || e.occurred_at >= toIso) continue;
      const day = e.occurred_at.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()].map(([day, count]) => ({ day, name, count }));
  }

  async pruneBefore(cutoffIso: string): Promise<{ droppedPartitions: number }> {
    const before = this.rows.length;
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i].occurred_at < cutoffIso) this.rows.splice(i, 1);
    }
    return { droppedPartitions: before === this.rows.length ? 0 : 1 };
  }

  async ensurePartition(monthIso: string): Promise<void> {
    this.partitions.add(monthIso.slice(0, 7));
  }
}
