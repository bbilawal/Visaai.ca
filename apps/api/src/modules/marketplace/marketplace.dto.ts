import { z } from 'zod';
import type {
  ConsultantAvailability,
  ConsultantProfile,
  ConsultantSkills,
} from '@visaai/types';

/**
 * Request contracts for the Consultant Marketplace core (MKT-1..MKT-4).
 * Validated with Zod (repo convention — see pricing.dto.ts / visa.dto.ts).
 * Money/KYC/Stripe/rating columns are NEVER accepted from the client: those are
 * system-managed (commission webhook, Stripe Connect sync, rating rollup
 * trigger). `active_status` is restricted to the two self-serve transitions —
 * 'active'/'suspended' are admin-only and intentionally not in the enum.
 */

/** Shared self-serve profile fields (consultant_profiles, owner-writable subset). */
const profileFields = {
  headline: z.string().max(200).nullable().optional(),
  bio: z.string().max(5000).nullable().optional(),
  specialization: z.array(z.string().min(1).max(64)).max(50).optional(),
  years_experience: z.number().int().min(0).max(80).nullable().optional(),
  license_number: z.string().max(120).nullable().optional(),
  license_authority: z.string().max(120).nullable().optional(),
  license_country: z.string().length(2).nullable().optional(),
  hourly_rate_usd: z.number().min(0).max(100000).nullable().optional(),
  max_active_cases: z.number().int().min(0).max(1000).optional(),
  // Self-serve transitions only: draft (work-in-progress) or pending_review
  // (submit for admin approval). Going 'active'/'suspended' is admin-gated.
  active_status: z.enum(['draft', 'pending_review']).optional(),
};

export const CreateProfileDto = z.object(profileFields);
export type CreateProfileDto = z.infer<typeof CreateProfileDto>;

export const UpdateProfileDto = z
  .object(profileFields)
  .refine((o) => Object.keys(o).length > 0, {
    message: 'at least one field is required',
  });
export type UpdateProfileDto = z.infer<typeof UpdateProfileDto>;

/**
 * consultant_skills — visa types + languages only. `countries_supported` is the
 * denormalized mirror of consultant_countries and is set via /sync-countries,
 * never directly (keeps the source of truth single).
 */
export const UpsertSkillsDto = z
  .object({
    visa_types: z.array(z.string().min(1).max(64)).max(100).optional(),
    languages: z.array(z.string().min(2).max(35)).max(100).optional(),
  })
  .refine((o) => o.visa_types !== undefined || o.languages !== undefined, {
    message: 'visa_types or languages is required',
  });
export type UpsertSkillsDto = z.infer<typeof UpsertSkillsDto>;

/** consultant_availability — IANA tz + weekly working-hours windows. */
export const UpsertAvailabilityDto = z
  .object({
    timezone: z.string().min(1).max(64).optional(),
    working_hours: z
      .record(z.string(), z.array(z.tuple([z.string(), z.string()])))
      .optional(),
    max_cases: z.number().int().min(0).max(1000).optional(),
    accepting_new: z.boolean().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: 'at least one field is required',
  });
export type UpsertAvailabilityDto = z.infer<typeof UpsertAvailabilityDto>;

/** Public discovery filters (GET /marketplace/consultants). All optional. */
export const DiscoveryQueryDto = z.object({
  visa_type: z.string().min(1).max(64).optional(),
  country: z.string().min(2).max(16).optional(),
  language: z.string().min(2).max(35).optional(),
});
export type DiscoveryQueryDto = z.infer<typeof DiscoveryQueryDto>;

/**
 * Review body. One review per case is enforced by the DB unique
 * (consultant_id, user_id, application_id); `application_id` is what makes it
 * "per case". RLS author-write ties user_id to the caller.
 */
export const CreateReviewDto = z.object({
  rating: z.number().int().min(1).max(5),
  feedback: z.string().max(5000).optional(),
  application_id: z.string().uuid().optional(),
});
export type CreateReviewDto = z.infer<typeof CreateReviewDto>;

// ---- View models (no equivalent in @visaai/types — see final report) --------

/** Consultant's own profile + its skills/availability (GET /marketplace/profile). */
export interface ConsultantProfileBundle {
  profile: ConsultantProfile;
  skills: ConsultantSkills | null;
  availability: ConsultantAvailability | null;
}

/**
 * Public detail view (GET /marketplace/consultants/:id).
 *
 * Deliberately a PROJECTION of ConsultantProfile, not an extension of it. The
 * route is @AllowAnonymous and RLS filters rows, not columns, so extending the
 * row type made the response contract include `stripe_connect_account_id`,
 * `payouts_enabled`, `kyc_status` and the internal `user_id` — all of which
 * were being served to anonymous visitors. Naming the public fields here means
 * a column added to consultant_profiles later cannot leak by default; adding it
 * to the public view has to be a deliberate edit.
 */
export interface ConsultantDetail {
  id: string;
  headline: string | null;
  bio: string | null;
  specialization: string[];
  years_experience: number | null;
  license_number: string | null;
  license_authority: string | null;
  license_country: string | null;
  license_verified: boolean;
  hourly_rate_usd: number | null;
  rating_avg: number;
  rating_count: number;
  active_status: ConsultantProfile['active_status'];
  /** From public.users.full_name (public on the marketplace card). */
  full_name: string | null;
  skills: ConsultantSkills | null;
  availability: ConsultantAvailability | null;
}
