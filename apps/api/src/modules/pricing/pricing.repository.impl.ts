import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../shared/supabase/supabase.service';
import type {
  CountryFactorPatch,
  IPricingRepository,
  PricingQuoteAuditRow,
  PricingQuoteRow,
  VisaTierPatch,
} from './pricing.repository';
import type {
  DbPricingConstants,
  PricingCountryFactor,
  PricingVisaTier,
} from './pricing.engine';

const VISA_COLS =
  'visa_type, complexity_tier, compressed_review_hours, lawyer_flag, priceable, ai_cost_base_usd, base_anchor_usd, human_fee_usd';
const COUNTRY_COLS =
  'country_code, labor_band, labor_multiplier, ai_complexity_multiplier, ppp_factor, reviewer_rate_usd, price_band_min, price_band_max, priceable';

// PostgREST can serialize numeric columns as strings; coerce so engine math stays numeric.
function toVisaTier(r: Record<string, unknown>): PricingVisaTier {
  return {
    visa_type: String(r.visa_type),
    complexity_tier: r.complexity_tier as PricingVisaTier['complexity_tier'],
    compressed_review_hours: Number(r.compressed_review_hours),
    lawyer_flag: Boolean(r.lawyer_flag),
    priceable: Boolean(r.priceable),
    ai_cost_base_usd: Number(r.ai_cost_base_usd),
    base_anchor_usd: Number(r.base_anchor_usd),
    human_fee_usd: Number(r.human_fee_usd),
  };
}

const QUOTE_COLS =
  'visa_type, country_code, recommended_price, floor_price, ceiling_price, gross_margin, total_cogs, breakdown, flags';

function toQuoteRow(r: Record<string, unknown>): PricingQuoteRow {
  return {
    visa_type: String(r.visa_type),
    country_code: String(r.country_code),
    recommended_price: Number(r.recommended_price),
    floor_price: Number(r.floor_price),
    ceiling_price: r.ceiling_price == null ? null : Number(r.ceiling_price),
    gross_margin: Number(r.gross_margin),
    total_cogs: Number(r.total_cogs),
    breakdown: (r.breakdown ?? {}) as Record<string, unknown>,
    flags: (r.flags ?? []) as string[],
  };
}

function toCountryFactor(r: Record<string, unknown>): PricingCountryFactor {
  return {
    country_code: String(r.country_code),
    labor_band: r.labor_band as PricingCountryFactor['labor_band'],
    labor_multiplier: Number(r.labor_multiplier),
    ai_complexity_multiplier: Number(r.ai_complexity_multiplier),
    ppp_factor: Number(r.ppp_factor),
    reviewer_rate_usd: Number(r.reviewer_rate_usd),
    price_band_min: Number(r.price_band_min),
    price_band_max: Number(r.price_band_max),
    priceable: Boolean(r.priceable),
  };
}

/**
 * Reads the config-driven pricing tables. These are public-read reference config
 * (not user-owned), so service-role reads are appropriate; `quote` never writes.
 */
@Injectable()
export class PricingRepository implements IPricingRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async getConstants(): Promise<DbPricingConstants> {
    const { data, error } = await this.supabase.admin
      .from('pricing_constants')
      .select('key, value')
      .eq('active', true);
    if (error) throw error;
    const m = new Map<string, number>(
      (data ?? []).map((r: { key: string; value: unknown }) => [
        r.key,
        Number(r.value),
      ]),
    );
    const need = (k: string): number => {
      const v = m.get(k);
      if (v === undefined)
        throw new Error(`pricing_constants missing key: ${k}`);
      return v;
    };
    return {
      min_margin: need('min_margin'),
      target_margin: need('target_margin'),
      premium_margin: need('premium_margin'),
      max_capture: need('max_capture'),
      rework_load: need('rework_load'),
      take_rate: need('take_rate'),
      lawyer_rate_multiplier: need('lawyer_rate_multiplier'),
    };
  }

  async getVisaTier(visaType: string): Promise<PricingVisaTier | null> {
    const { data, error } = await this.supabase.admin
      .from('pricing_visa_tiers')
      .select(VISA_COLS)
      .eq('visa_type', visaType)
      .maybeSingle();
    if (error) throw error;
    return data ? toVisaTier(data) : null;
  }

  async getCountryFactor(
    countryCode: string,
  ): Promise<PricingCountryFactor | null> {
    const { data, error } = await this.supabase.admin
      .from('pricing_country_factors')
      .select(COUNTRY_COLS)
      .eq('country_code', countryCode)
      .maybeSingle();
    if (error) throw error;
    return data ? toCountryFactor(data) : null;
  }

  async listPriceableVisaTiers(): Promise<PricingVisaTier[]> {
    const { data, error } = await this.supabase.admin
      .from('pricing_visa_tiers')
      .select(VISA_COLS)
      .eq('priceable', true);
    if (error) throw error;
    return (data ?? []).map(toVisaTier);
  }

  async listPriceableCountries(): Promise<PricingCountryFactor[]> {
    const { data, error } = await this.supabase.admin
      .from('pricing_country_factors')
      .select(COUNTRY_COLS)
      .eq('priceable', true);
    if (error) throw error;
    return (data ?? []).map(toCountryFactor);
  }

  async upsertQuotes(rows: PricingQuoteRow[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.supabase.admin
      .from('pricing_quotes')
      .upsert(rows, { onConflict: 'visa_type,country_code' });
    if (error) throw error;
  }

  async insertQuoteAudit(rows: PricingQuoteAuditRow[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.supabase.admin
      .from('pricing_quote_audit')
      .insert(rows);
    if (error) throw error;
  }

  async getQuote(
    visaType: string,
    countryCode: string,
  ): Promise<PricingQuoteRow | null> {
    const { data, error } = await this.supabase.admin
      .from('pricing_quotes')
      .select(QUOTE_COLS)
      .eq('visa_type', visaType)
      .eq('country_code', countryCode)
      .maybeSingle();
    if (error) throw error;
    return data ? toQuoteRow(data) : null;
  }

  async listQuotes(): Promise<PricingQuoteRow[]> {
    const { data, error } = await this.supabase.admin
      .from('pricing_quotes')
      .select(QUOTE_COLS);
    if (error) throw error;
    return (data ?? []).map(toQuoteRow);
  }

  async updateConstant(key: string, value: number): Promise<void> {
    const { error } = await this.supabase.admin
      .from('pricing_constants')
      .update({ value })
      .eq('key', key)
      .eq('active', true);
    if (error) throw error;
  }

  async updateVisaTier(visaType: string, patch: VisaTierPatch): Promise<void> {
    const { error } = await this.supabase.admin
      .from('pricing_visa_tiers')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('visa_type', visaType);
    if (error) throw error;
  }

  async updateCountryFactor(
    countryCode: string,
    patch: CountryFactorPatch,
  ): Promise<void> {
    const { error } = await this.supabase.admin
      .from('pricing_country_factors')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('country_code', countryCode);
    if (error) throw error;
  }
}
