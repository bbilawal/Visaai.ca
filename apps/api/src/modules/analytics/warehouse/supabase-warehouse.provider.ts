import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/supabase/supabase.service';
import type { AnalyticsEvent } from '../events/catalog';
import { IWarehouseProvider, RollupRow } from './warehouse.provider';

@Injectable()
export class SupabaseWarehouseProvider implements IWarehouseProvider {
  constructor(private readonly supabase: SupabaseService) {}

  async writeEvents(batch: AnalyticsEvent[]): Promise<{ inserted: number }> {
    if (batch.length === 0) return { inserted: 0 };
    const { data, error } = await this.supabase.admin
      .from('analytics_event_stream')
      .upsert(batch, {
        onConflict: 'event_id,occurred_at',
        ignoreDuplicates: true,
      })
      .select();
    if (error)
      throw new Error(`analytics writeEvents failed: ${error.message}`);
    // With ignoreDuplicates, postgrest issues ON CONFLICT DO NOTHING RETURNING *,
    // so `data` contains only the rows actually inserted (duplicates are skipped
    // and not returned). data.length is therefore the accurate inserted count.
    return { inserted: data?.length ?? 0 };
  }

  async queryRollup(
    name: string,
    fromIso: string,
    toIso: string,
  ): Promise<RollupRow[]> {
    const { data, error } = await this.supabase.admin
      .from('analytics_event_stream')
      .select('occurred_at')
      .eq('name', name)
      .gte('occurred_at', fromIso)
      .lt('occurred_at', toIso);
    if (error)
      throw new Error(`analytics queryRollup failed: ${error.message}`);
    const counts = new Map<string, number>();
    for (const r of (data ?? []) as { occurred_at: string }[]) {
      const day = r.occurred_at.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()].map(([day, count]) => ({ day, name, count }));
  }

  async pruneBefore(cutoffIso: string): Promise<{ droppedPartitions: number }> {
    // Delete is RLS-bypassing via admin; partition-drop DDL is handled by the
    // retention SQL function in a later migration if raw-drop is needed. For
    // SP-A we bounded-delete old rows (partition DROP is an ops step).
    const { error, count } = await this.supabase.admin
      .from('analytics_event_stream')
      .delete({ count: 'exact' })
      .lt('occurred_at', cutoffIso);
    if (error)
      throw new Error(`analytics pruneBefore failed: ${error.message}`);
    return { droppedPartitions: (count ?? 0) > 0 ? 1 : 0 };
  }

  async ensurePartition(monthIso: string): Promise<void> {
    const month = monthIso.slice(0, 10);
    const { error } = await this.supabase.admin.rpc('ensure_month_partition', {
      p_month: month,
    });
    if (error)
      throw new Error(`analytics ensurePartition failed: ${error.message}`);
  }
}
