import { Inject, Injectable } from '@nestjs/common';
import type { PushSubscriptionRecord } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import {
  PUSH_SUBSCRIPTION_REPOSITORY,
  type IPushSubscriptionRepository,
} from './push-subscription.repository';

export interface SubscribeInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
}

/** Caller identity subset (matches AuthUser.id). */
export interface NotifCaller {
  id: string;
}

/**
 * Owner-scoped push subscription management. All writes use forUser — the
 * push_subscriptions RLS (user_id = auth.uid()) is the isolation boundary.
 */
@Injectable()
export class PushSubscriptionService {
  constructor(
    @Inject(PUSH_SUBSCRIPTION_REPOSITORY)
    private readonly repo: IPushSubscriptionRepository,
    private readonly supabase: SupabaseService,
  ) {}

  subscribe(
    token: string,
    caller: NotifCaller,
    input: SubscribeInput,
  ): Promise<PushSubscriptionRecord> {
    return this.repo.upsert(this.supabase.forUser(token), {
      userId: caller.id,
      endpoint: input.endpoint,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent,
    });
  }

  unsubscribe(
    token: string,
    _caller: NotifCaller,
    endpoint: string,
  ): Promise<void> {
    // RLS scopes the delete to the caller's own rows.
    return this.repo.deleteByEndpoint(this.supabase.forUser(token), endpoint);
  }
}
