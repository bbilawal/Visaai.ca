import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeliveryChannel, DeliveryStatus } from '@visaai/types';

export interface RecordDeliveryInput {
  notificationId?: string;
  userId: string;
  eventType: string;
  channel: DeliveryChannel;
  status: DeliveryStatus;
  dedupeKey: string;
}

export interface RecordDeliveryResult {
  /** true = row was just inserted; false = dedupe_key conflict, row already existed */
  created: boolean;
  id: string;
}

export interface INotificationDeliveryRepository {
  /**
   * Insert a delivery tracking row. On `dedupe_key` unique conflict, does NOT
   * throw — returns `{created:false, id:<existing row id>}` so callers can
   * skip re-processing idempotently.
   */
  record(
    db: SupabaseClient,
    input: RecordDeliveryInput,
  ): Promise<RecordDeliveryResult>;

  /** Attach a `notifications` row id to an existing delivery row (set `notification_id`). */
  attachNotification(
    db: SupabaseClient,
    deliveryId: string,
    notificationId: string,
  ): Promise<void>;

  /** Update status, increment attempts by 1, and optionally set an error message. */
  markStatus(
    db: SupabaseClient,
    deliveryId: string,
    status: DeliveryStatus,
    error?: string,
  ): Promise<void>;

  /**
   * Delete a delivery row by id. Used to RELEASE a dedupe lock when the feed
   * insert fails after the gate row was written, so a later emit can retry.
   */
  deleteById(db: SupabaseClient, deliveryId: string): Promise<void>;
}

export const NOTIFICATION_DELIVERY_REPOSITORY = Symbol(
  'INotificationDeliveryRepository',
);
