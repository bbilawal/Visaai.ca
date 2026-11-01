import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushSubscriptionRecord } from '@visaai/types';
import {
  type IPushSubscriptionRepository,
  type UpsertPushSubscriptionInput,
} from './push-subscription.repository';

function unwrap<T>(res: { data: unknown; error: unknown }, ctx: string): T {
  if (res.error)
    throw new Error((res.error as { message?: string }).message ?? ctx);
  return res.data as T;
}

@Injectable()
export class PushSubscriptionRepository implements IPushSubscriptionRepository {
  async upsert(
    db: SupabaseClient,
    input: UpsertPushSubscriptionInput,
  ): Promise<PushSubscriptionRecord> {
    const res = await db
      .from('push_subscriptions')
      .upsert(
        {
          user_id: input.userId,
          endpoint: input.endpoint,
          p256dh: input.p256dh,
          auth: input.auth,
          user_agent: input.userAgent,
          last_used_at: new Date().toISOString(),
        },
        { onConflict: 'endpoint' },
      )
      .select('*')
      .single();
    return unwrap<PushSubscriptionRecord>(res, 'upsert push subscription');
  }

  async listForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<PushSubscriptionRecord[]> {
    const res = await db
      .from('push_subscriptions')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (res.error) throw new Error(res.error.message);
    return (res.data as PushSubscriptionRecord[]) ?? [];
  }

  async deleteByEndpoint(db: SupabaseClient, endpoint: string): Promise<void> {
    const res = await db
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint);
    if (res.error) throw new Error(res.error.message);
  }
}
