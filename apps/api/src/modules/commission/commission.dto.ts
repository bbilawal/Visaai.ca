import { z } from 'zod';

/**
 * Create a commission rule. Mirrors the DB constraint commission_model_value:
 * exactly one of platform_pct (percentage) / platform_fixed_usd (fixed) per model.
 */
export const CreateCommissionRuleDto = z
  .object({
    scope: z.enum(['global', 'country', 'visa', 'country_visa', 'consultant']),
    country_code: z.string().min(2).max(16).optional(),
    visa_type: z.string().min(1).max(64).optional(),
    consultant_id: z.string().uuid().optional(),
    model: z.enum(['percentage', 'fixed']),
    platform_pct: z.number().min(0).max(1).optional(),
    platform_fixed_usd: z.number().min(0).optional(),
    note: z.string().max(500).optional(),
  })
  .refine(
    (o) =>
      o.model === 'percentage'
        ? o.platform_pct != null && o.platform_fixed_usd == null
        : o.platform_fixed_usd != null && o.platform_pct == null,
    {
      message:
        'percentage requires platform_pct; fixed requires platform_fixed_usd (and not both)',
    },
  )
  .refine((o) => (o.scope === 'consultant' ? o.consultant_id != null : true), {
    message: 'scope=consultant requires consultant_id',
  })
  .refine(
    (o) =>
      o.scope === 'country' || o.scope === 'country_visa'
        ? o.country_code != null
        : true,
    { message: 'country/country_visa scope requires country_code' },
  )
  .refine(
    (o) =>
      o.scope === 'visa' || o.scope === 'country_visa'
        ? o.visa_type != null
        : true,
    { message: 'visa/country_visa scope requires visa_type' },
  );

export type CreateCommissionRuleInput = z.infer<typeof CreateCommissionRuleDto>;
