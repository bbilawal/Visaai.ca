import { z } from 'zod';

// zod (repo convention — no global ValidationPipe / class-validator). Strict.
export const SetUserRoleDto = z.object({
  role: z.enum(['admin', 'consultant', 'user']),
});
export type SetUserRoleDto = z.infer<typeof SetUserRoleDto>;

export const AuditQueryDto = z.object({
  applicationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});
export type AuditQueryDto = z.infer<typeof AuditQueryDto>;

export const AssignConsultantDto = z.object({
  consultantId: z.string().uuid(),
});
export type AssignConsultantDto = z.infer<typeof AssignConsultantDto>;

// Server-side admin list filters. status/country pushed to PostgREST; q matches
// application id (ilike); assignee/assignmentStatus/deadline range filtered in
// the repo (JS) against the resolved active-assignee (bounded volume).
export const ListApplicationsQueryDto = z.object({
  status: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  /** Free-text application-id match (substring, case-insensitive). */
  q: z.string().min(1).optional(),
  /** Active-assignee email substring (case-insensitive). */
  assignee: z.string().min(1).optional(),
  /** Derived assignment status filter. */
  assignmentStatus: z.enum(['ASSIGNED', 'UNASSIGNED']).optional(),
  /** Active-assignee due_at lower bound (ISO datetime, inclusive). */
  deadlineFrom: z.string().datetime().optional(),
  /** Active-assignee due_at upper bound (ISO datetime, inclusive). */
  deadlineTo: z.string().datetime().optional(),
});
export type ListApplicationsQueryDto = z.infer<typeof ListApplicationsQueryDto>;

// Optional email-substring filter for the admin users list (bounded, optional).
export const ListUsersQueryDto = z.object({
  q: z.string().min(1).optional(),
});
export type ListUsersQueryDto = z.infer<typeof ListUsersQueryDto>;

// Admin-set review window. Accepts EITHER an absolute ISO datetime (`dueAt`) OR
// a relative window in hours (`hours`, kept for back-compat). Exactly one must
// be supplied. Bounds are re-checked in AssignmentService (now+5m .. now+1y for
// dueAt; MIN/MAX_REVIEW_HOURS for hours).
export const SetDeadlineDto = z
  .object({
    hours: z.coerce
      .number()
      .int()
      .min(1)
      .max(24 * 30)
      .optional(),
    dueAt: z.string().datetime().optional(),
  })
  .refine((v) => (v.hours === undefined) !== (v.dueAt === undefined), {
    message: 'provide exactly one of { hours } or { dueAt }',
  });
export type SetDeadlineDto = z.infer<typeof SetDeadlineDto>;

export const UserReasonDto = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type UserReasonDto = z.infer<typeof UserReasonDto>;

// Paginated user list (Task 4). Replaces the legacy ListUsersQueryDto route.
export const ListUsersV2Dto = z.object({
  q: z.string().min(1).optional(),
  status: z.enum(['active', 'suspended', 'deleted']).optional(),
  role: z.string().min(1).optional(), // IAM role key filter
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['createdAt', 'email']).default('createdAt'),
  /**
   * Include anonymous guest sessions in the list. Default OFF.
   *
   * The app issues Supabase ANONYMOUS identities so an applicant can start the
   * funnel before signing up, and each one gets a `users` row. On production
   * 2026-09-06 that meant "Users & roles" listed 50 rows of which 35 were
   * guests: no email, no name, no role to manage, and a Manage action offering
   * to suspend a session. Registered accounts are what this screen is for, so
   * they are what it shows unless asked otherwise.
   */
  includeGuests: z.coerce.boolean().default(false),
});
export type ListUsersV2Dto = z.infer<typeof ListUsersV2Dto>;

// Bulk user lifecycle action (Task 5). Capped batch; per-item guard skipping
// happens in the service via planBulk.
export const BulkUsersDto = z.object({
  action: z.enum(['suspend', 'reactivate', 'soft-delete', 'restore']),
  ids: z.array(z.string().uuid()).min(1).max(100),
  reason: z.string().min(1).max(500).optional(),
});
export type BulkUsersDto = z.infer<typeof BulkUsersDto>;

// Admin maps an ISO-2 country set onto a consultant. Codes are deduped and
// upper-cased here; the service validates each against the strategy registry.
export const SetConsultantCountriesDto = z.object({
  codes: z
    .array(z.string().trim().min(1))
    .transform((arr) => [...new Set(arr.map((c) => c.toUpperCase()))]),
});
export type SetConsultantCountriesDto = z.infer<
  typeof SetConsultantCountriesDto
>;
