import type {
  CommissionModel,
  CommissionRule,
  CommissionScope,
} from '@visaai/types';

export const COMMISSION_REPOSITORY = Symbol('COMMISSION_REPOSITORY');

/** Fields accepted when creating a commission rule (id/effective_from/created_at server-set). */
export interface CommissionRuleInput {
  scope: CommissionScope;
  country_code?: string | null;
  visa_type?: string | null;
  consultant_id?: string | null;
  model: CommissionModel;
  platform_pct?: number | null;
  platform_fixed_usd?: number | null;
  note?: string | null;
}

export interface ICommissionRepository {
  /** Active rules only — the snapshot the engine resolves against. */
  listActiveRules(): Promise<CommissionRule[]>;
  /** All rules (admin view, incl. inactive). */
  listAllRules(): Promise<CommissionRule[]>;
  insertRule(input: CommissionRuleInput): Promise<CommissionRule>;
  /** Soft-delete: set active=false. Returns false if no such rule. */
  deactivateRule(id: string): Promise<boolean>;
}
