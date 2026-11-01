import { z } from 'zod';

/** Request contract for POST /visa/analyze. Validated with Zod (repo convention). */
export const AnalyzeRequest = z.object({
  country: z.string().min(2).max(100),
  visaType: z.string().min(2).max(100),
  profile: z.string().min(1).max(8000),
  notes: z.string().max(2000).optional(),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;
