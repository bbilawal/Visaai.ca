import { z } from 'zod';

export const GOV_FEE_NOTE =
  'Government processing fees are separate and paid directly to the issuing authority.';

/** Public-safe quote payload — no margin / cogs / floor leaked (PRICE-4 §AC1). */
export interface PublicQuote {
  visa_type: string;
  country_code: string;
  price: number;
  currency: 'USD';
  gov_fee_note: string;
}

export interface ExcludedQuote {
  visa_type: string;
  country_code: string;
  excluded: true;
  reason: string;
}

export const QuoteQueryDto = z.object({
  visaType: z.string().min(1).max(64),
  country: z.string().min(2).max(16),
});

export const UpdateConstantDto = z.object({
  value: z.number().finite(),
});

export const UpdateVisaTierDto = z
  .object({
    compressed_review_hours: z.number().min(0).optional(),
    lawyer_flag: z.boolean().optional(),
    priceable: z.boolean().optional(),
    ai_cost_base_usd: z.number().min(0).optional(),
    base_anchor_usd: z.number().min(0).optional(),
    human_fee_usd: z.number().min(0).optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: 'at least one field is required',
  });

export const UpdateCountryFactorDto = z
  .object({
    labor_multiplier: z.number().positive().optional(),
    ai_complexity_multiplier: z.number().positive().optional(),
    ppp_factor: z.number().positive().optional(),
    reviewer_rate_usd: z.number().positive().optional(),
    price_band_min: z.number().min(0).optional(),
    price_band_max: z.number().min(0).optional(),
    priceable: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: 'at least one field is required',
  });
