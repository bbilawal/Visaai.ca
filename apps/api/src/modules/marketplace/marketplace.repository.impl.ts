import { Injectable } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ConsultantActiveStatus,
  ConsultantAvailability,
  ConsultantKycStatus,
  ConsultantProfile,
  ConsultantReview,
  ConsultantSkills,
} from '@visaai/types';
import {
  DuplicateReviewError,
  type AvailabilityWriteInput,
  type ConsultantDetailRow,
  type DiscoveryFilters,
  type DiscoveryRow,
  type IMarketplaceRepository,
  type ProfileWriteInput,
  type ReviewWriteInput,
  type SkillsWriteInput,
} from './marketplace.repository';

type Row = Record<string, unknown>;
interface Res {
  data: unknown;
  error: { message: string; code?: string } | null;
}

// Column projections kept explicit so a future column never silently widens a
// public read.
const PROFILE_COLS =
  'id, user_id, headline, bio, specialization, years_experience, license_number, license_authority, license_country, license_verified, hourly_rate_usd, rating_avg, rating_count, max_active_cases, active_status, kyc_status, stripe_connect_account_id, payouts_enabled, created_at, updated_at';
const SKILLS_COLS =
  'id, consultant_id, visa_types, languages, countries_supported, updated_at';
const AVAILABILITY_COLS =
  'id, consultant_id, timezone, working_hours, max_cases, accepting_new, updated_at';
const REVIEW_COLS =
  'id, consultant_id, user_id, application_id, rating, feedback, created_at';
const DISCOVERY_SKILLS = 'visa_types, languages, countries_supported';
// SEC-3040: hard cap on the unauthenticated discovery listing.
const DISCOVERY_MAX_RESULTS = 100;

function rows(res: Res, ctx: string): Row[] {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return (res.data ?? []) as Row[];
}
function maybeRow(res: Res, ctx: string): Row | null {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return (res.data ?? null) as Row | null;
}
function row(res: Res, ctx: string): Row {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  if (!res.data) throw new Error(`${ctx}: no row returned`);
  return res.data as Row;
}

/** Drop undefined keys so an UPDATE/INSERT touches only the columns provided. */
function defined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(o).filter(([, v]) => v !== undefined),
  ) as Partial<T>;
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? (v as string[]) : [];
}
function asNumOrNull(v: unknown): number | null {
  return v == null ? null : Number(v);
}
/** A to-one PostgREST embed arrives as an array (FK is on the child side). */
function firstOrNull(v: unknown): Row | null {
  if (Array.isArray(v)) return (v[0] as Row) ?? null;
  return (v as Row) ?? null;
}

function toProfile(r: Row): ConsultantProfile {
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    headline: (r.headline as string) ?? null,
    bio: (r.bio as string) ?? null,
    specialization: asArray(r.specialization),
    years_experience: asNumOrNull(r.years_experience),
    license_number: (r.license_number as string) ?? null,
    license_authority: (r.license_authority as string) ?? null,
    license_country: (r.license_country as string) ?? null,
    license_verified: Boolean(r.license_verified),
    hourly_rate_usd: asNumOrNull(r.hourly_rate_usd),
    rating_avg: Number(r.rating_avg ?? 0),
    rating_count: Number(r.rating_count ?? 0),
    max_active_cases: Number(r.max_active_cases ?? 0),
    active_status: r.active_status as ConsultantActiveStatus,
    kyc_status: r.kyc_status as ConsultantKycStatus,
    stripe_connect_account_id: (r.stripe_connect_account_id as string) ?? null,
    payouts_enabled: Boolean(r.payouts_enabled),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function toSkills(r: Row): ConsultantSkills {
  return {
    id: String(r.id),
    consultant_id: String(r.consultant_id),
    visa_types: asArray(r.visa_types),
    languages: asArray(r.languages),
    countries_supported: asArray(r.countries_supported),
    updated_at: String(r.updated_at),
  };
}

function toAvailability(r: Row): ConsultantAvailability {
  return {
    id: String(r.id),
    consultant_id: String(r.consultant_id),
    timezone: String(r.timezone ?? 'UTC'),
    working_hours: (r.working_hours ?? {}) as Record<
      string,
      [string, string][]
    >,
    max_cases: Number(r.max_cases ?? 0),
    accepting_new: Boolean(r.accepting_new),
    updated_at: String(r.updated_at),
  };
}

function toReview(r: Row): ConsultantReview {
  return {
    id: String(r.id),
    consultant_id: String(r.consultant_id),
    user_id: String(r.user_id),
    application_id: (r.application_id as string) ?? null,
    rating: Number(r.rating),
    feedback: (r.feedback as string) ?? null,
    created_at: String(r.created_at),
  };
}

function toDiscoveryRow(r: Row): DiscoveryRow {
  const skills = firstOrNull(r.consultant_skills);
  return {
    id: String(r.id),
    user_id: String(r.user_id),
    headline: (r.headline as string) ?? null,
    specialization: asArray(r.specialization),
    years_experience: asNumOrNull(r.years_experience),
    hourly_rate_usd: asNumOrNull(r.hourly_rate_usd),
    rating_avg: Number(r.rating_avg ?? 0),
    rating_count: Number(r.rating_count ?? 0),
    active_status: r.active_status as ConsultantActiveStatus,
    visa_types: asArray(skills?.visa_types),
    languages: asArray(skills?.languages),
    countries_supported: asArray(skills?.countries_supported),
  };
}

/**
 * Supabase-backed IMarketplaceRepository. No constructor state: each method
 * receives the client to run under (RLS-scoped for request paths; the
 * service-role client only for the public display-name lookup). PostgREST may
 * serialize numeric columns as strings — the mappers coerce so ConsultantCard /
 * ConsultantProfile stay numeric.
 */
@Injectable()
export class MarketplaceRepository implements IMarketplaceRepository {
  // ---- profile -----------------------------------------------------------

  async getProfileByUserId(
    db: SupabaseClient,
    userId: string,
  ): Promise<ConsultantProfile | null> {
    const res = await db
      .from('consultant_profiles')
      .select(PROFILE_COLS)
      .eq('user_id', userId)
      .maybeSingle();
    const r = maybeRow(res, 'getProfileByUserId');
    return r ? toProfile(r) : null;
  }

  async insertProfile(
    db: SupabaseClient,
    userId: string,
    input: ProfileWriteInput,
  ): Promise<ConsultantProfile> {
    // user_id is set explicitly: the owner-write RLS check is auth.uid()=user_id,
    // and the request runs as that uid via forUser(token).
    const res = await db
      .from('consultant_profiles')
      .insert({ user_id: userId, ...defined(input) })
      .select(PROFILE_COLS)
      .single();
    return toProfile(row(res, 'insertProfile'));
  }

  async updateProfile(
    db: SupabaseClient,
    userId: string,
    patch: ProfileWriteInput,
  ): Promise<ConsultantProfile> {
    const res = await db
      .from('consultant_profiles')
      .update({ ...defined(patch), updated_at: new Date().toISOString() })
      .eq('user_id', userId)
      .select(PROFILE_COLS)
      .single();
    return toProfile(row(res, 'updateProfile'));
  }

  // ---- skills + availability --------------------------------------------

  async getSkills(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantSkills | null> {
    const res = await db
      .from('consultant_skills')
      .select(SKILLS_COLS)
      .eq('consultant_id', consultantId)
      .maybeSingle();
    const r = maybeRow(res, 'getSkills');
    return r ? toSkills(r) : null;
  }

  async upsertSkills(
    db: SupabaseClient,
    consultantId: string,
    input: SkillsWriteInput,
  ): Promise<ConsultantSkills> {
    // onConflict consultant_id (unique): INSERT seeds defaults for unset arrays,
    // ON CONFLICT updates only the provided columns — so /sync-countries can set
    // countries_supported alone without clobbering visa_types/languages.
    const res = await db
      .from('consultant_skills')
      .upsert(
        {
          consultant_id: consultantId,
          ...defined(input),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'consultant_id' },
      )
      .select(SKILLS_COLS)
      .single();
    return toSkills(row(res, 'upsertSkills'));
  }

  async getAvailability(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantAvailability | null> {
    const res = await db
      .from('consultant_availability')
      .select(AVAILABILITY_COLS)
      .eq('consultant_id', consultantId)
      .maybeSingle();
    const r = maybeRow(res, 'getAvailability');
    return r ? toAvailability(r) : null;
  }

  async upsertAvailability(
    db: SupabaseClient,
    consultantId: string,
    input: AvailabilityWriteInput,
  ): Promise<ConsultantAvailability> {
    const res = await db
      .from('consultant_availability')
      .upsert(
        {
          consultant_id: consultantId,
          ...defined(input),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'consultant_id' },
      )
      .select(AVAILABILITY_COLS)
      .single();
    return toAvailability(row(res, 'upsertAvailability'));
  }

  async getActiveCountryCodes(
    db: SupabaseClient,
    userId: string,
  ): Promise<string[]> {
    // consultant_countries.consultant_id references public.users; RLS lets a
    // consultant read their OWN rows (auth.uid() = consultant_id).
    const res = await db
      .from('consultant_countries')
      .select('country_code')
      .eq('consultant_id', userId)
      .eq('active', true);
    return rows(res, 'getActiveCountryCodes').map((r) =>
      String(r.country_code),
    );
  }

  // ---- discovery ---------------------------------------------------------

  async listConsultants(
    db: SupabaseClient,
    filters: DiscoveryFilters,
  ): Promise<DiscoveryRow[]> {
    const hasFilter = !!(
      filters.visaType ||
      filters.country ||
      filters.language
    );
    // With a skill filter, !inner drops profiles whose skills don't match (and
    // skill-less profiles). With no filter, a left embed keeps every active
    // profile, skills or not.
    const skillsEmbed = hasFilter
      ? `consultant_skills!inner(${DISCOVERY_SKILLS})`
      : `consultant_skills(${DISCOVERY_SKILLS})`;

    let q = db
      .from('consultant_profiles')
      .select(
        `id, user_id, headline, specialization, years_experience, hourly_rate_usd, rating_avg, rating_count, active_status, ${skillsEmbed}`,
      )
      // Discovery surfaces ACTIVE profiles only — explicit even though the
      // public-read RLS would also expose the caller's own non-active row.
      .eq('active_status', 'active')
      .order('rating_avg', { ascending: false });

    if (filters.visaType) {
      q = q.contains('consultant_skills.visa_types', [filters.visaType]);
    }
    if (filters.country) {
      q = q.contains('consultant_skills.countries_supported', [
        filters.country,
      ]);
    }
    if (filters.language) {
      q = q.contains('consultant_skills.languages', [filters.language]);
    }

    // SEC-3040: this is the only unauthenticated list endpoint; cap the result
    // set so it cannot return the entire (growing) active roster in one request
    // or be used as a cheap scraping / DB-load amplifier.
    const res = await q.limit(DISCOVERY_MAX_RESULTS);
    return rows(res, 'listConsultants').map(toDiscoveryRow);
  }

  async getConsultantDetail(
    db: SupabaseClient,
    id: string,
  ): Promise<ConsultantDetailRow | null> {
    const res = await db
      .from('consultant_profiles')
      .select(
        `${PROFILE_COLS}, consultant_skills(${SKILLS_COLS}), consultant_availability(${AVAILABILITY_COLS})`,
      )
      .eq('id', id)
      .maybeSingle();
    const r = maybeRow(res, 'getConsultantDetail');
    if (!r) return null;
    const skills = firstOrNull(r.consultant_skills);
    const availability = firstOrNull(r.consultant_availability);
    return {
      profile: toProfile(r),
      skills: skills ? toSkills(skills) : null,
      availability: availability ? toAvailability(availability) : null,
    };
  }

  // ---- reviews -----------------------------------------------------------

  async insertReview(
    db: SupabaseClient,
    input: ReviewWriteInput,
  ): Promise<ConsultantReview> {
    const res = (await db
      .from('consultant_reviews')
      .insert({
        consultant_id: input.consultant_id,
        user_id: input.user_id,
        application_id: input.application_id,
        rating: input.rating,
        feedback: input.feedback,
      })
      .select(REVIEW_COLS)
      .single()) as Res;
    if (res.error) {
      // 23505 = one-review-per-case unique violation -> domain conflict.
      if (res.error.code === '23505') throw new DuplicateReviewError();
      throw new Error(`insertReview: ${res.error.message}`);
    }
    return toReview(row(res, 'insertReview'));
  }

  async listReviews(
    db: SupabaseClient,
    consultantId: string,
  ): Promise<ConsultantReview[]> {
    const res = await db
      .from('consultant_reviews')
      .select(REVIEW_COLS)
      .eq('consultant_id', consultantId)
      .order('created_at', { ascending: false });
    return rows(res, 'listReviews').map(toReview);
  }

  // ---- system enrichment (service-role) ---------------------------------

  async listProfilesByStatus(
    admin: SupabaseClient,
    status: ConsultantActiveStatus,
  ): Promise<ConsultantProfile[]> {
    const res = await admin
      .from('consultant_profiles')
      .select('*')
      .eq('active_status', status)
      .order('created_at', { ascending: false });
    return rows(res, 'listProfilesByStatus').map(
      (r) => r as unknown as ConsultantProfile,
    );
  }

  async setProfileStatus(
    admin: SupabaseClient,
    profileId: string,
    status: ConsultantActiveStatus,
  ): Promise<ConsultantProfile | null> {
    const { data, error } = await admin
      .from('consultant_profiles')
      .update({ active_status: status, updated_at: new Date().toISOString() })
      .eq('id', profileId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(`setProfileStatus failed: ${error.message}`);
    return data ?? null;
  }

  async getFullNames(
    admin: SupabaseClient,
    userIds: string[],
  ): Promise<Map<string, string | null>> {
    const unique = [...new Set(userIds.filter((id): id is string => !!id))];
    const out = new Map<string, string | null>();
    if (unique.length === 0) return out;
    const res = await admin
      .from('users')
      .select('id, full_name')
      .in('id', unique);
    for (const u of rows(res, 'getFullNames')) {
      out.set(String(u.id), (u.full_name as string) ?? null);
    }
    return out;
  }
}
