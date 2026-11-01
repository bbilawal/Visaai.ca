/**
 * Request shapes for the knowledge API.
 *
 * zod, per repo convention (no global ValidationPipe, no class-validator), and
 * `.strict()` throughout. Strictness matters more here than in most DTOs: an
 * unknown key silently ignored on a retrieval filter is a filter that did not
 * apply, and a filter that did not apply is another country's rules in the
 * response.
 */
import { z } from 'zod';

/** ISO 639-1, optionally with a region. Matches the schema's own constraint. */
const LanguageTag = z
  .string()
  .regex(
    /^[a-z]{2}(-[A-Za-z]{2,4})?$/,
    'expected a BCP-47 language tag like "en" or "pt-BR"',
  );

const SourceRole = z.enum([
  'index',
  'landing',
  'eligibility',
  'requirements',
  'documents',
  'forms',
  'fees',
  'processing_times',
  'application',
  'policy',
  'news',
]);

export const KnowledgeSearchDto = z
  .object({
    query: z.string().min(2).max(2000),
    countryId: z.string().uuid().optional(),
    visaTypeId: z.string().uuid().optional(),
    /** ISO 3166-1 alpha-2 of the applicant's nationality. */
    nationality: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .optional(),
    languages: z.array(LanguageTag).max(10).optional(),
    /** Ask what the rules were on a date. Defaults to today. */
    asOf: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    sourceRoles: z.array(SourceRole).max(11).optional(),
    limit: z.coerce.number().int().positive().max(50).optional(),
  })
  .strict();
export type KnowledgeSearchDto = z.infer<typeof KnowledgeSearchDto>;

export const KnowledgeAnswerDto = z
  .object({
    question: z.string().min(3).max(2000),
    countryId: z.string().uuid().optional(),
    visaTypeId: z.string().uuid().optional(),
    nationality: z
      .string()
      .regex(/^[A-Za-z]{2}$/)
      .optional(),
    languages: z.array(LanguageTag).max(10).optional(),
    applicationId: z.string().uuid().optional(),
    /** Passages given to the model. More costs tokens; fewer risks a refusal. */
    evidenceLimit: z.coerce.number().int().min(3).max(20).optional(),
  })
  .strict();
export type KnowledgeAnswerDto = z.infer<typeof KnowledgeAnswerDto>;

export const IngestSourceDto = z
  .object({
    /** Ingest one version. Mutually exclusive with sourceId. */
    sourceVersionId: z.string().uuid().optional(),
    /** Ingest the ACTIVE version of this source. */
    sourceId: z.string().uuid().optional(),
    /** Ingest every active version for a country. */
    countryCode: z
      .string()
      .regex(/^[A-Za-z]{2,12}$/)
      .optional(),
    force: z.boolean().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    /** Report what would run without writing anything. */
    dryRun: z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.sourceVersionId || v.sourceId || v.countryCode),
    'one of sourceVersionId, sourceId or countryCode is required',
  );
export type IngestSourceDto = z.infer<typeof IngestSourceDto>;

export const ReviewActionDto = z
  .object({
    state: z.enum(['acknowledged', 'resolved', 'dismissed']),
    note: z.string().max(4000).optional(),
  })
  .strict();
export type ReviewActionDto = z.infer<typeof ReviewActionDto>;

export const AdminListQueryDto = z
  .object({
    state: z.string().optional(),
    severity: z.string().optional(),
    kind: z.string().optional(),
    country: z.string().optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export type AdminListQueryDto = z.infer<typeof AdminListQueryDto>;
