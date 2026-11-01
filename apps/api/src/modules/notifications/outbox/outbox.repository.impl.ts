import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { type IOutboxRepository, type OutboxRow } from './outbox.repository';

@Injectable()
export class OutboxRepository implements IOutboxRepository {
  async claimBatch(db: SupabaseClient, limit: number): Promise<OutboxRow[]> {
    const { data, error } = await db.rpc('claim_outbox_batch', {
      p_limit: limit,
    });
    if (error) throw new Error(error.message);
    return ((data as OutboxRow[]) ?? []).map((r) => ({
      id: r.id,
      event_type: r.event_type,
      payload: r.payload,
      attempts: r.attempts,
    }));
  }

  async markProcessed(db: SupabaseClient, id: string): Promise<void> {
    const { error } = await db
      .from('notification_outbox')
      .update({ processed_at: new Date().toISOString(), last_error: null })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async markFailed(db: SupabaseClient, id: string, err: string): Promise<void> {
    const { error } = await db
      .from('notification_outbox')
      .update({ last_error: err })
      .eq('id', id);
    if (error) throw new Error(error.message);
  }

  async pruneProcessed(
    db: SupabaseClient,
    olderThanDays: number,
  ): Promise<number> {
    const cutoff = new Date(
      Date.now() - olderThanDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { data, error } = await db
      .from('notification_outbox')
      .delete()
      .not('processed_at', 'is', null)
      .lt('processed_at', cutoff)
      .select('id');
    if (error) throw new Error(error.message);
    return (data as { id: string }[] | null)?.length ?? 0;
  }
}
