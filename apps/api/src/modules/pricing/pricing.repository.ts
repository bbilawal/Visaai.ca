import type {
  DbPricingConstants,
  PricingCountryFactor,
  PricingVisaTier,
} from './pricing.engine';

/** DI token for the pricing repository (mirrors the consultant repository seam). */
export const PRICING_REPOSITORY = Symbol('PRICING_REPOSITORY');

/** Row written to pricing_quotes (materialized engine output). */
export interface PricingQuoteRow {
  visa_type: string;
  country_code: string;
  recommended_price: number;
  floor_price: number;
  ceiling_price: number | null;
  gross_margin: number;
  total_cogs: number;
  breakdown: Record<string, unknown>;
  flags: string[];
}

/** Row written to pricing_quote_audit (immutable "why this price was shown" log). */
export interface PricingQuoteAuditRow {
  visa_type: string;
  country_code: string;
  recommended_price: number;
  gross_margin: number;
  breakdown: Record<string, unknown>;
  event: string; // recompute | shown | override
  shown_to_user?: string | null; // set when a price is displayed/charged to a user
}

/** Admin-editable config patches (validated by zod DTOs before reaching the repo). */
export type VisaTierPatch = Record<string, number | boolean>;
export type CountryFactorPatch = Record<string, number | boolean>;

export interface IPricingRepository {
  getConstants(): Promise<DbPricingConstants>;
  getVisaTier(visaType: string): Promise<PricingVisaTier | null>;
  getCountryFactor(countryCode: string): Promise<PricingCountryFactor | null>;
  listPriceableVisaTiers(): Promise<PricingVisaTier[]>;
  listPriceableCountries(): Promise<PricingCountryFactor[]>;
  upsertQuotes(rows: PricingQuoteRow[]): Promise<void>;
  insertQuoteAudit(rows: PricingQuoteAuditRow[]): Promise<void>;
  // PRICE-4 — quote reads + admin config writes.
  getQuote(
    visaType: string,
    countryCode: string,
  ): Promise<PricingQuoteRow | null>;
  listQuotes(): Promise<PricingQuoteRow[]>;
  updateConstant(key: string, value: number): Promise<void>;
  updateVisaTier(visaType: string, patch: VisaTierPatch): Promise<void>;
  updateCountryFactor(
    countryCode: string,
    patch: CountryFactorPatch,
  ): Promise<void>;
}
