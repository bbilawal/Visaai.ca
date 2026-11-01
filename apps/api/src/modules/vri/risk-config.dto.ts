import { z } from 'zod';
import { RISK_DIMENSIONS } from './risk-config.types';

/** Path param for PUT /admin/risk-config/weights/:dimension. */
export const DimensionParamDto = z.enum(RISK_DIMENSIONS);

/** Body for PUT /admin/risk-config/weights/:dimension — a weight in [0,1]. */
export const UpdateWeightDto = z.object({
  value: z.number().min(0).max(1),
});

/** Body for PUT /admin/risk-config/thresholds/:key — any finite numeric value. */
export const UpdateThresholdDto = z.object({
  value: z.number().finite(),
});
