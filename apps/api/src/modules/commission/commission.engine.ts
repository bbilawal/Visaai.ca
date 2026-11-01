/**
 * Commission engine — pure implementation of docs/consultant-marketplace
 * ARCHITECTURE.md §4. No DB, no clock, no hidden state: `resolveRule` and
 * `split` are deterministic functions of their inputs (mirrors pricing.engine.ts).
 * The service assembles the active-rule snapshot from consultant_commission_rules
 * and feeds it here.
 */
import type { CommissionRule, CommissionSplit } from '@visaai/types';

export interface CommissionContext {
  /** ISO-2 destination country, if known. */
  country?: string | null;
  /** Visa type (pricing_visa_tiers vocabulary), if known. */
  visa?: string | null;
  /** consultant_profiles.id, if a consultant-specific rule may apply. */
  consultantId?: string | null;
}

/** Round to cents, avoiding binary float drift (e.g. 1.005 -> 1.01). */
export function roundCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Resolve the single applicable rule by precedence (most specific wins):
 *   consultant > country_visa > country > visa > global
 * Within a precedence tier, the rule with the latest `effective_from` wins.
 * Only `active` rules are considered. Returns null if nothing matches (callers
 * should treat that as a misconfiguration — a seeded global rule always exists).
 */
export function resolveRule(
  rules: CommissionRule[],
  ctx: CommissionContext,
): CommissionRule | null {
  const active = rules.filter((r) => r.active);
  const country = ctx.country ?? null;
  const visa = ctx.visa ?? null;
  const consultantId = ctx.consultantId ?? null;

  const tiers: Array<(r: CommissionRule) => boolean> = [
    // 1. consultant-specific
    (r) =>
      r.scope === 'consultant' &&
      consultantId != null &&
      r.consultant_id === consultantId,
    // 2. country + visa
    (r) =>
      r.scope === 'country_visa' &&
      country != null &&
      visa != null &&
      r.country_code === country &&
      r.visa_type === visa,
    // 3. country
    (r) =>
      r.scope === 'country' && country != null && r.country_code === country,
    // 4. visa
    (r) => r.scope === 'visa' && visa != null && r.visa_type === visa,
    // 5. global
    (r) => r.scope === 'global',
  ];

  for (const match of tiers) {
    const candidates = active.filter(match);
    if (candidates.length > 0) {
      return candidates.reduce((best, r) =>
        new Date(r.effective_from).getTime() >
        new Date(best.effective_from).getTime()
          ? r
          : best,
      );
    }
  }
  return null;
}

/**
 * Split a gross amount (USD) into platform fee + consultant payout per the rule.
 *   percentage: fee = round(gross * platform_pct)
 *   fixed:      fee = min(platform_fixed_usd, gross)   // never exceed gross
 * Payout is the remainder; both rounded to cents and clamped to >= 0.
 */
export function split(grossUsd: number, rule: CommissionRule): CommissionSplit {
  if (grossUsd < 0) throw new Error('gross must be >= 0');

  let platformFee: number;
  if (rule.model === 'percentage') {
    if (rule.platform_pct == null)
      throw new Error(`percentage rule ${rule.id} missing platform_pct`);
    platformFee = roundCents(grossUsd * rule.platform_pct);
  } else {
    if (rule.platform_fixed_usd == null)
      throw new Error(`fixed rule ${rule.id} missing platform_fixed_usd`);
    platformFee = roundCents(Math.min(rule.platform_fixed_usd, grossUsd));
  }

  platformFee = Math.max(0, Math.min(platformFee, roundCents(grossUsd)));
  const payout = roundCents(grossUsd - platformFee);

  return {
    gross_usd: roundCents(grossUsd),
    platform_fee_usd: platformFee,
    consultant_payout_usd: Math.max(0, payout),
    rule_id: rule.id,
  };
}
