import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { CommissionRule, CommissionSplit } from '@visaai/types';
import {
  resolveRule,
  split,
  type CommissionContext,
} from './commission.engine';
import {
  COMMISSION_REPOSITORY,
  type CommissionRuleInput,
  type ICommissionRepository,
} from './commission.repository';

export interface SplitRequest extends CommissionContext {
  /** Gross amount charged to the user (USD). */
  gross: number;
}

/**
 * CommissionService — the authoritative marketplace revenue-split.
 * Loads the active consultant_commission_rules, resolves the most-specific rule
 * for a transaction, and splits gross -> platform fee + consultant payout.
 * Pure math lives in commission.engine.ts (deterministic, tested).
 *
 * NOTE (AUDIT COR-1): this is the single authority for MARKETPLACE service-order
 * splits. The pricing engine's `pricing_constants.take_rate` is a separate input
 * to per-visa price COMPUTATION; reconciling the two into one source is a tracked
 * follow-up (VISAAIDocs/roadmap/AUDIT.md §4) — not changed here to avoid
 * touching shipped pricing.
 */
@Injectable()
export class CommissionService {
  private readonly log = new Logger(CommissionService.name);

  constructor(
    @Inject(COMMISSION_REPOSITORY)
    private readonly repo: ICommissionRepository,
  ) {}

  /** Resolve + split for a transaction. Throws if no rule resolves (misconfig). */
  async splitFor(req: SplitRequest): Promise<CommissionSplit> {
    const rules = await this.repo.listActiveRules();
    const rule = resolveRule(rules, req);
    if (!rule) {
      this.log.error(
        `no commission rule resolved (country=${req.country ?? '-'}, visa=${req.visa ?? '-'}, consultant=${req.consultantId ?? '-'}); seed a global rule`,
      );
      throw new NotFoundException('no applicable commission rule');
    }
    return split(req.gross, rule);
  }

  /** Which rule WOULD apply (no amount) — for previews / profitability tooling. */
  async resolveFor(ctx: CommissionContext): Promise<CommissionRule | null> {
    return resolveRule(await this.repo.listActiveRules(), ctx);
  }

  // ---- admin CRUD ------------------------------------------------------

  listRules(): Promise<CommissionRule[]> {
    return this.repo.listAllRules();
  }

  async createRule(input: CommissionRuleInput): Promise<CommissionRule> {
    const rule = await this.repo.insertRule(input);
    this.log.log(`commission rule created: ${rule.id} (scope=${rule.scope})`);
    return rule;
  }

  async deactivateRule(id: string): Promise<{ id: string; active: false }> {
    const ok = await this.repo.deactivateRule(id);
    if (!ok) throw new NotFoundException('commission rule not found');
    this.log.log(`commission rule deactivated: ${id}`);
    return { id, active: false };
  }
}
