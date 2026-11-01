import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  IBillingAnalyticsRepository,
  SubLite,
} from './billing-analytics.repository';

@Injectable()
export class BillingAnalyticsRepository implements IBillingAnalyticsRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async listActiveSubscriptions(): Promise<SubLite[]> {
    const { data } = await this.supabase.admin
      .from('subscriptions')
      .select('plan, billing_interval')
      .in('status', ['active', 'trialing']);
    return data ?? [];
  }

  async listPastDueSubscriptions(): Promise<SubLite[]> {
    const { data } = await this.supabase.admin
      .from('subscriptions')
      .select('plan, billing_interval')
      .eq('status', 'past_due');
    return data ?? [];
  }

  async listRefunds(): Promise<unknown[]> {
    const { data } = await this.supabase.admin
      .from('refunds')
      .select('*')
      .order('created_at', { ascending: false });
    return data ?? [];
  }
}
