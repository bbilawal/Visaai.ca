import { z } from 'zod';

const CATEGORIES = [
  'application',
  'billing',
  'assignment',
  'ai',
  'support',
  'system',
] as const;

const AudienceDto = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('all') }),
  z.object({
    kind: z.literal('role'),
    role: z.enum(['admin', 'consultant', 'user']),
  }),
  z.object({
    kind: z.literal('users'),
    userIds: z.array(z.string().uuid()).min(1).max(5000),
  }),
]);

export const BroadcastInputDto = z.object({
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(4000),
  link: z.string().max(500).nullish(),
  category: z.enum(CATEGORIES).default('system'),
  audience: AudienceDto,
});
export type BroadcastInputDto = z.infer<typeof BroadcastInputDto>;

export const BroadcastListQueryDto = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
export type BroadcastListQueryDto = z.infer<typeof BroadcastListQueryDto>;
