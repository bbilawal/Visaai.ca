import { Injectable } from '@nestjs/common';
import type { CommissionRule } from '@visaai/types';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  CommissionRuleInput,
  ICommissionRepository,
} from './commission.repository';

const COLS =
  'id, scope, country_code, visa_type, consultant_id, model, platform_pct, platform_fixed_usd, effective_from, active, note, created_at';

// PostgREST serializes numeric columns as strings — coerce so engine math stays numeric.
function toRule(r: Record<string, unknown>): CommissionRule {
  return {
    id: String(r.id),
    scope: r.scope as CommissionRule['scope'],
    country_code: (r.country_code as string | null) ?? null,
    visa_type: (r.visa_type as string | null) ?? null,
    consultant_id: (r.consultant_id as string | null) ?? null,
    model: r.model as CommissionRule['model'],
    platform_pct: r.platform_pct == null ? null : Number(r.platform_pct),
    platform_fixed_usd:
      r.platform_fixed_usd == null ? null : Number(r.platform_fixed_usd),
    effective_from: String(r.effective_from),
    active: Boolean(r.active),
    note: (r.note as string | null) ?? null,
    created_at: String(r.created_at),
  };
}

/**
 * consultant_commission_rules is admin-only config (RLS admin-read/write).
 * Reads + writes use the service-role client; the controller already gates
 * callers to role=admin via RolesGuard.
 */
@Injectable()
export class CommissionRepository implements ICommissionRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async listActiveRules(): Promise<CommissionRule[]> {
    const { data, error } = await this.supabase.admin
      .from('consultant_commission_rules')
      .select(COLS)
      .eq('active', true);
    if (error) throw error;
    return (data ?? []).map(toRule);
  }

  async listAllRules(): Promise<CommissionRule[]> {
    const { data, error } = await this.supabase.admin
      .from('consultant_commission_rules')
      .select(COLS)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map(toRule);
  }

  async insertRule(input: CommissionRuleInput): Promise<CommissionRule> {
    const { data, error } = await this.supabase.admin
      .from('consultant_commission_rules')
      .insert({
        scope: input.scope,
        country_code: input.country_code ?? null,
        visa_type: input.visa_type ?? null,
        consultant_id: input.consultant_id ?? null,
        model: input.model,
        platform_pct: input.platform_pct ?? null,
        platform_fixed_usd: input.platform_fixed_usd ?? null,
        note: input.note ?? null,
      })
      .select(COLS)
      .single();
    if (error) throw error;
    return toRule(data);
  }

  async deactivateRule(id: string): Promise<boolean> {
    const { data, error } = await this.supabase.admin
      .from('consultant_commission_rules')
      .update({ active: false })
      .eq('id', id)
      .select('id');
    if (error) throw error;
    return (data ?? []).length > 0;
  }
}
