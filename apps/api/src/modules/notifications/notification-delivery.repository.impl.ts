import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { DeliveryStatus } from '@visaai/types';
import {
  type INotificationDeliveryRepository,
  type RecordDeliveryInput,
  type RecordDeliveryResult,
} from './notification-delivery.repository';

@Injectable()
export class NotificationDeliveryRepository implements INotificationDeliveryRepository {
  /**
   * Insert a delivery tracking row, idempotent on `dedupe_key`.
   *
   * Strategy:
   *   1. INSERT the row.
   *   2. If it succeeds → {created: true, id}.
   *   3. If Postgres returns error code 23505 (unique_violation on dedupe_key)
   *      → SELECT the existing row → {created: false, id}.
   *   4. Any other error → throw.
   */
  async record(
    db: SupabaseClient,
    input: RecordDeliveryInput,
  ): Promise<RecordDeliveryResult> {
    const { data, error } = await db
      .from('notification_deliveries')
      .insert({
        notification_id: input.notificationId ?? null,
        user_id: input.userId,
        event_type: input.eventType,
        channel: input.channel,
        status: input.status,
        dedupe_key: input.dedupeKey,
      })
      .select('id')
      .single();

    if (!error) {
      return { created: true, id: data.id };
    }

    // 23505 = unique_violation — dedupe_key already exists
    if ((error as { code?: string }).code === '23505') {
      const { data: existing, error: fetchError } = await db
        .from('notification_deliveries')
        .select('id')
        .eq('dedupe_key', input.dedupeKey)
        .single();

      if (fetchError) throw new Error(fetchError.message);
      return { created: false, id: existing.id };
    }

    throw new Error(error.message);
  }

  async attachNotification(
    db: SupabaseClient,
    deliveryId: string,
    notificationId: string,
  ): Promise<void> {
    const { error } = await db
      .from('notification_deliveries')
      .update({
        notification_id: notificationId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', deliveryId);
    if (error) throw new Error(error.message);
  }

  async markStatus(
    db: SupabaseClient,
    deliveryId: string,
    status: DeliveryStatus,
    error?: string,
  ): Promise<void> {
    // Atomic increment via RPC — `attempts = attempts + 1` in one statement,
    // correct under any concurrency (no read-modify-write race).
    const { error: rpcError } = await db.rpc('bump_delivery_attempt', {
      p_delivery_id: deliveryId,
      p_status: status,
      p_error: error ?? null,
    });
    if (rpcError) throw new Error(rpcError.message);
  }

  async deleteById(db: SupabaseClient, deliveryId: string): Promise<void> {
    const { error } = await db
      .from('notification_deliveries')
      .delete()
      .eq('id', deliveryId);
    if (error) throw new Error(error.message);
  }
}
