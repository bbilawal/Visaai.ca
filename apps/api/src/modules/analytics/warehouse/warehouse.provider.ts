import type { AnalyticsEvent } from '../events/catalog';

export const WAREHOUSE_PROVIDER = Symbol('WAREHOUSE_PROVIDER');

export interface RollupRow {
  day: string; // 'YYYY-MM-DD'
  name: string;
  count: number;
}

export interface IWarehouseProvider {
  /** Bulk-insert; dedupe on event_id (on-conflict-do-nothing). */
  writeEvents(batch: AnalyticsEvent[]): Promise<{ inserted: number }>;
  /** Daily event counts for a name in [fromIso, toIso). */
  queryRollup(
    name: string,
    fromIso: string,
    toIso: string,
  ): Promise<RollupRow[]>;
  /** Drop raw partitions strictly older than cutoffIso. */
  pruneBefore(cutoffIso: string): Promise<{ droppedPartitions: number }>;
  /** Ensure the month partition covering monthIso exists (idempotent). */
  ensurePartition(monthIso: string): Promise<void>;
}
