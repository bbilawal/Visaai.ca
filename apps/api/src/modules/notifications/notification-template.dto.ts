import { z } from 'zod';

/** Known catalog event types templates may target (typo-guard). */
export const TEMPLATE_EVENT_TYPES = [
  'consultant.assigned',
  'payment.received',
  'ai.assessment_complete',
  'application.status_changed',
] as const;

export const TemplateInputDto = z.object({
  event_type: z.enum(TEMPLATE_EVENT_TYPES),
  locale: z.string().min(2).max(10).optional(),
  subject: z.string().max(300).nullish(),
  title: z.string().min(1).max(300),
  body: z.string().min(1).max(4000),
  variables: z.array(z.string().min(1)).optional(),
});
export type TemplateInputDto = z.infer<typeof TemplateInputDto>;

export const TemplateListQueryDto = z.object({
  event_type: z.enum(TEMPLATE_EVENT_TYPES).optional(),
  locale: z.string().min(2).max(10).optional(),
});
export type TemplateListQueryDto = z.infer<typeof TemplateListQueryDto>;

export const TemplatePreviewDto = z.object({
  title: z.string().max(4000),
  body: z.string().max(4000),
  sampleVars: z.record(z.string(), z.string()).default({}),
});
export type TemplatePreviewDto = z.infer<typeof TemplatePreviewDto>;
