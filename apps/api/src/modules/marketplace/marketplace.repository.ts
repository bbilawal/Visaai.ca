import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConsultantActiveStatus,
  ConsultantAvailability,
  ConsultantProfile,
  ConsultantReview,
  ConsultantSkills,
} from '@visaai/types';

/** DI token for the marketplace repository (mirrors the consultant/pricing seam). */
export const MARKETPLACE_REPOSITORY = Symbol('IMarketplaceRepository');

/**
 * Raised on a duplicate consultant_reviews insert (one-review-per-case unique
 * violation, Postgres 23505). The service maps it to a 409 — kept as a domain
 * error so the data layer stays free of Nest HTTP types (consultant repo's
 * AssignmentConflictError pattern).
 */
export class DuplicateReviewError extends Error {
  constructor() {
    super('A review already exists for this consultant + case');
    this.name = 'DuplicateReviewError';
  }
}

/** Owner-writable subset of consultant_profiles (system/money fields excluded). */
export interface ProfileWriteInput {
  headline?: string | null;
  bio?: string | null;
  specialization?: string[];
  years_experience?: number | null;
  license_number?: string | null;
  license_authority?: string | null;
  license_country?: string | null;
  hourly_rate_usd?: number | null;
  max_active_cases?: number;
  active_status?: Extract<ConsultantActiveStatus, 'draft' | 'pending_review'>;
}

/** consultant_skills write payload (countries_supported only set via sync). */
export interface SkillsWriteInput {
  visa_types?: string[];
  languages?: string[];
  countries_supported?: string[];
}

/** consultant_availability write payload. */
export interface AvailabilityWriteInput {
  timezone?: string;
  working_hours?: Record<string, [string, string][]>;
  max_cases?: number;
  accepting_new?: boolean;
}

/** consultant_reviews insert payload (author + target). */
export interface ReviewWriteInput {
  consultant_id: string;
  user_id: string;
  application_id: string | null;
  rating: number;
  feedback: string | null;
}

/** Discovery filters (all optional; AND-combined). */
export interface DiscoveryFilters {
  visaType?: string;
  country?: string;
  language?: string;
}

/** Flattened discovery row — consultant_profiles joined to its consultant_skills. */
export interface DiscoveryRow {
  id: string;
  user_id: string;
  headline: string | null;
  specialization: string[];
  years_experience: number | null;
  hourly_rate_usd: number | null;
  rating_avg: number;
  rating_count: number;
  active_status: ConsultantActiveStatus;
  visa_types: string[];
  languages: string[];
  countries_supported: string[];
}

/** Full consultant detail (profile + its skills + availability). */
export interface ConsultantDetailRow {
  profile: ConsultantProfile;
  skills: ConsultantSkills | null;
  availability: ConsultantAvailability | null;
}

/**
 * Data-access contract for the marketplace core. Request-path methods take the
 * caller's RLS-scoped client (`db`, from SupabaseService.forUser) so Postgres
 * enforces visibility (active profiles public-read; owner-write; review
 * author-write). `getFullNames` is the ONLY method that uses the service-role
 * client — public.users RLS is own-row-only, so reading OTHER consultants'
 * (intentionally public) display names needs the admin seam, exactly like the
 * existing consultant repository's email lookup.
 */
export interface IMarketplaceRepository {
  // ---- profile (owner-scoped) ----
  getProfileByUserId(
    db: SupabaseClient,
    userId: string,
  ): Promise<ConsultantProfile | null>;
  insertProfile(
    db: SupabaseClient,
    userId: string,
    input: ProfileWriteInput,
  ): Promise<ConsultantProfile>;
  updateProfile(
    db: SupabaseClient,
    userId: string,
    patch: ProfileWriteInput,
  ): Promise<ConsultantProfile>;

  // ---- skills + availability (owner-scoped) ----
  getSkills(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantSkills | null>;
  upsertSkills(
    db: SupabaseClient,
    consultantId: string,
    input: SkillsWriteInput,
  ): Promise<ConsultantSkills>;
  getAvailability(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantAvailability | null>;
  upsertAvailability(
    db: SupabaseClient,
    consultantId: string,
    input: AvailabilityWriteInput,
  ): Promise<ConsultantAvailability>;

  /** Active ISO-2 codes from consultant_countries (consultant_id == users.id). */
  getActiveCountryCodes(db: SupabaseClient, userId: string): Promise<string[]>;

  // ---- discovery (RLS public-read) ----
  listConsultants(
    db: SupabaseClient,
    filters: DiscoveryFilters,
  ): Promise<DiscoveryRow[]>;
  getConsultantDetail(
    db: SupabaseClient,
    id: string,
  ): Promise<ConsultantDetailRow | null>;

  // ---- reviews ----
  insertReview(
    db: SupabaseClient,
    input: ReviewWriteInput,
  ): Promise<ConsultantReview>;
  listReviews(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantReview[]>;

  // ---- system enrichment (service-role; public display names) ----
  // ---- admin review (service-role: reviewing a profile means reading rows the
  // reviewer does not own, which owner-scoped RLS deliberately forbids) ----
  /** Profiles in a given lifecycle state, newest first. */
  listProfilesByStatus(
    admin: SupabaseClient,
    status: ConsultantActiveStatus,
  ): Promise<ConsultantProfile[]>;
  /** Set a profile's lifecycle state. Returns null when the id is unknown. */
  setProfileStatus(
    admin: SupabaseClient,
    profileId: string,
    status: ConsultantActiveStatus,
  ): Promise<ConsultantProfile | null>;

  getFullNames(
    admin: SupabaseClient,
    userIds: string[],
  ): Promise<Map<string, string | null>>;
}
