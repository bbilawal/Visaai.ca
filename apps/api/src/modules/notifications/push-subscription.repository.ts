import type { SupabaseClient } from '@supabase/supabase-js';
import type { PushSubscriptionRecord } from '@visaai/types';

export interface UpsertPushSubscriptionInput {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

export interface IPushSubscriptionRepository {
  upsert(
    db: SupabaseClient,
    input: UpsertPushSubscriptionInput,
  ): Promise<PushSubscriptionRecord>;
  listForUser(
    db: SupabaseClient,
    userId: string,
  ): Promise<PushSubscriptionRecord[]>;
  deleteByEndpoint(db: SupabaseClient, endpoint: string): Promise<void>;
}

export const PUSH_SUBSCRIPTION_REPOSITORY = Symbol(
  'IPushSubscriptionRepository',
);
