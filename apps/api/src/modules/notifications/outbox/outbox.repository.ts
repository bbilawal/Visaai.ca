import type { SupabaseClient } from '@supabase/supabase-js';

/** A claimed outbox row. `payload` is the enqueued NotificationEvent shape. */
export interface OutboxRow {
  id: string;
  event_type: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');

export interface IOutboxRepository {
  /**
   * Atomically claim up to `limit` unprocessed rows (oldest first) via the
   * `claim_outbox_batch` RPC (FOR UPDATE SKIP LOCKED) so concurrent workers
   * never claim the same row. Bumps `attempts` on each claimed row.
   */
  claimBatch(db: SupabaseClient, limit: number): Promise<OutboxRow[]>;
  /** Mark a row delivered (sets processed_at). */
  markProcessed(db: SupabaseClient, id: string): Promise<void>;
  /** Record a failure (last_error) without setting processed_at so it retries. */
  markFailed(db: SupabaseClient, id: string, error: string): Promise<void>;
  /** Delete processed rows older than `olderThanDays`. Returns deleted count. */
  pruneProcessed(db: SupabaseClient, olderThanDays: number): Promise<number>;
}
