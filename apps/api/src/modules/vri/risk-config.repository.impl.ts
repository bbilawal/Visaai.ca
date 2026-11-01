import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type { IRiskConfigRepository } from './risk-config.repository';
import {
  DIMENSION_TO_SCORE_KEY,
  type EscalationThresholds,
  type RiskDimension,
  type RiskWeights,
} from './risk-config.types';

/** Threshold keys the engine consumes (others may exist but aren't typed/read). */
const KNOWN_THRESHOLD_KEYS: ReadonlyArray<keyof EscalationThresholds> = [
  'weak_threshold',
  'escalate_below',
  'max_revisions',
];

/**
 * Reads the config-driven risk tables. These are admin-only at the RLS layer, so
 * the config read is a SYSTEM path (service-role `admin` client, bypasses RLS) —
 * exactly like PricingRepository reads its reference config. Never user-scoped.
 */
@Injectable()
export class RiskConfigRepository implements IRiskConfigRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getWeights(): Promise<Partial<RiskWeights>> {
    const { data, error } = await this.supabase.admin
      .from('risk_weights')
      .select('dimension, weight')
      .eq('active', true);
    if (error) throw error;
    const out: Partial<RiskWeights> = {};
    for (const r of (data ?? []) as Array<{
      dimension: string;
      weight: unknown;
    }>) {
      const key = DIMENSION_TO_SCORE_KEY[r.dimension as RiskDimension];
      // PostgREST can serialize numeric as string; coerce so math stays numeric.
      if (key) out[key] = Number(r.weight);
    }
    return out;
  }

  async getThresholds(): Promise<Partial<EscalationThresholds>> {
    const { data, error } = await this.supabase.admin
      .from('escalation_thresholds')
      .select('key, value')
      .eq('active', true);
    if (error) throw error;
    const out: Partial<EscalationThresholds> = {};
    for (const r of (data ?? []) as Array<{ key: string; value: unknown }>) {
      if ((KNOWN_THRESHOLD_KEYS as string[]).includes(r.key)) {
        out[r.key as keyof EscalationThresholds] = Number(r.value);
      }
    }
    return out;
  }

  async updateWeight(dimension: RiskDimension, weight: number): Promise<void> {
    const { error } = await this.supabase.admin
      .from('risk_weights')
      .update({ weight })
      .eq('dimension', dimension)
      .eq('active', true);
    if (error) throw error;
  }

  async updateThreshold(key: string, value: number): Promise<void> {
    const { error } = await this.supabase.admin
      .from('escalation_thresholds')
      .update({ value })
      .eq('key', key)
      .eq('active', true);
    if (error) throw error;
  }
}
