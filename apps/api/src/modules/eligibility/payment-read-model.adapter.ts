import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { IPaymentReadModel } from './eligibility.repository';

/**
 * Supabase-backed payment read model. Read-only: mirrors the existing
 * "one-time prefill fee paid?" check without importing the execution workflow
 * (automation) module. No constructor side effects.
 */
@Injectable()
export class PaymentReadModel implements IPaymentReadModel {
  constructor(private readonly supabase: SupabaseService) {}

  async hasPaidPrefill(applicationId: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('payments')
      .select('id')
      .eq('application_id', applicationId)
      .eq('feature', 'prefill')
      .eq('status', 'complete')
      .limit(1);
    if (error) throw new Error(`hasPaidPrefill failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }
}
