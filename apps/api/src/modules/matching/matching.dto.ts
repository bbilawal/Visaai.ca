import { z } from 'zod';

export const CandidatesQueryDto = z.object({
  applicationId: z.string().uuid(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
